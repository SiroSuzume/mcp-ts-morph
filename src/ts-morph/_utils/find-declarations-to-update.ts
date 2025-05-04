import type {
	SourceFile,
	ImportDeclaration,
	ExportDeclaration,
} from "ts-morph";
import type { DeclarationToUpdate } from "../types";
import { getTsConfigPaths } from "./ts-morph-project";
import logger from "../../utils/logger";

/**
 * モジュール指定子が tsconfig で定義されたパスエイリアスを使用しているかチェックする
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
	const tsConfigPaths = getTsConfigPaths(project);

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

				// 宣言が *実際に* ターゲットファイルに解決されるか確認する
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
