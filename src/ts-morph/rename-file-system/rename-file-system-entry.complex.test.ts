import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { createInMemoryProject } from "../_test-utils/create-in-memory-project";
import { expectFileMoved } from "../_test-utils/expect-file-moved";
import { renameFileSystemEntry } from "./rename-file-system-entry";
import { getFileText } from "../_test-utils/get-file-text";

describe("renameFileSystemEntry Complex Cases", () => {
	it("内部参照を持つフォルダをリネームする", async () => {
		const project = createInMemoryProject();
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
		const project = createInMemoryProject();
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

		expectFileMoved(project, oldFile1, newFile1);
		expectFileMoved(project, oldFile2, newFile2);
		const updatedRef = getFileText(project, refFile);
		expect(updatedRef).toContain("import { val1 } from './utils/renamed1';");
		expect(updatedRef).toContain(
			"import { val2 } from './components/renamed2';",
		);
	});

	it("ファイルとディレクトリを同時にリネームし、それぞれの参照が正しく更新される", async () => {
		const project = createInMemoryProject();
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

		expectFileMoved(project, oldFile, newFile);
		expect(project.getDirectory(newDir)).toBeDefined();
		expect(project.getSourceFile(path.join(newDir, "comp.ts"))).toBeDefined();
		const updatedRef = getFileText(project, refFile);
		expect(updatedRef).toContain("import { valA } from './utils/fileRenamed';");
		expect(updatedRef).toContain("import { valComp } from './widgets/comp';");
	});

	it("ディレクトリ rename 後、旧ディレクトリ階層の空サブディレクトリが残らない (issue #27)", async () => {
		const project = createInMemoryProject();
		const oldDirPath = "/src/foo";
		const newDirPath = "/src/bar";

		project.createSourceFile(`${oldDirPath}/index.ts`, "export const a = 1;");
		project.createSourceFile(
			`${oldDirPath}/sub-a/index.ts`,
			"export const b = 2;",
		);
		project.createSourceFile(
			`${oldDirPath}/sub-b/nested/index.ts`,
			"export const c = 3;",
		);

		await renameFileSystemEntry({
			project,
			renames: [{ oldPath: oldDirPath, newPath: newDirPath }],
			dryRun: false,
		});

		// 1. 新しいディレクトリツリーは存在する
		expect(project.getDirectory(newDirPath)).toBeDefined();
		expect(
			project.getSourceFile(`${newDirPath}/sub-b/nested/index.ts`),
		).toBeDefined();

		// 2. 旧ディレクトリは project tree から消えている (issue #27 の本質)
		expect(project.getDirectory(oldDirPath)).toBeUndefined();
		expect(project.getDirectory(`${oldDirPath}/sub-a`)).toBeUndefined();
		expect(project.getDirectory(`${oldDirPath}/sub-b`)).toBeUndefined();
		expect(project.getDirectory(`${oldDirPath}/sub-b/nested`)).toBeUndefined();
	});

	it("ディレクトリ rename は shell mv セマンティクス: untracked ファイルも一緒に移動する", async () => {
		// 旧実装 (per-file sourceFile.move + cleanup) は untracked を旧 dir に残していたが、
		// perf 改善のため Directory.move() (FS-level atomic rename) を採用した結果、
		// shell の `mv` と同じく untracked / 想定外ファイルも全部 new dir に運ばれる。
		// 注意: src/ 配下に手書き README や generated dist/ を置いている等のケースで
		// 挙動が変わるため、利用側はそれを想定したディレクトリ構成にすること。
		const project = createInMemoryProject();
		const oldDirPath = "/src/foo";
		const newDirPath = "/src/bar";

		project.createSourceFile(`${oldDirPath}/index.ts`, "export const a = 1;");
		project.createSourceFile(
			`${oldDirPath}/sub-a/index.ts`,
			"export const b = 2;",
		);
		const fs = project.getFileSystem();
		fs.writeFileSync(`${oldDirPath}/sub-a/README.md`, "# moved together");

		await renameFileSystemEntry({
			project,
			renames: [{ oldPath: oldDirPath, newPath: newDirPath }],
			dryRun: false,
		});

		// 旧ディレクトリは完全消失
		expect(fs.directoryExistsSync(oldDirPath)).toBe(false);
		expect(fs.directoryExistsSync(`${oldDirPath}/sub-a`)).toBe(false);
		// untracked も含めて新ディレクトリ配下に移動
		expect(fs.directoryExistsSync(`${newDirPath}/sub-a`)).toBe(true);
		expect(fs.readFileSync(`${newDirPath}/sub-a/README.md`)).toContain(
			"moved together",
		);
	});

	it("ファイル名をスワップする（一時ファイル経由）", async () => {
		const project = createInMemoryProject();
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
		expect(getFileText(project, fileA)).toContain("export const valB = 'B';");
		expect(getFileText(project, fileB)).toContain("export const valA = 'A';");
		const updatedRef = getFileText(project, refFile);
		expect(updatedRef).toContain("import { valA } from './fileB';");
		expect(updatedRef).toContain("import { valB } from './fileA';");
	});
});
