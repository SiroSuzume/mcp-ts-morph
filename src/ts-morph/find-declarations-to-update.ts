import type {
	SourceFile,
	ImportDeclaration,
	ExportDeclaration,
} from "ts-morph";
import type { DeclarationToUpdate } from "./types";
import { getTsConfigPaths } from "./ts-morph-project";
import logger from "../utils/logger";

/**
 * Checks if a module specifier uses a path alias defined in tsconfig.
 */
function checkIsPathAlias(
	specifier: string,
	tsConfigPaths?: Record<string, string[]>,
): boolean {
	if (!tsConfigPaths) {
		return false;
	}
	return Object.keys(tsConfigPaths).some((aliasKey) =>
		specifier.startsWith(aliasKey.replace(/\*$/, "")),
	);
}

/**
 * Finds all Import/Export declarations that reference the target file
 * using ts-morph's getReferencingSourceFiles.
 * NOTE: This may not find references through re-exports (e.g., via index.ts).
 */
export async function findDeclarationsReferencingFile(
	targetFile: SourceFile,
	signal?: AbortSignal,
): Promise<DeclarationToUpdate[]> {
	signal?.throwIfAborted();
	const results: DeclarationToUpdate[] = [];
	const targetFilePath = targetFile.getFilePath();
	const project = targetFile.getProject();
	const tsConfigPaths = getTsConfigPaths(project);

	logger.trace(
		{ targetFile: targetFilePath },
		"Starting findDeclarationsReferencingFile using getReferencingSourceFiles",
	);

	// Use ts-morph's built-in method to find referencing source files
	const referencingSourceFiles = targetFile.getReferencingSourceFiles();

	logger.trace(
		{ count: referencingSourceFiles.length },
		"Found referencing source files via ts-morph",
	);

	const uniqueDeclarations = new Set<ImportDeclaration | ExportDeclaration>();

	for (const referencingFile of referencingSourceFiles) {
		signal?.throwIfAborted();
		const referencingFilePath = referencingFile.getFilePath();
		try {
			const declarations = [
				...referencingFile.getImportDeclarations(),
				...referencingFile.getExportDeclarations(),
			];

			for (const declaration of declarations) {
				signal?.throwIfAborted();
				if (uniqueDeclarations.has(declaration)) continue;

				const moduleSpecifier = declaration.getModuleSpecifier();
				if (!moduleSpecifier) continue;

				// Check if the declaration *actually* resolves to the target file
				const specifierSourceFile = declaration.getModuleSpecifierSourceFile();

				if (specifierSourceFile?.getFilePath() === targetFilePath) {
					const originalSpecifierText = moduleSpecifier.getLiteralText();
					if (originalSpecifierText) {
						const wasPathAlias = checkIsPathAlias(
							originalSpecifierText,
							tsConfigPaths,
						);
						results.push({
							declaration,
							resolvedPath: targetFilePath,
							referencingFilePath: referencingFilePath,
							originalSpecifierText,
							wasPathAlias,
						});
						uniqueDeclarations.add(declaration);
						logger.trace(
							{
								referencingFile: referencingFilePath,
								specifier: originalSpecifierText,
								kind: declaration.getKindName(),
							},
							"Found relevant declaration",
						);
					}
				}
			}
		} catch (err) {
			logger.warn(
				{ file: referencingFilePath, err },
				"Error processing referencing file",
			);
		}
	}

	logger.trace(
		{ foundCount: results.length },
		"Finished findDeclarationsReferencingFile",
	);
	return results;
}
