import {
	type SourceFile,
	type Statement,
	type SyntaxKind,
	Node,
	type Identifier,
} from "ts-morph";

/**
 * SourceFile 内から指定された名前と（オプションで）種類に一致する最初のトップレベル宣言を見つける。
 *
 * 同名の宣言が複数存在する場合（例: 型と値、関数オーバーロード）、ファイル内で最初に出現するものが返される。
 * VariableStatement 内に複数の VariableDeclaration がある場合、指定された名前に一致する Declaration を含む
 * 最初の VariableStatement が返される。
 *
 * @param sourceFile 検索対象の SourceFile
 * @param name 検索する宣言の名前
 * @param kind オプション: 検索する宣言の種類 (SyntaxKind)
 * @returns 見つかった Statement、または undefined
 */
export function findTopLevelDeclarationByName(
	sourceFile: SourceFile,
	name: string,
	kind?: SyntaxKind,
): Statement | undefined {
	const allStatements = sourceFile.getStatements();

	for (const statement of allStatements) {
		const currentKind = statement.getKind();

		// Kind が指定されていても一致しない場合はスキップ
		if (kind !== undefined && currentKind !== kind) {
			continue;
		}

		let foundMatch = false;

		// 変数宣言 (VariableStatement) の特殊処理
		if (Node.isVariableStatement(statement)) {
			// `const a = 1, b = 2;` のようなケースで内部の各宣言 (`a`,`b`) をチェック
			for (const varDecl of statement.getDeclarations()) {
				if (varDecl.getName() === name) {
					foundMatch = true;
					break;
				}
			}
		} else {
			// 他の種類の宣言は識別子を取得して比較
			const identifier = getIdentifierFromDeclaration(statement);
			if (identifier?.getText() === name) {
				foundMatch = true;
			}
		}

		// 名前が一致したらその Statement を返す
		if (foundMatch) {
			return statement;
		}
	}

	return undefined;
}

export function getIdentifierFromDeclaration(
	declaration: Statement | undefined,
): Identifier | undefined {
	if (!declaration) {
		return undefined;
	}

	// 標準的な名前付き宣言 (関数、クラス、インターフェースなど)
	if (
		Node.isFunctionDeclaration(declaration) ||
		Node.isClassDeclaration(declaration) ||
		Node.isInterfaceDeclaration(declaration) ||
		Node.isTypeAliasDeclaration(declaration) ||
		Node.isEnumDeclaration(declaration)
	) {
		// デフォルトエクスポートされた無名関数/クラスは getNameNode() がないので特別扱い
		if (declaration.isDefaultExport() && !declaration.getNameNode()) {
			return undefined;
		}
		return declaration.getNameNode();
	}

	// 変数宣言 (VariableStatement)
	if (Node.isVariableStatement(declaration)) {
		// 最初の宣言の識別子を取得 (通常は一つだが複数も考慮)
		const firstDecl = declaration.getDeclarations()[0];
		const nameNode = firstDecl?.getNameNode();
		if (nameNode && Node.isIdentifier(nameNode)) {
			return nameNode;
		}
	}

	// エクスポート割り当て (例: `export default myIdentifier;`)
	if (Node.isExportAssignment(declaration)) {
		const expression = declaration.getExpression();
		if (Node.isIdentifier(expression)) {
			return expression;
		}
		return undefined;
	}

	return undefined;
}
