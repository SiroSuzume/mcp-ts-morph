import { Project, type SourceFile } from "ts-morph";
import * as path from "node:path";
import { NewLineKind } from "typescript";

/**
 * tsconfig.json を元に ts-morph の Project インスタンスを初期化する
 */
export function initializeProject(tsconfigPath: string): Project {
	// tsconfigのパスを絶対パスに変換
	const absoluteTsconfigPath = path.resolve(tsconfigPath);
	return new Project({
		tsConfigFilePath: absoluteTsconfigPath,
		manipulationSettings: {
			newLineKind: NewLineKind.LineFeed,
		},
	});
}

/**
 * プロジェクト内で変更があった（まだ保存されていない）ファイルリストを取得する
 */
export function getChangedFiles(project: Project): SourceFile[] {
	// isSaved() === false で未保存のファイルを取得する
	return project.getSourceFiles().filter((sf) => !sf.isSaved());
}

/**
 * プロジェクトの変更を保存する
 * @param project The project instance.
 * @param signal Optional AbortSignal for cancellation.
 */
export async function saveProjectChanges(
	project: Project,
	signal?: AbortSignal,
): Promise<void> {
	signal?.throwIfAborted();
	try {
		await project.save();
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") {
			throw error;
		}
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`ファイル保存中にエラーが発生しました: ${message}`);
	}
}
