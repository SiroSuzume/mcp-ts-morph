import logger from "../../utils/logger";
import type { PathMapping, RenameOperation } from "../types";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import type { Project } from "ts-morph";

function checkDestinationExists(
	project: Project,
	pathToCheck: string,
	signal?: AbortSignal,
): void {
	signal?.throwIfAborted();
	if (project.getSourceFile(pathToCheck)) {
		throw new Error(`リネーム先パスに既にファイルが存在します: ${pathToCheck}`);
	}
	if (project.getDirectory(pathToCheck)) {
		throw new Error(
			`リネーム先パスに既にディレクトリが存在します: ${pathToCheck}`,
		);
	}
}

export function prepareRenames(
	project: Project,
	renames: PathMapping[],
	signal?: AbortSignal,
): RenameOperation[] {
	const startTime = performance.now();
	signal?.throwIfAborted();
	const renameOperations: RenameOperation[] = [];
	const uniqueNewPaths = new Set<string>();
	logger.debug({ count: renames.length }, "Starting rename preparation");

	for (const rename of renames) {
		signal?.throwIfAborted();
		const logRename = { old: rename.oldPath, new: rename.newPath };
		logger.trace({ rename: logRename }, "Processing rename request");

		const absoluteOldPath = path.resolve(rename.oldPath);
		const absoluteNewPath = path.resolve(rename.newPath);

		if (uniqueNewPaths.has(absoluteNewPath)) {
			throw new Error(`リネーム先のパスが重複しています: ${absoluteNewPath}`);
		}
		uniqueNewPaths.add(absoluteNewPath);

		checkDestinationExists(project, absoluteNewPath, signal);

		signal?.throwIfAborted();
		const sourceFile = project.getSourceFile(absoluteOldPath);
		const directory = project.getDirectory(absoluteOldPath);

		if (sourceFile) {
			logger.trace({ path: absoluteOldPath }, "Identified as file rename");
			renameOperations.push({
				sourceFile,
				oldPath: absoluteOldPath,
				newPath: absoluteNewPath,
			});
		} else if (directory) {
			logger.trace({ path: absoluteOldPath }, "Identified as directory rename");
			signal?.throwIfAborted();
			const filesInDir = directory.getDescendantSourceFiles();
			logger.trace(
				{ path: absoluteOldPath, count: filesInDir.length },
				"Found files in directory to rename",
			);
			for (const sf of filesInDir) {
				const oldFilePath = sf.getFilePath();
				const relative = path.relative(absoluteOldPath, oldFilePath);
				const newFilePath = path.resolve(absoluteNewPath, relative);
				logger.trace(
					{ oldFile: oldFilePath, newFile: newFilePath },
					"Adding directory file to rename operations",
				);
				renameOperations.push({
					sourceFile: sf,
					oldPath: oldFilePath,
					newPath: newFilePath,
				});
			}
		} else {
			throw new Error(`リネーム対象が見つかりません: ${absoluteOldPath}`);
		}
	}
	const durationMs = (performance.now() - startTime).toFixed(2);
	logger.debug(
		{ operationCount: renameOperations.length, durationMs },
		"Finished rename preparation",
	);
	return renameOperations;
}
