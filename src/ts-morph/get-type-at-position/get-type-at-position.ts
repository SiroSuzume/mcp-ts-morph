import {
	Node,
	type Project,
	type Symbol as TsMorphSymbol,
	type Type,
} from "ts-morph";

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
	/** その位置のノードのソーステキスト (80 コードポイントで切り詰め) */
	nodeText: string;
	/** TypeChecker から得た型のテキスト表現 (関数の場合は signature 形式) */
	type: string;
	/** ノードに紐づくシンボル (識別子・宣言など) */
	symbol?: SymbolInfo;
	/** シンボルの最初の宣言位置 (alias の場合は再帰解決後の元宣言) */
	declaration?: DeclarationLocation;
}

const NODE_TEXT_MAX_LENGTH = 80;
const ALIAS_RESOLUTION_DEPTH_LIMIT = 16;

/**
 * 指定された位置にある式・識別子の TypeChecker による推論型を取得する。
 *
 * - 関数/メソッド宣言を指す Identifier → 宣言テキストから組み立てた signature
 *   (例: `(name: string) => string`、overload なら `(...) & (...)`)
 * - 変数/プロパティ/リテラル → 推論型のテキスト (例: `{ id: string }`, `"hello"`)
 * - 空白/コメント行など、識別子でない位置 → `nodeKind` が SourceFile や
 *   EndOfFileToken となり、`type` はその位置で TS が返す型 (多くの場合
 *   `typeof import("...")` 等)。エラーにはならないため、呼び出し側で
 *   `nodeKind` を見て判定すること。
 *
 * `tsc` を都度起動するより圧倒的に速く、トークン効率も良いため、
 * Claude が能動的に「この変数の実際の型は?」を確認する用途を想定。
 */
