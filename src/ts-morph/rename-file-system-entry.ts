import type { Project } from "ts-morph";
import * as path from "node:path";
import { getChangedFiles, saveProjectChanges } from "./ts-morph-project";
import {
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

		// ファイル/ディレクトリのリネームに応じて、新しい解決済みパスを計算
		let newResolvedPath: string;
		if (path.extname(newAbsolutePath)) {
			// ファイルリネームの場合
			newResolvedPath = newAbsolutePath;
		} else {
			// ディレクトリリネームの場合
			const oldDirectoryPath = path.dirname(resolvedPath);
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
 * 単一のファイルのリネーム操作を実行する (メモリ上)
 * @param project ts-morphプロジェクトインスタンス
 * @param oldPath リネーム元のファイルの絶対パス
 * @param newPath リネーム先のファイルの絶対パス
 * @throws リネーム対象のファイルが見つからない場合にエラー
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
	if (!sourceFile) {
		const filePaths = project.getSourceFiles().map((sf) => sf.getFilePath());
		const fileList =
			filePaths.length > 0
				? `\\nProject files:\\n - ${filePaths.join("\\n - ")}`
				: "(No files found in project)";
		throw new Error(
			`リネーム対象のファイルが見つかりません: ${absoluteOldPath}.${fileList}`,
		);
	}

	// 参照更新とファイル移動を実行
	const declarationsToUpdate = findDeclarationsReferencingFile(sourceFile);
	updateModuleSpecifiers(declarationsToUpdate, absoluteNewPath);
	sourceFile.move(absoluteNewPath);
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
	const absoluteOldPath = path.resolve(oldPath);
	const absoluteNewPath = path.resolve(newPath);

	try {
		const sourceFile = project.getSourceFile(absoluteOldPath);
		const directory = project.getDirectory(absoluteOldPath);

		// ガード節: リネーム対象が見つからない場合はエラー
		if (!sourceFile && !directory) {
			const filePaths = project.getSourceFiles().map((sf) => sf.getFilePath());
			const fileList =
				filePaths.length > 0
					? `\\nProject files:\\n - ${filePaths.join("\\n - ")}`
					: "(No files found in project)";
			throw new Error(
				`リネーム対象のファイルまたはディレクトリが見つかりません: ${absoluteOldPath}.${fileList}`,
			);
		}

		// リネーム先の存在チェック (ファイル、ディレクトリ共通)
		checkDestinationExists(project, absoluteNewPath);

		if (sourceFile) {
			// ファイルのリネーム処理
			executeSingleRename(project, absoluteOldPath, absoluteNewPath);
		} else if (directory) {
			// ディレクトリのリネーム処理
			const sourceFilesInDir = directory.getDescendantSourceFiles();

			// ディレクトリ内の各ファイルを移動
			for (const sf of sourceFilesInDir) {
				const oldFilePath = sf.getFilePath();
				const relativeFilePath = path.relative(absoluteOldPath, oldFilePath);
				const newFilePath = path.resolve(absoluteNewPath, relativeFilePath);
				executeSingleRename(project, oldFilePath, newFilePath);
			}
			// 空のディレクトリが残る可能性があるが、SourceFileの移動で実質的にリネームされるため
			// directory.move() は不要
		}
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
