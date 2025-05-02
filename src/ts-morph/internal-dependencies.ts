import {
	SyntaxKind,
	type Statement,
	type Node,
	type VariableStatement,
	type FunctionDeclaration,
	type ClassDeclaration,
	type InterfaceDeclaration,
	type TypeAliasDeclaration,
	type EnumDeclaration,
} from "ts-morph";

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
	const allTopLevelStatements = sourceFile.getStatements(); // トップレベル宣言のリストをキャッシュ

	// Helper to check if a node is a top-level statement in the current source file
	const isTopLevelStatement = (node: Node): node is Statement => {
		// Ensure node has a parent and the parent is the SourceFile
		return (
			node.getParentIfKind(SyntaxKind.SourceFile) === sourceFile &&
			allTopLevelStatements.includes(node as Statement)
		);
	};

	// 1. 対象ノード内のすべての Identifier を取得
	const identifiers = targetDeclaration.getDescendantsOfKind(
		SyntaxKind.Identifier,
	);

	for (const identifier of identifiers) {
		// --- Skip self-references and internal definitions ---
		let skipIdentifier = false;

		// Check if the identifier is the name identifier of the target declaration itself
		if (targetDeclaration.isKind(SyntaxKind.VariableStatement)) {
			// Check if the identifier is one of the declared names in the VariableStatement
			if (
				(targetDeclaration as VariableStatement)
					.getDeclarations()
					.some((vd) => vd.getNameNode() === identifier)
			) {
				skipIdentifier = true;
			}
		} else if (
			targetDeclaration.isKind(SyntaxKind.FunctionDeclaration) ||
			targetDeclaration.isKind(SyntaxKind.ClassDeclaration) ||
			targetDeclaration.isKind(SyntaxKind.InterfaceDeclaration) ||
			targetDeclaration.isKind(SyntaxKind.TypeAliasDeclaration) ||
			targetDeclaration.isKind(SyntaxKind.EnumDeclaration)
		) {
			// Check if the identifier is the name node of these declaration types
			if (
				"getNameNode" in targetDeclaration &&
				typeof targetDeclaration.getNameNode === "function"
			) {
				if (
					(
						targetDeclaration as
							| FunctionDeclaration
							| ClassDeclaration
							| InterfaceDeclaration
							| TypeAliasDeclaration
							| EnumDeclaration
					).getNameNode() === identifier
				) {
					skipIdentifier = true;
				}
			}
		}

		if (skipIdentifier) continue;

		// Check if the identifier's declaration is *inside* the target declaration (parameter, local var, etc.)
		// Reverted the complex internal check - it might exclude valid cases.
		// The later check (is the declaration's container a top-level statement?) is more reliable.

		// --- Process external references ---
		const symbol = identifier.getSymbol();
		if (!symbol) continue;

		const declarations = symbol.getDeclarations();

		for (const declaration of declarations) {
			// Check if the declaration is in the same file
			if (declaration.getSourceFile() !== sourceFile) {
				continue; // Ignore external file dependencies
			}

			// Find the containing top-level statement for this declaration
			let containingTopLevelStmt: Statement | undefined = undefined;

			// If the declaration itself is a top-level statement
			if (isTopLevelStatement(declaration)) {
				containingTopLevelStmt = declaration;
			} else {
				// If it's like a VariableDeclaration, find its parent VariableStatement
				let current: Node | undefined = declaration;
				while (current && !isTopLevelStatement(current)) {
					current = current.getParent();
					// Avoid infinite loops in unexpected scenarios
					if (!current || current.isKind(SyntaxKind.SourceFile)) {
						current = undefined;
						break;
					}
				}
				if (current) {
					// Found the containing top-level statement
					containingTopLevelStmt = current as Statement;
				}
			}

			// Add to dependencies if it's a valid top-level statement and not the target itself
			if (
				containingTopLevelStmt &&
				containingTopLevelStmt !== targetDeclaration
			) {
				dependencies.add(containingTopLevelStmt);
			}
		}
	}

	return Array.from(dependencies);
}
