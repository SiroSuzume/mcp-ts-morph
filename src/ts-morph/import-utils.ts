import { type SourceFile, SyntaxKind } from "ts-morph";

/**
 * 指定されたモジュールから特定の名前付きインポートを削除します。
 * もしそのインポート宣言がそのシンボルのみをインポートしていた場合、宣言自体も削除します。
 */
export function removeNamedImport(
	sourceFile: SourceFile,
	symbolToRemove: string,
	moduleSpecifier: string,
): void {
	const importDeclaration = sourceFile.getImportDeclaration(moduleSpecifier);
	if (!importDeclaration) return;

	const importClause = importDeclaration.getImportClause();
	if (!importClause) return; // Default import や side effect import の場合

	const namedBindings = importClause.getNamedBindings();
	const namedImportsNode = namedBindings?.asKind(SyntaxKind.NamedImports);

	if (namedImportsNode) {
		const namedImports = namedImportsNode.getElements();
		const importSpecifierToRemove = namedImports.find(
			(specifier) => specifier.getName() === symbolToRemove,
		);

		if (importSpecifierToRemove) {
			if (namedImports.length === 1) {
				// これが最後の ImportSpecifier なら、ImportDeclaration ごと削除
				importDeclaration.remove();
			} else {
				// 他にも ImportSpecifier があれば、指定されたものだけ削除
				importSpecifierToRemove.remove();
			}
		}
	}
	// 他の形式 (import * as ns from ..., import defaultExport from ...) は何もしない
}

/**
 * 指定されたモジュールから特定の名前付きインポートを追加または更新します。
 * 既に同じモジュールからのインポート宣言が存在する場合は、そこにシンボルを追加します。
 * 存在しない場合は、新しいインポート宣言を作成します。
 */
export function addOrUpdateNamedImport(
	sourceFile: SourceFile,
	symbolToAdd: string,
	moduleSpecifier: string,
): void {
	const importDeclaration = sourceFile.getImportDeclaration(moduleSpecifier);

	if (importDeclaration) {
		const importClause = importDeclaration.getImportClause();
		if (!importClause) {
			console.warn(
				`Cannot add named import '${symbolToAdd}' to import declaration without an import clause: ${importDeclaration.getText()}`,
			);
			return;
		}

		const namedBindings = importClause.getNamedBindings();
		const namedImportsNode = namedBindings?.asKind(SyntaxKind.NamedImports);

		if (namedImportsNode) {
			const existingElements = namedImportsNode.getElements();
			const existingSymbols = existingElements.map((e) => e.getName());
			if (!existingSymbols.includes(symbolToAdd)) {
				importDeclaration.addNamedImport(symbolToAdd);
			}
		} else if (!namedBindings) {
			const defaultImport = importClause.getDefaultImport();
			if (defaultImport) {
				importDeclaration.set({
					defaultImport: defaultImport.getText(),
					namedImports: [symbolToAdd],
					moduleSpecifier: importDeclaration.getModuleSpecifierValue(),
				});
			} else {
				importDeclaration.set({
					namedImports: [symbolToAdd],
					moduleSpecifier: importDeclaration.getModuleSpecifierValue(),
				});
			}
		} else if (namedBindings?.getKind() === SyntaxKind.NamespaceImport) {
			console.warn(
				`Cannot add named import '${symbolToAdd}' to namespace import: ${importDeclaration.getText()}`,
			);
		}
	} else {
		sourceFile.addImportDeclaration({
			namedImports: [symbolToAdd],
			moduleSpecifier: moduleSpecifier,
		});
	}
}
