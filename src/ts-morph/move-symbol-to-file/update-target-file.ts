import type { SourceFile } from "ts-morph";
import logger from "../../utils/logger";
import type { NeededExternalImports } from "../types";

export function updateTargetFile(
	originalTargetSourceFile: SourceFile,
	newFilePath: string,
	neededExternalImports: NeededExternalImports,
	dependencyStatementsToMove: string[],
	declarationStatementText: string,
) {
	const targetSourceFile = originalTargetSourceFile;
	logger.debug(`既存ファイルを発見: ${newFilePath}。シンボルを追加します。`);

	for (const [moduleSpecifier, importInfo] of neededExternalImports.entries()) {
		const existingImport = targetSourceFile.getImportDeclaration(
			(imp) => imp.getModuleSpecifierValue() === moduleSpecifier,
		);
		if (existingImport) {
			const existingNamedImports = new Set(
				existingImport.getNamedImports().map((ni) => ni.getName()),
			);
			const importsToAdd: { name: string; alias?: string }[] = [];
			for (const name of importInfo.names) {
				if (!existingNamedImports.has(name)) {
					importsToAdd.push({ name: name });
				}
			}

			if (importsToAdd.length > 0) {
				existingImport.addNamedImports(importsToAdd);
			}
		} else {
			const namedImportsToAdd: { name: string; alias?: string }[] = [];
			for (const name of importInfo.names) {
				namedImportsToAdd.push({ name: name });
			}
			targetSourceFile.addImportDeclaration({
				moduleSpecifier: moduleSpecifier,
				namedImports: namedImportsToAdd,
			});
		}
	}
	// 移動する依存関係とシンボル本体をファイルの末尾に追加
	const statementsToAdd: string[] = [];
	if (dependencyStatementsToMove.length > 0) {
		statementsToAdd.push(...dependencyStatementsToMove);
	}
	statementsToAdd.push(declarationStatementText);

	targetSourceFile.addStatements(statementsToAdd); // 配列で渡す

	logger.debug(`既存ファイルにシンボルを追加完了: ${newFilePath}`);
	targetSourceFile.organizeImports();
}
