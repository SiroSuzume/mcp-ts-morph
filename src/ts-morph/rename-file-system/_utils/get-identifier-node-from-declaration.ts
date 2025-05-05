import { type Identifier, Node } from "ts-morph";

export function getIdentifierNodeFromDeclaration(
	symbolDeclaration: Node,
	symbolName: string,
): Identifier | undefined {
	let identifierNode: Identifier | undefined = undefined;

	if (Node.isVariableDeclaration(symbolDeclaration)) {
		const nameNode = symbolDeclaration.getNameNode();
		if (nameNode && nameNode.getText() === symbolName) {
			identifierNode = nameNode as Identifier;
		}
	} else if (
		Node.isFunctionDeclaration(symbolDeclaration) ||
		Node.isClassDeclaration(symbolDeclaration) ||
		Node.isInterfaceDeclaration(symbolDeclaration) ||
		Node.isTypeAliasDeclaration(symbolDeclaration) ||
		Node.isEnumDeclaration(symbolDeclaration)
	) {
		const nameNode = symbolDeclaration.getNameNode?.();
		if (nameNode && nameNode.getText() === symbolName) {
			identifierNode = nameNode as Identifier;
		}
	}
	// TODO: 他に必要な宣言タイプがあれば追加

	return identifierNode;
}
