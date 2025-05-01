import type { Project } from "ts-morph";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import logger from "../utils/logger";
import { getChangedFiles, saveProjectChanges } from "./ts-morph-project";
import { findDeclarationsReferencingFile } from "./find-declarations-to-update";
import { calculateRelativePath } from "./calculate-relative-path";
import type {
	PathMapping,
	RenameOperation,
	DeclarationToUpdate,
} from "./types";

/**
 * リネーム先の存在チェック
 */
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

/**
 * 移動後のパスを探す
 */
function findNewPath(
	oldFilePath: string,
	renameOperations: RenameOperation[],
): string | undefined {
	const operation = renameOperations.find((op) => op.oldPath === oldFilePath);
	return operation?.newPath;
}

/**
 * リネーム操作の事前準備を行う。
 */
function prepareRenames(
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
 * SourceFile オブジェクトを新しいパスに移動する。
 */
function moveFileSystemEntries(
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

/**
 * 移動後に、特定された参照箇所のモジュール指定子を更新する。
 */
function updateModuleSpecifiers(
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
		// if (wasPathAlias) { ... }

		const newRelativePath = calculateRelativePath(
			newReferencingFilePath,
			newResolvedPath,
			{
				removeExtensions: !PRESERVE_EXTENSIONS.includes(
					path.extname(originalSpecifierText),
				),
				simplifyIndex: true,
			},
		);

		try {
			declaration.setModuleSpecifier(newRelativePath);
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
					newRelativePath,
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
