import * as path from "node:path";
import { performance } from "node:perf_hooks";
import type { Project } from "ts-morph";
import logger from "../../utils/logger";
import { findDeclarationsReferencingFile } from "../_utils/find-declarations-to-update";
import {
	getChangedFiles,
	saveProjectChanges,
} from "../_utils/ts-morph-project";
import type {
	DeclarationToUpdate,
	PathMapping,
	RenameOperation,
} from "../types";
import { moveFileSystemEntries } from "./move-file-system-entries";
import { prepareRenames } from "./prepare-renames";
import { updateModuleSpecifiers } from "./update-module-specifiers";

/**
 * 移動対象ファイル群への参照を全て特定し、ユニークなリストにして返す。
 * (ts-morph の getReferencingSourceFiles を使用)
 */
async function findAllDeclarationsToUpdate(
	renameOperations: RenameOperation[],
	signal?: AbortSignal,
): Promise<DeclarationToUpdate[]> {
	signal?.throwIfAborted();
	const startTime = performance.now();
	let allDeclarationsToUpdate: DeclarationToUpdate[] = [];
	const operationPaths = renameOperations.map((op) => op.oldPath);
	logger.debug(
		{ count: renameOperations.length, paths: operationPaths },
		"Finding declarations referencing renamed items",
	);

	// 並列化のため Promise.all を使用
	const declarationPromises = renameOperations.map(({ sourceFile }) => {
		signal?.throwIfAborted();
		return findDeclarationsReferencingFile(sourceFile, signal).then(
			(declarations) => {
				logger.trace(
					{ file: sourceFile.getFilePath(), count: declarations.length },
					"Found declarations for file",
				);
				return declarations;
			},
		);
	});

	const resultsArray = await Promise.all(declarationPromises);
	allDeclarationsToUpdate = resultsArray.flat();

	const uniqueDeclarations = Array.from(
		new Map(
			allDeclarationsToUpdate.map((d) => [
				`${d.declaration.getPos()}-${d.declaration.getEnd()}`,
				d,
			]),
		).values(),
	);

	if (logger.level === "debug" || logger.level === "trace") {
		const logData = uniqueDeclarations.map((decl) => ({
			file: decl.referencingFilePath,
			specifier: decl.originalSpecifierText,
			resolvedPath: decl.resolvedPath,
			kind: decl.declaration.getKindName(),
		}));
		const durationMs = (performance.now() - startTime).toFixed(2);
		logger.debug(
			{ declarationCount: uniqueDeclarations.length, durationMs },
			"Finished finding declarations to update",
		);
		if (uniqueDeclarations.length > 0) {
			logger.trace({ declarations: logData }, "Detailed declarations found");
		}
	}

	return uniqueDeclarations;
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
