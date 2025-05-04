import type { Project, SourceFile } from "ts-morph";

/**
 * 指定されたパスにファイルが存在しない場合、新しいソースファイルを作成します。
 * 既にファイルが存在する場合は、既存の SourceFile オブジェクトを返します。
 *
 * @param project - ts-morph の Project インスタンス。
 * @param filePath - 作成または取得するファイルの絶対パス。
 * @param content - ファイルが存在しない場合に書き込む内容。
 * @returns 作成された、または既存の SourceFile オブジェクト。
 */
export function createSourceFileIfNotExists(
	project: Project,
	filePath: string,
	content: string,
): SourceFile {
	const existingSourceFile = project.getSourceFile(filePath);

	if (existingSourceFile) {
		// 既にファイルが存在する場合は、それを返す
		return existingSourceFile;
	}

	// ファイルが存在しない場合は、新しいファイルを作成して返す
	return project.createSourceFile(filePath, content);
}
