import { Project, type SourceFile } from "ts-morph";
import * as path from "node:path";
import * as ts from "typescript";

/**
 * tsconfig.json を元に ts-morph の Project インスタンスを初期化する
 */
export function initializeProject(tsconfigPath: string): Project {
	// tsconfigのパスを絶対パスに変換
	const absoluteTsconfigPath = path.resolve(tsconfigPath);
	return new Project({
		tsConfigFilePath: absoluteTsconfigPath,
		manipulationSettings: {
			newLineKind: ts.NewLineKind.LineFeed,
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
 */
export async function saveProjectChanges(project: Project): Promise<void> {
	try {
		await project.save();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`ファイル保存中にエラーが発生しました: ${message}`);
	}
}
