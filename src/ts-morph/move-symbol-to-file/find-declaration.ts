import {
	type SourceFile,
	type Statement,
	type SyntaxKind,
	Node,
	type Identifier,
} from "ts-morph";
import logger from "../../utils/logger";

/**
 * SourceFile 内から指定された名前と（オプションで）種類に一致する最初のトップレベル宣言を見つける。
 *
 * 同名の宣言が複数存在する場合（例: 型と値、関数オーバーロード）、ファイル内で最初に出現するものが返される。
 * VariableStatement 内に複数の VariableDeclaration がある場合、指定された名前に一致する Declaration を含む
 * 最初の VariableStatement が返される。
 */
export function findTopLevelDeclarationByName(
	sourceFile: SourceFile,
	name: string,
	kind?: SyntaxKind,
): Statement | undefined {
	const allStatements = sourceFile.getStatements();

	for (const statement of allStatements) {
		const currentKind = statement.getKind();

		if (kind !== undefined && currentKind !== kind) {
			continue;
		}

		let foundMatch = false;

		if (Node.isVariableStatement(statement)) {
			// `const a = 1, b = 2;` のようなケースで内部の各宣言をチェック
			for (const varDecl of statement.getDeclarations()) {
				if (varDecl.getName() === name) {
					foundMatch = true;
					break;
				}
			}
		} else {
			const identifier = getIdentifierFromDeclaration(statement);
			if (identifier?.getText() === name) {
				foundMatch = true;
			}
		}

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

	if (
		Node.isFunctionDeclaration(declaration) ||
		Node.isClassDeclaration(declaration) ||
		Node.isInterfaceDeclaration(declaration) ||
		Node.isTypeAliasDeclaration(declaration) ||
		Node.isEnumDeclaration(declaration)
	) {
		// デフォルトエクスポートされた無名関数/クラスは getNameNode() がない場合がある
		if (declaration.isDefaultExport() && !declaration.getNameNode()) {
			return undefined;
		}
		return declaration.getNameNode();
	}

	if (Node.isVariableStatement(declaration)) {
		for (const varDecl of declaration.getDeclarations()) {
			const nameNode = varDecl.getNameNode();
			// DEBUG ログ追加
			logger.trace(
				{
					varDeclName: varDecl.getName(),
					nameNodeKind: nameNode?.getKindName(),
					isIdentifier: nameNode ? Node.isIdentifier(nameNode) : null,
				},
				"Checking VariableDeclaration inside VariableStatement",
			);
			if (nameNode && Node.isIdentifier(nameNode)) {
				// DEBUG ログ追加
				logger.trace(
					{ identifierText: nameNode.getText() },
					"Found Identifier in VariableDeclaration",
				);
				return nameNode;
			}
		}
	}

	if (Node.isExportAssignment(declaration)) {
		const expression = declaration.getExpression();
		if (Node.isIdentifier(expression)) {
			return expression;
		}
		return undefined;
	}

	return undefined;
}
