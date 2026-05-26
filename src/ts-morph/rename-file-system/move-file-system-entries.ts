import { performance } from "node:perf_hooks";
import type { Project } from "ts-morph";
import logger from "../../utils/logger";
import type { PathMapping, RenameOperation } from "../types";
import { withSkippedTsMorphReferenceUpdates } from "./_utils/skip-ts-morph-ref-update";

/**
 * 旧実装は全 rename を per-file `sourceFile.move()` に展開していたが、ts-morph の
 * 当該 API は move ごとに「自身を参照する literal を全プロジェクトから探して書き換える」
 * 処理を走らせる。これが N ファイル × O(project) で爆発し、大規模 monorepo の
 * ディレクトリ rename で 6 分以上かかる原因だった (実測 369s for 34 files)。
 *
 * 本実装の高速化アプローチ:
 *  1. ディレクトリ rename はまとめて `Directory.move()` を使う (内部のバッチ最適化を活用)
 *  2. その間 ts-morph 内部の reference-update を no-op 化する monkey-patch を適用。
 *     更新は呼び出し側の `updateModuleSpecifiers` が引き続き担当する (二重実行を解消)
 *
 * 結果として 369s → ~35s (約 10 倍速)、total では 379s → 44s (約 8.6 倍速) を確認。
 *
 * fallback: in-memory FS テスト等で `directoryExistsSync` が false の場合は
 * `Directory.move()` の queueMoveDirectory が flush 時に失敗するため、
 * その directory rename は per-file move に流す。
 */
export function moveFileSystemEntries(
	project: Project,
	renameOperations: RenameOperation[],
	directoryRenames: PathMapping[],
	signal?: AbortSignal,
) {
	const startTime = performance.now();
	signal?.throwIfAborted();
	const fs = project.getFileSystem();

	const filesCoveredByDirMove = new Set<string>();
	const dirRenamesViaBatch: PathMapping[] = [];

	for (const { oldPath, newPath } of directoryRenames) {
		const dir = project.getDirectory(oldPath);
		if (!dir) continue;
		if (fs.directoryExistsSync(oldPath)) {
			dirRenamesViaBatch.push({ oldPath, newPath });
			for (const sf of dir.getDescendantSourceFiles()) {
				filesCoveredByDirMove.add(sf.getFilePath());
			}
		}
	}

	logger.debug(
		{
			totalOperations: renameOperations.length,
			directoryRenameCount: directoryRenames.length,
			directoryBatchCount: dirRenamesViaBatch.length,
			filesCoveredByDirMove: filesCoveredByDirMove.size,
		},
		"Starting file system moves",
	);

	withSkippedTsMorphReferenceUpdates(project, () => {
		for (const { oldPath, newPath } of dirRenamesViaBatch) {
			signal?.throwIfAborted();
			const dir = project.getDirectory(oldPath);
			if (!dir) continue;
			try {
				dir.move(newPath);
			} catch (err) {
				logger.error(
					{ err, from: oldPath, to: newPath },
					"Error during directory.move()",
				);
				throw err;
			}
		}

		for (const { sourceFile, newPath, oldPath } of renameOperations) {
			signal?.throwIfAborted();
			if (filesCoveredByDirMove.has(oldPath)) continue;
			logger.trace({ from: oldPath, to: newPath }, "Moving file");
			try {
				sourceFile.move(newPath);
			} catch (err) {
				logger.error(
					{ err, from: oldPath, to: newPath },
					"Error during sourceFile.move()",
				);
				throw err;
			}
		}
	});

	const durationMs = (performance.now() - startTime).toFixed(2);
	logger.debug({ durationMs }, "Finished file system moves");
}
