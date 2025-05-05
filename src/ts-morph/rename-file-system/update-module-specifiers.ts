import logger from "../../utils/logger";
import { calculateRelativePath } from "../_utils/calculate-relative-path";
import type { DeclarationToUpdate, RenameOperation } from "../types";
import * as path from "node:path";
import { performance } from "node:perf_hooks";

function findNewPath(
	oldFilePath: string,
	renameOperations: RenameOperation[],
): string | undefined {
	const operation = renameOperations.find((op) => op.oldPath === oldFilePath);
	return operation?.newPath;
}

export function updateModuleSpecifiers(
	allDeclarationsToUpdate: DeclarationToUpdate[],
	renameOperations: RenameOperation[],
	signal?: AbortSignal,
) {
	signal?.throwIfAborted();
	const startTime = performance.now();
	const PRESERVE_EXTENSIONS = [".js", ".jsx", ".json", ".mjs", ".cjs"];
	logger.debug(
		{ count: allDeclarationsToUpdate.length },
		"Starting module specifier updates",
	);

	let updatedCount = 0;
	let skippedCount = 0;

	for (const {
		declaration,
		resolvedPath,
		referencingFilePath,
		originalSpecifierText,
		wasPathAlias,
	} of allDeclarationsToUpdate) {
		signal?.throwIfAborted();
		const moduleSpecifier = declaration.getModuleSpecifier();
		if (!moduleSpecifier) {
			skippedCount++;
			logger.trace(
				{ referencingFilePath, kind: declaration.getKindName() },
				"Skipping declaration with no module specifier",
			);
			continue;
		}

		const newReferencingFilePath =
			findNewPath(referencingFilePath, renameOperations) ?? referencingFilePath;
		const newResolvedPath = findNewPath(resolvedPath, renameOperations);

		if (!newResolvedPath) {
			skippedCount++;
			logger.warn(
				{ resolvedPath, referencingFilePath: newReferencingFilePath },
				"Could not determine new path for resolved path - Skipping update.",
			);
			continue;
		}

		// TODO: wasPathAlias を使ってエイリアスパスを計算・維持するロジックを追加
		let newSpecifier: string;

		// 元のインポートスタイルで index が省略されていたか判定
		// (例: './utils', '../', '@/')
		// 注意: これは単純な判定であり、複雑なケースには対応できない可能性あり
		const wasIndexSimplified =
			/(\/|\/[^/.]+)$/.test(originalSpecifierText) ||
			!path.extname(originalSpecifierText);
		logger.trace(
			{ originalSpecifierText, wasIndexSimplified },
			"Checked original specifier for index simplification",
		);

		if (wasPathAlias) {
			// --- パスエイリアスを維持するロジック (仮) ---
			// 現時点では calculateRelativePath を使うが、将来的にはエイリアス計算に置き換える
			// tsconfig の paths と baseUrl が必要
			logger.warn(
				{
					refFile: newReferencingFilePath,
					newResolved: newResolvedPath,
					originalSpecifier: originalSpecifierText,
				},
				"Path alias preservation not fully implemented yet. Calculating relative path as fallback.",
			);
			// ★★★ ここでエイリアスパスを計算するロジックが必要 ★★★
			// 例: const newAliasPath = calculateAliasPath(project, newReferencingFilePath, newResolvedPath);
			// 仮に相対パスを計算。元のスタイルに合わせて simplifyIndex を設定。
			newSpecifier = calculateRelativePath(
				newReferencingFilePath,
				newResolvedPath,
				{
					removeExtensions: !PRESERVE_EXTENSIONS.includes(
						path.extname(originalSpecifierText),
					),
					simplifyIndex: wasIndexSimplified, // 元のスタイルに合わせる
				},
			);
		} else {
			// --- 相対パスなど、エイリアス以外の場合 ---
			newSpecifier = calculateRelativePath(
				newReferencingFilePath,
				newResolvedPath,
				{
					removeExtensions: !PRESERVE_EXTENSIONS.includes(
						path.extname(originalSpecifierText),
					),
					simplifyIndex: wasIndexSimplified, // 元のスタイルに合わせる
				},
			);
		}

		try {
			// 計算した newSpecifier を設定
			declaration.setModuleSpecifier(newSpecifier);
			updatedCount++;
		} catch (err) {
			skippedCount++;
			logger.error(
				{
					err,
					refFile: newReferencingFilePath,
					newResolved: newResolvedPath,
					originalSpecifier: originalSpecifierText,
					wasPathAlias,
					newSpecifier, // newRelativePath から変更
				},
				"Error setting module specifier, skipping update",
			);
		}
	}

	const durationMs = (performance.now() - startTime).toFixed(2);
	logger.debug(
		{ updated: updatedCount, skipped: skippedCount, durationMs },
		"Finished module specifier updates",
	);
}
