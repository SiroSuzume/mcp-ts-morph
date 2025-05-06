import { describe, expect, it } from "vitest";
import { Project } from "ts-morph";
import { renameFileSystemEntry } from "./rename-file-system-entry";

// --- Test Setup Helper ---

const setupProject = () => {
	const project = new Project({
		useInMemoryFileSystem: true,
		compilerOptions: {
			baseUrl: ".",
			paths: {
				"@/*": ["src/*"],
			},
			esModuleInterop: true,
			allowJs: true,
		},
	});

	project.createDirectory("/src");
	project.createDirectory("/src/utils");
	project.createDirectory("/src/components");
	project.createDirectory("/src/existing-dir");

	return project;
};

describe("renameFileSystemEntry Error Cases", () => {
	it("存在しないファイルをリネームしようとするとエラーをスローする", async () => {
		const project = setupProject();
		const oldPath = "/src/nonexistent.ts";
		const newPath = "/src/new.ts";

		await expect(
			renameFileSystemEntry({
				project,
				renames: [{ oldPath, newPath }],
				dryRun: false,
			}),
		).rejects.toThrowError(
			/^Rename process failed: リネーム対象が見つかりません.*See logs for details.$/,
		);
	});

	it("存在しないディレクトリをリネームしようとするとエラーをスローする", async () => {
		const project = setupProject();
		const oldPath = "/src/nonexistent-dir";
		const newPath = "/src/new-dir";

		await expect(
			renameFileSystemEntry({
				project,
				renames: [{ oldPath, newPath }],
				dryRun: false,
			}),
		).rejects.toThrowError(
			/^Rename process failed: リネーム対象が見つかりません.*See logs for details.$/,
		);
	});

	it("リネーム先のパスに既にファイルが存在する場合、エラーをスローする (上書きしない)", async () => {
		const project = setupProject();
		const oldPath = "/src/file1.ts";
		const existingPath = "/src/existing.ts";
		project.createSourceFile(oldPath, "export const file1 = 1;");
		project.createSourceFile(existingPath, "export const existing = true;");

		await expect(
			renameFileSystemEntry({
				project,
				renames: [{ oldPath, newPath: existingPath }],
				dryRun: false,
			}),
		).rejects.toThrowError(
			/^Rename process failed: リネーム先パスに既にファイルが存在します.*See logs for details.$/,
		);
		expect(project.getSourceFile(oldPath)).toBeDefined();
		expect(project.getSourceFile(existingPath)?.getFullText()).toContain(
			"existing = true",
		);
	});

	it("リネーム先のパスに既にディレクトリが存在する場合、エラーをスローする", async () => {
		const project = setupProject();
		const oldPath = "/src/file1.ts";
		const existingDirPath = "/src/existing-dir";
		project.createSourceFile(oldPath, "export const file1 = 1;");

		await expect(
			renameFileSystemEntry({
				project,
				renames: [{ oldPath, newPath: existingDirPath }],
				dryRun: false,
			}),
		).rejects.toThrowError(
			/^Rename process failed: リネーム先パスに既にディレクトリが存在します.*See logs for details.$/,
		);
		expect(project.getSourceFile(oldPath)).toBeDefined();
		expect(project.getDirectory(existingDirPath)).toBeDefined();
	});

	it("リネーム先のパスが重複する場合、エラーをスローする", async () => {
		const project = setupProject();
		const file1 = "/src/file1.ts";
		const file2 = "/src/file2.ts";
		const sameNewPath = "/src/renamed.ts";
		project.createSourceFile(file1, "export const v1 = 1;");
		project.createSourceFile(file2, "export const v2 = 2;");

		await expect(
			renameFileSystemEntry({
				project,
				renames: [
					{ oldPath: file1, newPath: sameNewPath },
					{ oldPath: file2, newPath: sameNewPath },
				],
				dryRun: false,
			}),
		).rejects.toThrowError(
			/^Rename process failed: リネーム先のパスが重複しています.*See logs for details.$/,
		);
	});
});
