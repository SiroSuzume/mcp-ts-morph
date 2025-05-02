import {
	SyntaxKind,
	type FunctionDeclaration,
	type ImportDeclaration,
	type SourceFile,
	type Statement,
} from "ts-morph";

export function getDependentImportDeclarations(
	targetNode: FunctionDeclaration,
): ImportDeclaration[] {
	const dependentImports = new Set<ImportDeclaration>();

	// 1. 関数内のすべての Identifier を取得
	const identifiers = targetNode.getDescendantsOfKind(SyntaxKind.Identifier);

	for (const identifier of identifiers) {
		// 2. 各 Identifier の Symbol を取得し、その宣言を調べる
		const symbol = identifier.getSymbol();
		if (!symbol) continue;

		const declarations = symbol.getDeclarations();

		for (const declaration of declarations) {
			// 3. 宣言が ImportDeclaration の子孫であるか確認
			//    (ImportSpecifier, NamespaceImport, ImportClause などが該当)
			const importDeclaration = declaration.getFirstAncestorByKind(
				SyntaxKind.ImportDeclaration,
			);

			if (importDeclaration) {
				// 4. 見つかった ImportDeclaration を Set に追加 (重複排除)
				dependentImports.add(importDeclaration);
				// このシンボルに対応する ImportDeclaration が見つかれば、
				// 同じシンボルの他の宣言をチェックする必要はない場合が多い
				// break; // 必要に応じて break を検討
			}
		}
	}

	// 5. Set を配列に変換して返す
	return Array.from(dependentImports);
}

/**
 * ファイル直下のトップレベルの宣言ノードを取得する
 * (Import/Export宣言、空のステートメントなどは除く)
 */
export function getTopLevelDeclarationsFromFile(
	sourceFile: SourceFile,
): Statement[] {
	// 1. ファイル直下のすべてのステートメントを取得
	const allStatements = sourceFile.getStatements();

	// 2. 目的の宣言ノードのみをフィルタリング
	const declarationStatements = allStatements.filter((statement) => {
		const kind = statement.getKind();
		return (
			kind === SyntaxKind.VariableStatement ||
			kind === SyntaxKind.FunctionDeclaration ||
			kind === SyntaxKind.ClassDeclaration ||
			kind === SyntaxKind.TypeAliasDeclaration ||
			kind === SyntaxKind.InterfaceDeclaration
		);
	});

	return declarationStatements;
}
