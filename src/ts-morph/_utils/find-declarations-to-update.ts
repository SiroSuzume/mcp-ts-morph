import type { SourceFile } from "ts-morph";
import type { DeclarationToUpdate } from "../types";
import { isPathAlias } from "./path-alias";
import { getTsConfigPaths } from "./ts-morph-project";
import logger from "../../utils/logger";

/**
 * ターゲットファイルを参照するすべての Import/Export 宣言を検索する。
 * ts-morph の getReferencingSourceFiles を使用。
 * 注意: バレルファイル (例: index.ts) 経由の再エクスポートによる参照は見つけられない可能性がある。
 */
export async function findDeclarationsReferencingFile(
	targetFile: SourceFile,
	signal?: AbortSignal,
): Promise<DeclarationToUpdate[]> {
	signal?.throwIfAborted();
	const results: DeclarationToUpdate[] = [];
	const targetFilePath = targetFile.getFilePath();
	const project = targetFile.getProject();
	const aliasKeys = Object.keys(getTsConfigPaths(project) ?? {});

	logger.trace(
		{ targetFile: targetFilePath },
		"Starting findDeclarationsReferencingFile using getReferencingSourceFiles",
	);

	// ts-morph の組み込みメソッドを使用して参照元ソースファイルを見つける
	const referencingSourceFiles = targetFile.getReferencingSourceFiles();

	logger.trace(
		{ count: referencingSourceFiles.length },
		"Found referencing source files via ts-morph",
	);

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
				const moduleSpecifier = declaration.getModuleSpecifier();
				if (!moduleSpecifier) continue;

				// 宣言が *実際に* ターゲットファイルに解決されるか確認する
				const specifierSourceFile = declaration.getModuleSpecifierSourceFile();
				if (specifierSourceFile?.getFilePath() !== targetFilePath) continue;

				const originalSpecifierText = moduleSpecifier.getLiteralText();
				if (!originalSpecifierText) continue;

				const wasPathAlias = isPathAlias(originalSpecifierText, aliasKeys);
				results.push({
					declaration,
					resolvedPath: targetFilePath,
					referencingFilePath,
					originalSpecifierText,
					wasPathAlias,
				});
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
