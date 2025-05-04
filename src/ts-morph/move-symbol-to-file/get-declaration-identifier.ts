import { Node, type Statement, type Identifier } from "ts-morph";

/**
 * Statement (主に宣言) から主要な Identifier ノードを取得する。
 * internal-dependencies.ts の自己参照チェックロジックをベースにする。
 */
export function getDeclarationIdentifier(
	statement: Statement,
): Identifier | undefined {
	let nameNode: Node | undefined;

	if (Node.isVariableStatement(statement)) {
		// VariableStatement の場合は最初の VariableDeclaration を見る
		nameNode = statement.getDeclarations()[0]?.getNameNode();
	} else if (
		Node.isFunctionDeclaration(statement) ||
		Node.isClassDeclaration(statement) ||
		Node.isInterfaceDeclaration(statement) ||
		Node.isTypeAliasDeclaration(statement) ||
		Node.isEnumDeclaration(statement)
	) {
		// これらの宣言タイプは getNameNode() を持つ
		nameNode = statement.getNameNode();
	} else if (Node.isVariableDeclaration(statement)) {
		// VariableDeclaration 自体が渡された場合 (あまりないが)
		nameNode = statement.getNameNode();
	}
	// 他のケース (EnumMember, Parameter など) も必要に応じて追加可能

	if (nameNode && Node.isIdentifier(nameNode)) {
		return nameNode;
	}

	return undefined;
}
