import type { Node, Project, Signature, Type } from "ts-morph";

export interface Position {
	/** 1-based 行番号 */
	line: number;
	/** 1-based 列番号 */
	column: number;
}

export interface SymbolInfo {
	/** シンボル名 */
	name: string;
	/** シンボルの最初の宣言のノード種別 (例: VariableDeclaration, FunctionDeclaration) */
	kind: string;
}

export interface DeclarationLocation {
	filePath: string;
	line: number;
	column: number;
}

export interface GetTypeAtPositionResult {
	/** 入力された位置 */
	position: Position;
	/** その位置に存在するノードの SyntaxKind 名 */
	nodeKind: string;
	/** その位置のノードのソーステキスト (80 文字で切り詰め) */
	nodeText: string;
	/** TypeChecker から得た型のテキスト表現 */
	type: string;
	/** ノードに紐づくシンボル (識別子・宣言など) */
	symbol?: SymbolInfo;
	/** シンボルの最初の宣言位置 */
	declaration?: DeclarationLocation;
}

const NODE_TEXT_MAX_LENGTH = 80;

/**
 * 指定された位置にある式・識別子の TypeChecker による推論型を取得する。
 *
 * - 識別子上 → そのシンボルの型 + 宣言位置
 * - リテラル/式上 → 型 (例: "string", "number", "{ id: string }")
 * - 空白/コメント上 → エラー
 *
 * `tsc` を都度起動するより圧倒的に速く、トークン効率も良いため、
 * Claude が能動的に「この変数の実際の型は?」を確認する用途を想定。
 */
export function getTypeAtPosition(
	project: Project,
	filePath: string,
	position: Position,
): GetTypeAtPositionResult {
	const sourceFile = project.getSourceFile(filePath);
	if (!sourceFile) {
		throw new Error(`ファイルが見つかりません: ${filePath}`);
	}

	let offset: number;
	try {
		offset = sourceFile.compilerNode.getPositionOfLineAndCharacter(
			position.line - 1,
			position.column - 1,
		);
	} catch (_error) {
		throw new Error(
			`指定位置 (${position.line}:${position.column}) はファイルの範囲外か無効です`,
		);
	}

	const node = sourceFile.getDescendantAtPos(offset);
	if (!node) {
		throw new Error(
			`指定位置 (${position.line}:${position.column}) にノードが見つかりません (空白やコメント上を指している可能性があります)`,
		);
	}

	const symbol = node.getSymbol();
	// import alias の場合は元の宣言シンボルまで遡る
	const resolvedSymbol = symbol?.getAliasedSymbol() ?? symbol;

	// Identifier に紐づくシンボルからは、そのノード位置での実際の型 (関数シグネチャなど) を取得できる。
	const type = resolvedSymbol
		? resolvedSymbol.getTypeAtLocation(node)
		: node.getType();
	const typeText = formatTypeText(type, node);

	const nodeText = node.getText();
	const truncatedNodeText =
		nodeText.length > NODE_TEXT_MAX_LENGTH
			? `${nodeText.slice(0, NODE_TEXT_MAX_LENGTH)}…`
			: nodeText;

	const result: GetTypeAtPositionResult = {
		position,
		nodeKind: node.getKindName(),
		nodeText: truncatedNodeText,
		type: typeText,
	};

	if (resolvedSymbol) {
		const declarations = resolvedSymbol.getDeclarations();
		const firstDeclaration = declarations[0];
		result.symbol = {
			name: resolvedSymbol.getName(),
			kind: firstDeclaration?.getKindName() ?? "Unknown",
		};
		if (firstDeclaration) {
			const declSourceFile = firstDeclaration.getSourceFile();
			const declStart = firstDeclaration.getStart();
			const { line, column } = declSourceFile.getLineAndColumnAtPos(declStart);
			result.declaration = {
				filePath: declSourceFile.getFilePath(),
				line,
				column,
			};
		}
	}

	return result;
}

/**
 * 関数宣言を指す Identifier 等は型 `typeof Foo` として表現されるため、
 * call signature を持つ場合は arrow 形式に展開して表示する。
 * 複数オーバーロードがある場合は `((...) => T) & ((...) => U)` 形式。
 */
function formatTypeText(type: Type, node: Node): string {
	const raw = type.getText(node);
	const callSignatures = type.getCallSignatures();
	if (callSignatures.length === 0) return raw;
	// `typeof X` 形式の場合のみ展開する (匿名関数式は既に arrow 形式)
	if (!raw.startsWith("typeof ")) return raw;

	const signatures = callSignatures.map((sig) =>
		formatCallSignature(sig, node),
	);
	return signatures.length === 1
		? signatures[0]
		: signatures.map((s) => `(${s})`).join(" & ");
}

function formatCallSignature(sig: Signature, node: Node): string {
	const params = sig.getParameters().map((param) => {
		const paramType = param.getTypeAtLocation(node).getText(node);
		return `${param.getName()}: ${paramType}`;
	});
	const returnType = sig.getReturnType().getText(node);
	return `(${params.join(", ")}) => ${returnType}`;
}
