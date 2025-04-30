import type { Project } from "ts-morph";
import * as path from "node:path";
import { getChangedFiles, saveProjectChanges } from "./ts-morph-project";
import {
	findDeclarationsReferencingDirectory,
	findDeclarationsReferencingFile,
	type DeclarationToUpdate,
} from "./find-declarations-to-update";

/**
 * モジュール指定子用の相対パスを計算する
 * fromPath: 参照元ファイルの絶対パス
 * toPath: 参照先ファイルの絶対パス (リネーム後の新しいパス)
 */
function calculateRelativePath(fromPath: string, toPath: string): string {
	const relative = path.relative(path.dirname(fromPath), toPath);
	const formatted = relative.startsWith(".") ? relative : `./${relative}`;
	// 拡張子 '.ts', '.tsx' のみを削除 (元に戻す)
	return formatted.replace(/\.(ts|tsx)$/, "");
}

/**
 * 更新が必要な宣言リストに基づいて、モジュール指定子を更新する。
 */
function updateModuleSpecifiers(
	declarationsToUpdate: DeclarationToUpdate[],
	newAbsolutePath: string,
): void {
	for (const {
		declaration,
		resolvedPath,
		referencingFilePath,
	} of declarationsToUpdate) {
		const moduleSpecifier = declaration.getModuleSpecifier();
		// moduleSpecifier がないケースは declarationsToUpdate に含まれないはずだが、念のためチェック
		if (!moduleSpecifier) continue;

		// ファイルリネームの場合、resolvedPath は旧ファイルパス、newAbsolutePath は新ファイルパス
		// ディレクトリリネームの場合、resolvedPath は旧ディレクトリ内のファイルパス、
		// newAbsolutePath は新ディレクトリのパス
		let newResolvedPath: string;
		if (path.extname(newAbsolutePath)) {
			// Check if new path is a file
			newResolvedPath = newAbsolutePath; // File rename
		} else {
			// Directory rename: Calculate new resolved path based on old resolved path relative to old dir
			const oldDirectoryPath = path.dirname(resolvedPath); // Assuming resolvedPath is inside the dir
			const relativePathInDir = path.relative(oldDirectoryPath, resolvedPath);
			newResolvedPath = path.join(newAbsolutePath, relativePathInDir);
		}

		const newRelativePath = calculateRelativePath(
			referencingFilePath,
			newResolvedPath,
		);

		moduleSpecifier.setLiteralValue(newRelativePath);
	}
}

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
 * 単一のファイルまたはフォルダのリネーム操作を実行する (メモリ上)
 * @param project ts-morphプロジェクトインスタンス
 * @param oldPath リネーム元の絶対パス
 * @param newPath リネーム先の絶対パス
 * @throws リネーム対象が見つからない場合にエラー
 */
function executeSingleRename(
	project: Project,
	oldPath: string,
	newPath: string,
): void {
	const absoluteOldPath = path.resolve(oldPath);
	const absoluteNewPath = path.resolve(newPath);

	checkDestinationExists(project, absoluteNewPath);

	const sourceFile = project.getSourceFile(absoluteOldPath);
	if (sourceFile) {
		const declarationsToUpdate = findDeclarationsReferencingFile(sourceFile);
		updateModuleSpecifiers(declarationsToUpdate, absoluteNewPath);
		sourceFile.move(absoluteNewPath);
		return;
	}

	const directory = project.getDirectory(absoluteOldPath);
	if (directory) {
		const declarationsToUpdate = findDeclarationsReferencingDirectory(
			project,
			directory,
		);
		updateModuleSpecifiers(declarationsToUpdate, absoluteNewPath);
		directory.move(absoluteNewPath);
		return;
	}

	const filePaths = project.getSourceFiles().map((sf) => sf.getFilePath());
	const fileList =
		filePaths.length > 0
			? `\nProject files:\n - ${filePaths.join("\n - ")}`
			: "(No files found in project)";
	throw new Error(
		`リネーム対象が見つかりません: ${absoluteOldPath}.${fileList}`,
	);
}

/**
 * 指定された単一のファイルまたはフォルダをリネームし、プロジェクト内の参照を更新する。
 *
 * @param project ts-morph プロジェクトインスタンス
 * @param oldPath リネーム元のファイル/フォルダへの絶対パス
 * @param newPath リネーム先のファイル/フォルダへの絶対パス
 * @param dryRun trueの場合、ファイルシステムへの変更を保存せずに、変更されるファイルのリストのみを返す
 * @returns 変更されたファイルの絶対パスのリスト
 * @throws リネーム処理中にエラーが発生した場合
 *
 * @remarks
 * - **注意:** パスエイリアス (`@/` など) や ディレクトリの `index.ts` を参照する相対パス (`import from '.'`) を含む import/export 文の更新は、現在の `ts-morph` の実装では不完全な場合があります。リネーム後に手動での確認・修正が必要になる可能性があります。
 * - エラーが発生した場合、ファイルシステムは変更されません (dryRun=false の場合)。
 */
export async function renameFileSystemEntry({
	project,
	oldPath,
	newPath,
	dryRun = false,
}: {
	project: Project;
	oldPath: string;
	newPath: string;
	dryRun?: boolean;
}): Promise<{ changedFiles: string[] }> {
	try {
		executeSingleRename(project, oldPath, newPath);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(
			`リネーム処理中にエラーが発生しました (${oldPath} -> ${newPath}): ${message}`,
		);
	}

	const changed = getChangedFiles(project);
	const changedFilePaths = changed
		.map((f) => f.getFilePath())
		.filter((p) => !p.endsWith("tsconfig.json"));

	if (!dryRun && changed.length > 0) {
		await saveProjectChanges(project);
	}

	return { changedFiles: changedFilePaths };
}
