import type { Project, SourceFile } from "ts-morph";
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
	renames: { oldPath: string; newPath: string }[];
	dryRun?: boolean;
}): Promise<{ changedFiles: string[] }> {
	try {
		// 1. 事前準備: 移動対象ファイルとパスリストの作成、衝突チェック
		const sourceFilesToMove: SourceFile[] = [];
		const originalPaths: string[] = [];
		const newPaths: string[] = [];
		const uniqueNewPaths = new Set<string>(); // newPath の重複チェック用

		for (const rename of renames) {
			const absoluteOldPath = path.resolve(rename.oldPath);
			const absoluteNewPath = path.resolve(rename.newPath);

			// newPath の重複チェック
			if (uniqueNewPaths.has(absoluteNewPath)) {
				throw new Error(`リネーム先のパスが重複しています: ${absoluteNewPath}`);
			}
			uniqueNewPaths.add(absoluteNewPath);

			// リネーム先存在チェック
			checkDestinationExists(project, absoluteNewPath);

			const sourceFile = project.getSourceFile(absoluteOldPath);
			const directory = project.getDirectory(absoluteOldPath);

			if (sourceFile) {
				sourceFilesToMove.push(sourceFile);
				originalPaths.push(absoluteOldPath);
				newPaths.push(absoluteNewPath);
			} else if (directory) {
				const filesInDir = directory.getDescendantSourceFiles();
				sourceFilesToMove.push(...filesInDir);
				for (const sf of filesInDir) {
					const oldFilePath = sf.getFilePath();
					const relative = path.relative(absoluteOldPath, oldFilePath);
					const newFilePath = path.resolve(absoluteNewPath, relative);
					originalPaths.push(oldFilePath);
					newPaths.push(newFilePath);
				}
			} else {
				throw new Error(`リネーム対象が見つかりません: ${absoluteOldPath}`);
			}
		}

		// 2. 更新対象の参照を移動前に特定
		let allDeclarationsToUpdate: DeclarationToUpdate[] = [];
		for (const sf of sourceFilesToMove) {
			const declarations = findDeclarationsReferencingFile(sf);
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

		// 3. 全ファイルを移動
		for (let i = 0; i < sourceFilesToMove.length; i++) {
			const sf = sourceFilesToMove[i];
			const newFilePath = newPaths[i];
			// ここでの個々のファイルの移動先存在チェックは不要 (事前にまとめてチェック済み)
			sf.move(newFilePath);
		}

		// 4. 移動後に参照を更新
		for (const {
			declaration,
			resolvedPath,
			referencingFilePath,
		} of allDeclarationsToUpdate) {
			const moduleSpecifier = declaration.getModuleSpecifier();
			if (!moduleSpecifier) continue;

			// 移動後の参照元ファイルのパスを取得 (移動していないファイルもあるため ?? でフォールバック)
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
				// 移動対象外のファイルへの参照など、新しいパスが見つからない場合はスキップ
				// (例: node_modules への参照など)
				console.warn(
					`[rename] Could not determine new path for resolved path: ${resolvedPath} (referenced from ${newReferencingFilePath}) - Skipping update.`,
				);
				continue;
			}

			const newRelativePath = calculateRelativePath(
				newReferencingFilePath,
				newResolvedPath,
			);
			moduleSpecifier.setLiteralValue(newRelativePath);
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		throw new Error(`リネーム処理中にエラーが発生しました: ${errorMessage}`);
	}

	// 5. 変更の保存 (dryRun でなければ)
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
