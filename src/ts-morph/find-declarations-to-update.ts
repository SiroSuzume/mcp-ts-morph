import type {
	Project,
	SourceFile,
	Directory,
	ImportDeclaration,
	ExportDeclaration,
} from "ts-morph";
import * as path from "node:path";
import type { DeclarationToUpdate } from "./types";

/**
 * Finds all Import/Export declarations that reference the target file.
 * Uses sourceFile.getReferencingSourceFiles() for optimization.
 * @param targetFile The source file whose references are being sought.
 * @param signal Optional AbortSignal for cancellation.
 */
export function findDeclarationsReferencingFile(
	targetFile: SourceFile,
	signal?: AbortSignal,
): DeclarationToUpdate[] {
	signal?.throwIfAborted();
	const results: DeclarationToUpdate[] = [];
	const targetFilePath = targetFile.getFilePath();
	const uniqueDeclarations = new Set<ImportDeclaration | ExportDeclaration>();

	signal?.throwIfAborted();
	const referencingSourceFiles = targetFile.getReferencingSourceFiles();
	signal?.throwIfAborted();

	for (const referencingFile of referencingSourceFiles) {
		signal?.throwIfAborted();
		const referencingFilePath = referencingFile.getFilePath();

		const declarations = [
			...referencingFile.getImportDeclarations(),
			...referencingFile.getExportDeclarations(),
		];

		for (const declaration of declarations) {
			if (uniqueDeclarations.has(declaration)) continue;

			const moduleSpecifier = declaration.getModuleSpecifier();
			if (!moduleSpecifier) continue;

			const specifierSourceFile = declaration.getModuleSpecifierSourceFile();

			if (specifierSourceFile?.getFilePath() === targetFilePath) {
				const originalSpecifierText = moduleSpecifier.getLiteralText();
				if (originalSpecifierText) {
					results.push({
						declaration,
						resolvedPath: targetFilePath,
						referencingFilePath,
						originalSpecifierText,
					});
					uniqueDeclarations.add(declaration);
				}
			}
		}
	}
	return results;
}

/**
 * Finds all Import/Export declarations that reference the target directory or files within it.
 */
export function findDeclarationsReferencingDirectory(
	project: Project,
	targetDirectory: Directory,
): DeclarationToUpdate[] {
	const results: DeclarationToUpdate[] = [];
	const oldDirectoryPath = targetDirectory.getPath();
	const uniqueDeclarations = new Set<ImportDeclaration | ExportDeclaration>();

	for (const sourceFile of project.getSourceFiles()) {
		const referencingFilePath = sourceFile.getFilePath();
		if (referencingFilePath.startsWith(oldDirectoryPath + path.sep)) {
			continue;
		}

		const declarations = [
			...sourceFile.getImportDeclarations(),
			...sourceFile.getExportDeclarations(),
		];

		for (const declaration of declarations) {
			if (uniqueDeclarations.has(declaration)) continue;

			const moduleSpecifier = declaration.getModuleSpecifier();
			if (!moduleSpecifier) continue;

			const originalSpecifierText = moduleSpecifier.getLiteralText();

			const resolvedSourceFile = declaration.getModuleSpecifierSourceFile();
			if (!resolvedSourceFile) continue;

			const resolvedPath = resolvedSourceFile.getFilePath();

			if (
				resolvedPath.startsWith(oldDirectoryPath + path.sep) ||
				resolvedPath === oldDirectoryPath
			) {
				if (originalSpecifierText) {
					results.push({
						declaration,
						resolvedPath,
						referencingFilePath,
						originalSpecifierText,
					});
					uniqueDeclarations.add(declaration);
				}
			}
		}
	}
	return results;
}
