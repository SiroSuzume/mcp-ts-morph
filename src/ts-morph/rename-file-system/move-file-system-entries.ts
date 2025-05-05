import logger from "../../utils/logger";
import type { RenameOperation } from "../types";
import { performance } from "node:perf_hooks";

export function moveFileSystemEntries(
	renameOperations: RenameOperation[],
	signal?: AbortSignal,
) {
	const startTime = performance.now();
	signal?.throwIfAborted();
	logger.debug(
		{ count: renameOperations.length },
		"Starting file system moves",
	);
	for (const { sourceFile, newPath, oldPath } of renameOperations) {
		signal?.throwIfAborted();
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
	const durationMs = (performance.now() - startTime).toFixed(2);
	logger.debug({ durationMs }, "Finished file system moves");
}
