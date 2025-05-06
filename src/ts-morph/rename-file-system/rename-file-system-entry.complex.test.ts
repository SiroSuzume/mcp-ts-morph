import { describe, it, expect } from "vitest";
import * as path from "node:path";
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
	project.createDirectory("/src/internal-feature");

	return project;
};

describe("renameFileSystemEntry Complex Cases", () => {
	it("内部参照を持つフォルダをリネームする", async () => {
		const project = setupProject();
		const oldDirPath = "/src/internal-feature";
		const newDirPath = "/src/cool-feature";
		const file1Path = path.join(oldDirPath, "file1.ts");
		const file2Path = path.join(oldDirPath, "file2.ts");

		project.createSourceFile(
			file1Path,
			`import { value2 } from './file2'; export const value1 = value2 + 1;`,
		);
		project.createSourceFile(file2Path, "export const value2 = 100;");

		await renameFileSystemEntry({
			project,
			renames: [{ oldPath: oldDirPath, newPath: newDirPath }],
			dryRun: false,
		});

		expect(project.getDirectory(newDirPath)).toBeDefined();
		const movedFile1 = project.getSourceFile(path.join(newDirPath, "file1.ts"));
		expect(movedFile1).toBeDefined();
		expect(movedFile1?.getFullText()).toContain(
			"import { value2 } from './file2';",
		);
	});

	it("複数のファイルを同時にリネームし、それぞれの参照が正しく更新される", async () => {
		const project = setupProject();
		const oldFile1 = "/src/utils/file1.ts";
		const newFile1 = "/src/utils/renamed1.ts";
		const oldFile2 = "/src/components/file2.ts";
		const newFile2 = "/src/components/renamed2.ts";
		const refFile = "/src/ref.ts";

		project.createSourceFile(oldFile1, "export const val1 = 1;");
		project.createSourceFile(oldFile2, "export const val2 = 2;");
		project.createSourceFile(
			refFile,
			`import { val1 } from './utils/file1';\nimport { val2 } from './components/file2';`,
		);

		await renameFileSystemEntry({
			project,
			renames: [
				{ oldPath: oldFile1, newPath: newFile1 },
				{ oldPath: oldFile2, newPath: newFile2 },
			],
			dryRun: false,
		});

		expect(project.getSourceFile(oldFile1)).toBeUndefined();
		expect(project.getSourceFile(newFile1)).toBeDefined();
		expect(project.getSourceFile(oldFile2)).toBeUndefined();
		expect(project.getSourceFile(newFile2)).toBeDefined();
		const updatedRef = project.getSourceFileOrThrow(refFile).getFullText();
		expect(updatedRef).toContain("import { val1 } from './utils/renamed1';");
		expect(updatedRef).toContain(
			"import { val2 } from './components/renamed2';",
		);
	});

	it("ファイルとディレクトリを同時にリネームし、それぞれの参照が正しく更新される", async () => {
		const project = setupProject();
		const oldFile = "/src/utils/fileA.ts";
		const newFile = "/src/utils/fileRenamed.ts";
		const oldDir = "/src/components";
		const newDir = "/src/widgets";
		const compInDir = path.join(oldDir, "comp.ts");
		const refFile = "/src/ref.ts";

		project.createSourceFile(oldFile, "export const valA = 'A';");
		project.createSourceFile(compInDir, "export const valComp = 'Comp';");
		project.createSourceFile(
			refFile,
			`import { valA } from './utils/fileA';\nimport { valComp } from './components/comp';`,
		);

		await renameFileSystemEntry({
			project,
			renames: [
				{ oldPath: oldFile, newPath: newFile },
				{ oldPath: oldDir, newPath: newDir },
			],
			dryRun: false,
		});

		expect(project.getSourceFile(oldFile)).toBeUndefined();
		expect(project.getSourceFile(newFile)).toBeDefined();
		expect(project.getDirectory(newDir)).toBeDefined();
		expect(project.getSourceFile(path.join(newDir, "comp.ts"))).toBeDefined();
		const updatedRef = project.getSourceFileOrThrow(refFile).getFullText();
		expect(updatedRef).toContain("import { valA } from './utils/fileRenamed';");
		expect(updatedRef).toContain("import { valComp } from './widgets/comp';");
	});

	it("ファイル名をスワップする（一時ファイル経由）", async () => {
		const project = setupProject();
		const fileA = "/src/fileA.ts";
		const fileB = "/src/fileB.ts";
		const tempFile = "/src/temp.ts";
		const refFile = "/src/ref.ts";

		project.createSourceFile(fileA, "export const valA = 'A';");
		project.createSourceFile(fileB, "export const valB = 'B';");
		project.createSourceFile(
			refFile,
			`import { valA } from './fileA';\nimport { valB } from './fileB';`,
		);

		await renameFileSystemEntry({
			project,
			renames: [{ oldPath: fileA, newPath: tempFile }],
			dryRun: false,
		});
		await renameFileSystemEntry({
			project,
			renames: [{ oldPath: fileB, newPath: fileA }],
			dryRun: false,
		});
		await renameFileSystemEntry({
			project,
			renames: [{ oldPath: tempFile, newPath: fileB }],
			dryRun: false,
		});

		expect(project.getSourceFile(tempFile)).toBeUndefined();
		expect(project.getSourceFile(fileA)?.getFullText()).toContain(
			"export const valB = 'B';",
		);
		expect(project.getSourceFile(fileB)?.getFullText()).toContain(
			"export const valA = 'A';",
		);
		const updatedRef = project.getSourceFileOrThrow(refFile).getFullText();
		expect(updatedRef).toContain("import { valA } from './fileB';");
		expect(updatedRef).toContain("import { valB } from './fileA';");
	});
});
