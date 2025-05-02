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

		// Kind が指定されていて、現在の Statement の Kind と一致しない場合はスキップ
		if (kind !== undefined && currentKind !== kind) {
			continue;
		}

		let foundMatch = false;

		// --- Special handling for VariableStatement ---
		if (Node.isVariableStatement(statement)) {
			// VariableStatement の場合は内部の宣言をすべてチェック
			for (const varDecl of statement.getDeclarations()) {
				if (varDecl.getName() === name) {
					foundMatch = true;
					break;
				}
			}
		} else {
			// --- Use getIdentifierFromDeclaration for other types ---
			const identifier = getIdentifierFromDeclaration(statement);
			if (identifier?.getText() === name) {
				foundMatch = true;
			}
		}
		// ----------------------------------------------

		// 名前が一致したら返す (Kind チェックはループ冒頭で済んでいる)
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

	// Check standard named declarations
	if (
		Node.isFunctionDeclaration(declaration) ||
		Node.isClassDeclaration(declaration) ||
		Node.isInterfaceDeclaration(declaration) ||
		Node.isTypeAliasDeclaration(declaration) ||
		Node.isEnumDeclaration(declaration)
	) {
		// Handle default export anonymous function/class slightly differently
		if (declaration.isDefaultExport() && !declaration.getNameNode()) {
			return undefined;
		}
		return declaration.getNameNode();
	}

	// Check variable statements
	if (Node.isVariableStatement(declaration)) {
		const firstDecl = declaration.getDeclarations()[0];
		const nameNode = firstDecl?.getNameNode();
		if (nameNode && Node.isIdentifier(nameNode)) {
			return nameNode;
		}
	}

	// Check export assignments (e.g., export default identifier;)
	if (Node.isExportAssignment(declaration)) {
		const expression = declaration.getExpression();
		if (Node.isIdentifier(expression)) {
			return expression;
		}
		return undefined;
	}

	return undefined;
}
