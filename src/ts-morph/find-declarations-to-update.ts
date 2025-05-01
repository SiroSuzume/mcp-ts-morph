import type {
	SourceFile,
	ImportDeclaration,
	ExportDeclaration,
} from "ts-morph";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import fg from "fast-glob";
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
 * リネーム対象のファイル名を含む可能性のあるファイルをテキスト検索で探す。
 * @param oldPath リネーム前のファイルの絶対パス
 * @param projectRoot プロジェクトのルートディレクトリの絶対パス
 * @param signal AbortSignal
 * @returns キーワードを含む可能性のあるファイルの絶対パスの Set
 */
async function findPotentialReferencingFiles(
	oldPath: string,
	projectRoot: string,
	signal?: AbortSignal,
): Promise<Set<string>> {
	signal?.throwIfAborted();
	const searchKeyword = path.basename(oldPath, path.extname(oldPath));
	const searchPattern = path
		.join(projectRoot, "src/**/*.+(ts|tsx)")
		.replace(/\\/g, "/");
	const potentialFiles = new Set<string>();

	logger.trace(
		{ keyword: searchKeyword, pattern: searchPattern },
		"Starting text search for potential referencing files",
	);

	const stream = fg.stream(searchPattern, {
		absolute: true,
		onlyFiles: true,
		ignore: ["**/node_modules/**", "**/.next/**", "**/dist/**"],
		concurrency: 4,
	});

	for await (const entry of stream) {
		signal?.throwIfAborted();
		const filePath = entry.toString();
		try {
			const content = await fs.readFile(filePath, "utf-8");
			if (content.includes(searchKeyword)) {
				potentialFiles.add(filePath);
			}
		} catch (error) {
			// ファイル読み取りエラーは警告ログを出すが、処理は続行
			logger.warn(
				{ file: filePath, err: error },
				"Failed to read file during text search",
			);
		}
	}

	logger.trace({ count: potentialFiles.size }, "Finished text search");
	return potentialFiles;
}

/**
 * Finds all Import/Export declarations that reference the target file
 * using ts-morph's built-in capabilities.
 */
export async function findDeclarationsReferencingFile(
	targetFile: SourceFile,
	signal?: AbortSignal, // Keep signal for potential future cancellation points
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