export function getTypeAtPosition(
	project: Project,
	filePath: string,
	position: Position,
): GetTypeAtPositionResult {
	if (
		!Number.isInteger(position.line) ||
		!Number.isInteger(position.column) ||
		position.line < 1 ||
		position.column < 1
	) {
		throw new Error(
			`位置は 1-based の正の整数で指定してください (受信値: line=${position.line}, column=${position.column})`,
		);
	}

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

	// 注: getDescendantAtPos は空白上でも SourceFile / EndOfFileToken を返すため、
	// 「ノードが見つからない」ケースは事実上発生しない。安全のため undefined ガードのみ残す。
	const node = sourceFile.getDescendantAtPos(offset);
	if (!node) {
		throw new Error(
			`指定位置 (${position.line}:${position.column}) からノードを解決できません`,
		);
	}

	const symbol = node.getSymbol();
	const resolvedSymbol = resolveAliasChain(symbol);

	const type = resolvedSymbol
		? resolvedSymbol.getTypeAtLocation(node)
		: node.getType();

	const typeText = formatTypeText(type, node, resolvedSymbol);

	const result: GetTypeAtPositionResult = {
		position,
		nodeKind: node.getKindName(),
		nodeText: truncateByCodePoint(node.getText(), NODE_TEXT_MAX_LENGTH),
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
 * import { x } from './a' のような alias を、`export * from './b'` を含む再エクスポート
 * チェーンを辿って元の宣言シンボルまで再帰解決する。
 */
function resolveAliasChain(
	symbol: TsMorphSymbol | undefined,
): TsMorphSymbol | undefined {
	if (!symbol) return undefined;
	let current = symbol;
	for (let depth = 0; depth < ALIAS_RESOLUTION_DEPTH_LIMIT; depth++) {
		const aliased = current.getAliasedSymbol();
		if (!aliased) return current;
		if (aliased === current) return current;
		current = aliased;
	}
	return current;
}

/**
 * 型のテキスト表現を組み立てる。
 *
 * - シンボルの宣言がすべて signature を持つ宣言 (FunctionDeclaration /
 *   MethodDeclaration / MethodSignature / ArrowFunction / FunctionExpression /
 *   CallSignature) なら、それらの宣言テキストから signature を組み立てる。
 *   これにより rest `...` / optional `?` / 分割代入パラメータが破壊されず、
 *   オーバーロード時には合成 `&` で連結される。
 * - 関数 + namespace マージのような混在宣言の場合は raw を返してプロパティ側を保全する。
 * - 上記以外 (変数・型エイリアス・リテラル等) は TypeChecker の raw text をそのまま返す。
 */
function formatTypeText(
	type: Type,
	node: Node,
	symbol: TsMorphSymbol | undefined,
): string {
	const raw = type.getText(node);
	if (!symbol) return raw;
	const declarations = symbol.getDeclarations();
	if (declarations.length === 0) return raw;

	const signatureDecls = declarations.filter(isSignatureBearingDeclaration);
	if (
		signatureDecls.length === 0 ||
		signatureDecls.length !== declarations.length
	) {
		// 混在 (namespace merge 等) または signature を持たない → raw を返してメンバーを保全
		return raw;
	}

	// オーバーロードがある場合、implementation シグネチャは隠す (TS 標準の hover 挙動に合わせる)
	const hasOverload = signatureDecls.some(
		(decl) =>
			(Node.isFunctionDeclaration(decl) || Node.isMethodDeclaration(decl)) &&
			decl.isOverload(),
	);
	const displayDecls = hasOverload
		? signatureDecls.filter(
				(decl) =>
					!(
						(Node.isFunctionDeclaration(decl) ||
							Node.isMethodDeclaration(decl)) &&
						decl.isImplementation()
					),
			)
		: signatureDecls;

	const sigTexts = displayDecls.map(renderSignatureFromDeclaration);
	return sigTexts.length === 1
		? sigTexts[0]
		: sigTexts.map((s) => `(${s})`).join(" & ");
}

function isSignatureBearingDeclaration(decl: Node): boolean {
	return (
		Node.isFunctionDeclaration(decl) ||
		Node.isMethodDeclaration(decl) ||
		Node.isMethodSignature(decl) ||
		Node.isCallSignatureDeclaration(decl) ||
		Node.isArrowFunction(decl) ||
		Node.isFunctionExpression(decl) ||
		Node.isFunctionTypeNode(decl) ||
		Node.isGetAccessorDeclaration(decl) ||
		Node.isSetAccessorDeclaration(decl) ||
		Node.isConstructSignatureDeclaration(decl)
	);
}

/**
 * 関数様宣言から `(params) => returnType` 形式のテキストを組み立てる。
 * パラメータと戻り値は元ソースのテキストをそのまま使うため、
 * rest / optional / 分割代入 / readonly などの修飾子が保持される。
 */
function renderSignatureFromDeclaration(decl: Node): string {
	if (!isSignatureBearingDeclaration(decl)) {
		// 想定外: 呼び出し元でフィルタ済みのはず
		return decl.getText();
	}
	const node = decl as Node & {
		getParameters: () => Node[];
		getReturnTypeNode?: () => Node | undefined;
		getReturnType?: () => { getText: (n?: Node) => string };
	};

	const paramTexts = node.getParameters().map((p) => p.getText());
	const returnTypeNode = node.getReturnTypeNode?.();
	const returnTypeText = returnTypeNode
		? returnTypeNode.getText()
		: (node.getReturnType?.().getText(decl) ?? "any");
	return `(${paramTexts.join(", ")}) => ${returnTypeText}`;
}

/**
 * 文字列を Unicode コードポイント単位で切り詰める。
 * UTF-16 サロゲートペア (絵文字や追加面の文字) を途中で切ることがない。
 */
function truncateByCodePoint(text: string, maxLength: number): string {
	const codePoints = Array.from(text);
	if (codePoints.length <= maxLength) return text;
	return `${codePoints.slice(0, maxLength).join("")}…`;
}
