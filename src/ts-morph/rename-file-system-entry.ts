import type { Project } from "ts-morph";
import * as path from "node:path";
import { getChangedFiles, saveProjectChanges } from "./ts-morph-project";
import { findDeclarationsReferencingFile } from "./find-declarations-to-update";
import { calculateRelativePath } from "./calculate-relative-path";
import type {
	PathMapping,
	RenameOperation,
	DeclarationToUpdate,
} from "./types";

// <<< ヘルパー関数群 >>>

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
	signal?.throwIfAborted();
	const renameOperations: RenameOperation[] = [];
	const uniqueNewPaths = new Set<string>();

	for (const rename of renames) {
		signal?.throwIfAborted();

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
			renameOperations.push({
				sourceFile,
				oldPath: absoluteOldPath,
				newPath: absoluteNewPath,
			});
		} else if (directory) {
			signal?.throwIfAborted();
			const filesInDir = directory.getDescendantSourceFiles();
			for (const sf of filesInDir) {
				const oldFilePath = sf.getFilePath();
				const relative = path.relative(absoluteOldPath, oldFilePath);
				const newFilePath = path.resolve(absoluteNewPath, relative);
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
	return renameOperations;
}

/**
 * 移動対象ファイル群への参照を全て特定し、ユニークなリストにして返す。
 */
function findAllDeclarationsToUpdate(
	renameOperations: RenameOperation[],
	signal?: AbortSignal,
): DeclarationToUpdate[] {
	signal?.throwIfAborted();
	let allDeclarationsToUpdate: DeclarationToUpdate[] = [];
	for (const { sourceFile } of renameOperations) {
		signal?.throwIfAborted();
		const declarations = findDeclarationsReferencingFile(sourceFile, signal);
		allDeclarationsToUpdate.push(...declarations);
	}
	allDeclarationsToUpdate = Array.from(
		new Map(
			allDeclarationsToUpdate.map((d) => [
				`${d.declaration.getPos()}-${d.declaration.getEnd()}`,
				d,
			]),
		).values(),
	);
	return allDeclarationsToUpdate;
}

/**
 * SourceFile オブジェクトを新しいパスに移動する。
 */
function moveFileSystemEntries(
	renameOperations: RenameOperation[],
	signal?: AbortSignal,
) {
	signal?.throwIfAborted();
	for (const { sourceFile, newPath } of renameOperations) {
		signal?.throwIfAborted();
		sourceFile.move(newPath);
	}
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
	const PRESERVE_EXTENSIONS = [".js", ".jsx", ".json", ".mjs", ".cjs"];

	for (const {
		declaration,
		resolvedPath,
		referencingFilePath,
		originalSpecifierText,
	} of allDeclarationsToUpdate) {
		signal?.throwIfAborted();
		const moduleSpecifier = declaration.getModuleSpecifier();
		if (!moduleSpecifier) continue;

		const newReferencingFilePath =
			findNewPath(referencingFilePath, renameOperations) ?? referencingFilePath;
		const newResolvedPath = findNewPath(resolvedPath, renameOperations);

		if (!newResolvedPath) {
			console.warn(
				`[rename] Could not determine new path for resolved path: ${resolvedPath} (referenced from ${newReferencingFilePath}) - Skipping update.`,
			);
			continue;
		}

		const originalExt = path.extname(originalSpecifierText);
		const shouldPreserveExt = PRESERVE_EXTENSIONS.includes(originalExt);

		const finalPath = calculateRelativePath(
			newReferencingFilePath,
			newResolvedPath,
			{
				removeExtensions: !shouldPreserveExt,
				simplifyIndex: true,
			},
		);
		moduleSpecifier.setLiteralValue(finalPath);
	}
}

// <<< メイン関数 >>>

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
	try {
		signal?.throwIfAborted();

		// 1. 事前準備
		const renameOperations = prepareRenames(project, renames, signal);
		signal?.throwIfAborted();

		// 2. 更新対象の参照を移動前に特定
		const allDeclarationsToUpdate = findAllDeclarationsToUpdate(
			renameOperations,
			signal,
		);
		signal?.throwIfAborted();

		// 3. 全ファイルを移動
		moveFileSystemEntries(renameOperations, signal);
		signal?.throwIfAborted();

		// 4. 移動後に参照を更新
		updateModuleSpecifiers(allDeclarationsToUpdate, renameOperations, signal);
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") {
			throw error;
		}
		const errorMessage = error instanceof Error ? error.message : String(error);
		throw new Error(`リネーム処理中にエラーが発生しました: ${errorMessage}`);
	}

	// 5. 変更の保存 (dryRun でなければ)
	const changed = getChangedFiles(project);
	const changedFilePaths = changed.map((f) => f.getFilePath());

	if (!dryRun && changed.length > 0) {
		signal?.throwIfAborted();
		await saveProjectChanges(project, signal);
	}

	return { changedFiles: changedFilePaths };
}
