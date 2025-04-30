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
function checkDestinationExists(project: Project, pathToCheck: string): void {
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
 * パスの解決、存在チェック、移動対象ファイルの特定とパス情報の紐付けを行う。
 */
function prepareRenames(
	project: Project,
	renames: PathMapping[],
): RenameOperation[] {
	const renameOperations: RenameOperation[] = [];
	const uniqueNewPaths = new Set<string>();

	for (const rename of renames) {
		const absoluteOldPath = path.resolve(rename.oldPath);
		const absoluteNewPath = path.resolve(rename.newPath);

		if (uniqueNewPaths.has(absoluteNewPath)) {
			throw new Error(`リネーム先のパスが重複しています: ${absoluteNewPath}`);
		}
		uniqueNewPaths.add(absoluteNewPath);

		checkDestinationExists(project, absoluteNewPath);

		const sourceFile = project.getSourceFile(absoluteOldPath);
		const directory = project.getDirectory(absoluteOldPath);

		if (sourceFile) {
			renameOperations.push({
				sourceFile,
				oldPath: absoluteOldPath,
				newPath: absoluteNewPath,
			});
		} else if (directory) {
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
): DeclarationToUpdate[] {
	let allDeclarationsToUpdate: DeclarationToUpdate[] = [];
	for (const { sourceFile } of renameOperations) {
		const declarations = findDeclarationsReferencingFile(sourceFile);
		allDeclarationsToUpdate.push(...declarations);
	}
	// 重複を除去
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
function moveFileSystemEntries(renameOperations: RenameOperation[]) {
	for (const { sourceFile, newPath } of renameOperations) {
		sourceFile.move(newPath);
	}
}

/**
 * 移動後に、特定された参照箇所のモジュール指定子を更新する。
 */
function updateModuleSpecifiers(
	allDeclarationsToUpdate: DeclarationToUpdate[],
	renameOperations: RenameOperation[],
) {
	// 拡張子を保持する対象
	const PRESERVE_EXTENSIONS = [".js", ".jsx", ".json", ".mjs", ".cjs"];

	for (const {
		declaration,
		resolvedPath,
		referencingFilePath,
		originalSpecifierText,
	} of allDeclarationsToUpdate) {
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

		// 元の拡張子を確認し、維持すべきか判断
		const originalExt = path.extname(originalSpecifierText);
		const shouldPreserveExt = PRESERVE_EXTENSIONS.includes(originalExt);

		// calculateRelativePath にオプションを渡して最終的なパスを計算
		const finalPath = calculateRelativePath(
			newReferencingFilePath,
			newResolvedPath,
			{
				removeExtensions: !shouldPreserveExt, // 維持しない場合に削除
				simplifyIndex: true, // rename では index を簡略化する (デフォルト)
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
 * @returns 変更されたファイルの絶対パスのリスト
 * @throws リネーム処理中にエラーが発生した場合
 */
export async function renameFileSystemEntry({
	project,
	renames,
	dryRun = false,
}: {
	project: Project;
	renames: PathMapping[];
	dryRun?: boolean;
}): Promise<{ changedFiles: string[] }> {
	try {
		// 1. 事前準備
		const renameOperations = prepareRenames(project, renames);

		// 2. 更新対象の参照を移動前に特定
		const allDeclarationsToUpdate =
			findAllDeclarationsToUpdate(renameOperations);

		// 3. 全ファイルを移動
		moveFileSystemEntries(renameOperations);

		// 4. 移動後に参照を更新
		updateModuleSpecifiers(allDeclarationsToUpdate, renameOperations);
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		throw new Error(`リネーム処理中にエラーが発生しました: ${errorMessage}`);
	}

	// 5. 変更の保存 (dryRun でなければ)
	const changed = getChangedFiles(project);
	const changedFilePaths = changed.map((f) => f.getFilePath());

	if (!dryRun && changed.length > 0) {
		await saveProjectChanges(project);
	}

	return { changedFiles: changedFilePaths };
}
