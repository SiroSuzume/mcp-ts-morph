import { Project, IndentationText, QuoteKind, SourceFile } from "ts-morph";
import { describe, it, expect } from "vitest";
import { createSourceFileIfNotExists } from "./create-source-file-if-not-exists";

describe("createSourceFileIfNotExists", () => {
	const newFilePath = "/test/new-file.ts";
	const existingFilePath = "/test/existing-file.ts";
	const fileContent = 'export const hello = "world";';
	const existingFileContent = "export const existing = true;";

	const setupTestProject = () => {
		const project = new Project({
			manipulationSettings: {
				indentationText: IndentationText.TwoSpaces,
				quoteKind: QuoteKind.Single,
			},
			useInMemoryFileSystem: true,
		});
		// 既存ファイルをセットアップ時に作成
		const existingSourceFile = project.createSourceFile(
			existingFilePath,
			existingFileContent,
		);
		return { project, existingSourceFile };
	};

	it("ファイルが存在しない場合、新しい SourceFile を作成して返す", () => {
		const { project } = setupTestProject();
		// 存在しないことを確認 (任意)
		expect(project.getSourceFile(newFilePath)).toBeUndefined();

		const result = createSourceFileIfNotExists(
			project,
			newFilePath,
			fileContent,
		);

		expect(result).toBeInstanceOf(SourceFile);
		expect(result.getFilePath()).toBe(newFilePath);
		expect(project.getSourceFile(newFilePath)).toBe(result); // プロジェクト内のものと同一か
		expect(result.getText()).toBe(fileContent); // 内容も一応確認
	});

	it("ファイルが既に存在する場合、既存の SourceFile を返す", () => {
		const { project, existingSourceFile } = setupTestProject();
		const initialFileCount = project.getSourceFiles().length;

		const result = createSourceFileIfNotExists(
			project,
			existingFilePath,
			"new content should be ignored",
		);

		expect(result).toBe(existingSourceFile);
		expect(project.getSourceFiles().length).toBe(initialFileCount);
	});
});
