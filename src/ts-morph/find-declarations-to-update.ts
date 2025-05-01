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
 * Finds all Import/Export declarations that reference the target file.
 */
export async function findDeclarationsReferencingFile(
	targetFile: SourceFile,
	signal?: AbortSignal,
): Promise<DeclarationToUpdate[]> {
	signal?.throwIfAborted();
	const results: DeclarationToUpdate[] = [];
	const targetFilePath = targetFile.getFilePath();
	const project = targetFile.getProject();
	const projectRoot = project.getRootDirectories()[0]?.getPath() ?? "";
	const tsConfigPaths = getTsConfigPaths(project);

	if (!projectRoot) {
		logger.warn(
			"Could not determine project root. Text search might be inaccurate.",
		);
		// projectRoot が不明な場合、フォールバックとして元の実装を使うか、エラーにするか？
		// ここでは一旦空を返す (要検討)
		return [];
	}

	// 1. テキスト検索で候補ファイルリストを取得
	const potentialFiles = await findPotentialReferencingFiles(
		targetFilePath,
		projectRoot,
		signal,
	);

	// 2. 候補ファイルを ts-morph で解析
	const uniqueDeclarations = new Set<ImportDeclaration | ExportDeclaration>();

	for (const potentialFilePath of potentialFiles) {
		signal?.throwIfAborted();
		try {
			const referencingFile = project.getSourceFile(potentialFilePath);
			if (!referencingFile) continue; // プロジェクトに含まれないファイルはスキップ

			const declarations = [
				...referencingFile.getImportDeclarations(),
				...referencingFile.getExportDeclarations(),
			];

			if (declarations.length === 0) continue;

			for (const declaration of declarations) {
				signal?.throwIfAborted();
				if (uniqueDeclarations.has(declaration)) continue;

				const moduleSpecifier = declaration.getModuleSpecifier();
				if (!moduleSpecifier) continue;

				// ここで本当に参照しているか確認
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
							referencingFilePath: potentialFilePath,
							originalSpecifierText,
							wasPathAlias,
						});
						uniqueDeclarations.add(declaration);
					}
				}
			}
		} catch (err) {
			logger.warn(
				{ file: potentialFilePath, err },
				"Error processing potential referencing file",
			);
		}
	}

	logger.trace(
		{ foundCount: results.length, potentialCount: potentialFiles.size },
		"Finished processing potential referencing files",
	);
	return results;
}
