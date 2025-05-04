import { SyntaxKind, type Statement, type Node } from "ts-morph";
import { getDeclarationIdentifier } from "./get-declaration-identifier";

/**
 * 指定された宣言ノードがファイル内部で依存している他のトップレベル宣言ノードを特定する
 * @param targetDeclaration 依存関係を調べる対象の宣言ノード (FunctionDeclaration, VariableStatement など)
 * @returns 依存先のトップレベル宣言ノードの配列
 */
export function getInternalDependencies(
	targetDeclaration: Statement,
): Statement[] {
	const dependencies = new Set<Statement>();
	const sourceFile = targetDeclaration.getSourceFile();
	const allTopLevelStatements = sourceFile.getStatements();

	const isTopLevelStatement = (node: Node): node is Statement => {
		// Ensure node has a parent and the parent is the SourceFile
		return (
			node.getParentIfKind(SyntaxKind.SourceFile) === sourceFile &&
			allTopLevelStatements.includes(node as Statement)
		);
	};

	const identifiers = targetDeclaration.getDescendantsOfKind(
		SyntaxKind.Identifier,
	);

	const targetIdentifierNode = getDeclarationIdentifier(targetDeclaration);

	for (const identifier of identifiers) {
		// --- Skip self-references and internal definitions ---
		if (targetIdentifierNode && identifier === targetIdentifierNode) {
			continue;
		}

		// --- Process external references ---
		const symbol = identifier.getSymbol();
		if (!symbol) continue;

		const declarations = symbol.getDeclarations();

		for (const declaration of declarations) {
			if (declaration.getSourceFile() !== sourceFile) {
				continue;
			}

			let containingTopLevelStmt: Statement | undefined = undefined;

			if (isTopLevelStatement(declaration)) {
				containingTopLevelStmt = declaration;
			} else {
				let current: Node | undefined = declaration;
				while (current && !isTopLevelStatement(current)) {
					current = current.getParent();
					if (!current || current.isKind(SyntaxKind.SourceFile)) {
						current = undefined;
						break;
					}
				}
				if (current) {
					containingTopLevelStmt = current as Statement;
				}
			}

			if (
				containingTopLevelStmt &&
				containingTopLevelStmt !== targetDeclaration
			) {
				const kind = containingTopLevelStmt.getKind();
				if (
					kind === SyntaxKind.VariableStatement ||
					kind === SyntaxKind.FunctionDeclaration ||
					kind === SyntaxKind.ClassDeclaration ||
					kind === SyntaxKind.InterfaceDeclaration ||
					kind === SyntaxKind.TypeAliasDeclaration ||
					kind === SyntaxKind.EnumDeclaration
				) {
					dependencies.add(containingTopLevelStmt);
				}
			}
		}
	}

	return Array.from(dependencies);
}
