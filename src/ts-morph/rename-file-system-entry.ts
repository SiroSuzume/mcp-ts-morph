import type { Project, Directory } from "ts-morph";
import * as path from "node:path";
import {
	initializeProject,
	getChangedFiles,
	saveProjectChanges,
} from "./ts-morph-project";

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

	const sourceFile = project.getSourceFile(absoluteOldPath);
	let directory: Directory | undefined;
	if (!sourceFile) {
		directory = project.getDirectory(absoluteOldPath);
	}

	if (sourceFile) {
		sourceFile.move(absoluteNewPath);
	} else if (directory) {
		directory.move(absoluteNewPath);
	} else {
		const filePaths = project.getSourceFiles().map((sf) => sf.getFilePath());
		const fileList =
			filePaths.length > 0
				? `\nProject files:\n - ${filePaths.join("\n - ")}`
				: "(No files found in project)";
		throw new Error(
			`リネーム対象が見つかりません: ${absoluteOldPath}.${fileList}`,
		);
	}
}

/**
 * 指定された単一のファイルまたはフォルダをリネームし、プロジェクト内の参照を更新する。
 *
 * @param tsconfigPath tsconfig.jsonへの絶対パス
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
	tsconfigPath,
	oldPath,
	newPath,
	dryRun = false,
}: {
	tsconfigPath: string;
	oldPath: string;
	newPath: string;
	dryRun?: boolean;
}): Promise<{ changedFiles: string[] }> {
	const absoluteTsconfigPath = path.resolve(tsconfigPath);
	const project = initializeProject(absoluteTsconfigPath);

	try {
		executeSingleRename(project, oldPath, newPath);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(
			`リネーム処理中にエラーが発生しました (${oldPath} -> ${newPath}): ${message}`,
		);
	}

	const changedFiles = getChangedFiles(project);

	if (!dryRun && changedFiles.length > 0) {
		await saveProjectChanges(project);
	}

	return { changedFiles: changedFiles.map((f) => f.getFilePath()) };
}
