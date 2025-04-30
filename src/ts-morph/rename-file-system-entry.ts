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
	let formatted = relative.startsWith(".") ? relative : `./${relative}`;

	// 拡張子 .ts, .tsx を削除
	formatted = formatted.replace(/\.(ts|tsx)$/, "");

	// 同じディレクトリ内の index を参照している場合は '.' にする
	if (formatted === "./index") {
		return ".";
	}
	// 親ディレクトリの index を参照している場合は '..' にする
	if (formatted === "../index") {
		return "..";
	}

	return formatted;
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

		checkDestinationExists(project, absoluteNewPath);

		if (sourceFile) {
			// ---------------------------------
			// ファイルリネーム処理 (変更なし)
			// ---------------------------------
			executeSingleRename(project, absoluteOldPath, absoluteNewPath);
		} else if (directory) {
			// ---------------------------------
			// ディレクトリリネーム処理 (新ロジック)
			// ---------------------------------
			const sourceFilesToMove = directory.getDescendantSourceFiles();
			const originalPaths = sourceFilesToMove.map((sf) => sf.getFilePath());
			const newPaths = originalPaths.map((oldFilePath) => {
				const relative = path.relative(absoluteOldPath, oldFilePath);
				return path.resolve(absoluteNewPath, relative);
			});

			// 1. 更新対象の参照を移動前に特定
			let allDeclarationsToUpdate: DeclarationToUpdate[] = [];
			for (const sf of sourceFilesToMove) {
				const declarations = findDeclarationsReferencingFile(sf);
				allDeclarationsToUpdate.push(...declarations);
			}
			// TODO: 重複する参照宣言があれば除去する (Import/ExportDeclaration 単位でユニークにする)
			allDeclarationsToUpdate = Array.from(
				new Map(
					allDeclarationsToUpdate.map((d) => [
						// キーとしてノードの位置情報を使用
						`${d.declaration.getPos()}-${d.declaration.getEnd()}`,
						d,
					]),
				).values(),
			);

			// 2. 全ファイルを移動
			for (let i = 0; i < sourceFilesToMove.length; i++) {
				const sf = sourceFilesToMove[i];
				const newFilePath = newPaths[i];
				// 個々のファイルの移動先存在チェックは checkDestinationExists で代替されるため省略
				sf.move(newFilePath);
			}

			// 3. 移動後に参照を更新
			for (const {
				declaration,
				resolvedPath,
				referencingFilePath,
			} of allDeclarationsToUpdate) {
				const moduleSpecifier = declaration.getModuleSpecifier();
				if (!moduleSpecifier) continue;

				// 移動後の参照元ファイルのパスを取得
				const newReferencingFilePath =
					findNewPath(referencingFilePath, originalPaths, newPaths) ??
					referencingFilePath;

				// 移動後の参照先ファイルのパスを取得
				const newResolvedPath = findNewPath(
					resolvedPath,
					originalPaths,
					newPaths,
				);
				if (!newResolvedPath) {
					console.warn(
						`[rename] Could not find new path for resolved path: ${resolvedPath} (referenced from ${newReferencingFilePath})`,
					);
					continue;
				}

				// declaration オブジェクトは move 後も有効か？ ts-morph は通常追従するはず
				const newRelativePath = calculateRelativePath(
					newReferencingFilePath,
					newResolvedPath,
				);
				moduleSpecifier.setLiteralValue(newRelativePath);
			}
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

// ヘルパー関数: 移動後のパスを探す
function findNewPath(
	oldFilePath: string,
	originalPaths: string[],
	newPaths: string[],
): string | undefined {
	const index = originalPaths.indexOf(oldFilePath);
	return index !== -1 ? newPaths[index] : undefined;
}
