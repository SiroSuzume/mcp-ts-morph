import * as path from "node:path";
import { performance } from "node:perf_hooks";
import type { Project } from "ts-morph";
import logger from "../../utils/logger";
import {
	getChangedFiles,
	getTsConfigPaths,
	saveProjectChanges,
} from "../_utils/ts-morph-project";
import type {
	DeclarationToUpdate,
	PathMapping,
	RenameOperation,
} from "../types";
import { checkIsPathAlias } from "./_utils/check-is-path-alias";
import { findDeclarationsForRenameOperation } from "./_utils/find-declarations-for-rename-operation";
import { moveFileSystemEntries } from "./move-file-system-entries";
import { prepareRenames } from "./prepare-renames";
import { updateModuleSpecifiers } from "./update-module-specifiers";

/**
 * [実験的] 移動対象ファイルのエクスポートシンボルを参照するすべての宣言を特定し、
 * ユニークな DeclarationToUpdate のリストにして返す。
 */
async function findAllDeclarationsToUpdate(
	project: Project,
	renameOperations: RenameOperation[],
	signal?: AbortSignal,
): Promise<DeclarationToUpdate[]> {
	signal?.throwIfAborted();
	const startTime = performance.now();
	const allFoundDeclarationsMap = new Map<string, DeclarationToUpdate>();
	const tsConfigPaths = getTsConfigPaths(project);

	logger.debug(
		{
			count: renameOperations.length,
			paths: renameOperations.map((op) => op.oldPath),
		},
		"[Experimental] Finding declarations referencing exported symbols of renamed items",
	);

	for (const renameOperation of renameOperations) {
		signal?.throwIfAborted();
		const { oldPath: renamedFilePath } = renameOperation;

		const declarationsFound = findDeclarationsForRenameOperation(
			renameOperation,
			signal,
		);

		for (const declaration of declarationsFound) {
			const referencingFilePath = declaration.getSourceFile().getFilePath();
			const mapKey = `${referencingFilePath}-${declaration.getPos()}-${declaration.getEnd()}`;
			if (allFoundDeclarationsMap.has(mapKey)) {
				continue;
			}

			const originalSpecifierText = declaration.getModuleSpecifierValue();
			if (!originalSpecifierText) continue;

			const wasPathAlias = checkIsPathAlias(
				originalSpecifierText,
				tsConfigPaths,
			);

			allFoundDeclarationsMap.set(mapKey, {
				declaration,
				resolvedPath: renamedFilePath,
				referencingFilePath,
				originalSpecifierText,
				wasPathAlias,
			});
		}
	}

	const uniqueDeclarationsToUpdate = Array.from(
		allFoundDeclarationsMap.values(),
	);

	if (logger.level === "debug" || logger.level === "trace") {
		const logData = uniqueDeclarationsToUpdate.map((decl) => ({
			referencingFile: decl.referencingFilePath,
			originalSpecifier: decl.originalSpecifierText,
			resolvedPath: decl.resolvedPath,
			kind: decl.declaration.getKindName(),
		}));
		const durationMs = (performance.now() - startTime).toFixed(2);
		logger.debug(
			{ declarationCount: uniqueDeclarationsToUpdate.length, durationMs },
			"[Experimental] Finished finding declarations to update via symbols",
		);
		if (uniqueDeclarationsToUpdate.length > 0) {
			logger.trace(
				{ declarations: logData },
				"Detailed declarations found via symbols",
			);
		}
	}

	return uniqueDeclarationsToUpdate;
}

/**
 * 指定された複数のファイルまたはフォルダをリネームし、プロジェクト内の参照を更新する。
 *
 * @param project ts-morph プロジェクトインスタンス
 * @param renames リネーム対象のパスのペア ({ oldPath: string, newPath: string }) の配列
 * @param dryRun trueの場合、ファイルシステムへの変更を保存せずに、変更されるファイルのリストのみを返す
 * @param signal オプショナルな AbortSignal。処理をキャンセルするために使用できる
 * @returns 変更されたファイルの絶対パスのリスト
 * @throws リネーム処理中にエラーが発生した場合、または signal によってキャンセルされた場合
 */
export async function renameFileSystemEntry({
	project,
	renames,
	dryRun = false,
	signal,
}: {
	project: Project;
	renames: PathMapping[];
	dryRun?: boolean;
	signal?: AbortSignal;
}): Promise<{ changedFiles: string[] }> {
	const mainStartTime = performance.now();
	const logProps = {
		renames: renames.map((r) => ({
			old: path.basename(r.oldPath),
			new: path.basename(r.newPath),
		})),
		dryRun,
	};
	logger.info({ props: logProps }, "renameFileSystemEntry started");

	let changedFilePaths: string[] = [];
	let errorOccurred = false;
	let errorMessage = "";

	try {
		signal?.throwIfAborted();

		const renameOperations = prepareRenames(project, renames, signal);
		signal?.throwIfAborted();

		const allDeclarationsToUpdate = await findAllDeclarationsToUpdate(
			project,
			renameOperations,
			signal,
		);
		signal?.throwIfAborted();

		moveFileSystemEntries(renameOperations, signal);
		signal?.throwIfAborted();

		updateModuleSpecifiers(allDeclarationsToUpdate, renameOperations, signal);

		const saveStart = performance.now();
		const changed = getChangedFiles(project);
		changedFilePaths = changed.map((f) => f.getFilePath());

		if (!dryRun && changed.length > 0) {
			signal?.throwIfAborted();
			await saveProjectChanges(project, signal);
			logger.debug(
				{
					count: changed.length,
					durationMs: (performance.now() - saveStart).toFixed(2),
				},
				"Saved project changes",
			);
		} else if (dryRun) {
			logger.info({ count: changed.length }, "Dry run: Skipping save");
		} else {
			logger.info("No changes detected to save");
		}
	} catch (error) {
		errorOccurred = true;
		errorMessage = error instanceof Error ? error.message : String(error);
		logger.error(
			{ err: error, props: logProps },
			`Error during rename process: ${errorMessage}`,
		);
		if (error instanceof Error && error.name === "AbortError") {
			throw error;
		}
	} finally {
		const durationMs = (performance.now() - mainStartTime).toFixed(2);
		const status = errorOccurred ? "Failure" : "Success";
		logger.info(
			{ status, durationMs, changedFileCount: changedFilePaths.length },
			"renameFileSystemEntry finished",
		);
	}

	if (errorOccurred) {
		throw new Error(
			`Rename process failed: ${errorMessage}. See logs for details.`,
		);
	}

	return { changedFiles: changedFilePaths };
}
