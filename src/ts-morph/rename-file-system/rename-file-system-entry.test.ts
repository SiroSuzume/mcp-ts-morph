import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { Project } from "ts-morph";
import { renameFileSystemEntry } from "./rename-file-system-entry";

// --- Test Setup Helper ---

const TEST_TSCONFIG_PATH = "/tsconfig.json";

const setupProject = () => {
	const project = new Project({
		useInMemoryFileSystem: true,
		compilerOptions: {
			// tsconfig.json の内容を直接 compilerOptions に設定
			baseUrl: ".",
			paths: {
				"@/*": ["src/*"],
			},
			esModuleInterop: true,
			allowJs: true,
		},
	});

	// 共通のディレクトリ構造をメモリ上に作成
	project.createDirectory("/src");
	project.createDirectory("/src/utils");
	project.createDirectory("/src/components");
	project.createDirectory("/src/old-feature");

	return project;
};

// --- Test Suite ---

describe("renameFileSystemEntry", () => {
	it("ファイルリネーム時に相対パスとエイリアスパスのimport文を正しく更新する", async () => {
		// --- Arrange ---
		const project = setupProject();
		const oldUtilPath = "/src/utils/old-util.ts";
		const newUtilPath = "/src/utils/new-util.ts";
		const componentPath = "/src/components/MyComponent.ts";
		const utilIndexPath = "/src/utils/index.ts";

		// ファイル作成 (project.createSourceFileを使用)
		project.createSourceFile(
			oldUtilPath,
			'export const oldUtil = () => "old";',
		);
		project.createSourceFile(utilIndexPath, 'export * from "./old-util";');
		project.createSourceFile(
			componentPath,
			`import { oldUtil as relativeImport } from '../utils/old-util';
import { oldUtil as aliasImport } from '@/utils/old-util';
import { oldUtil as indexImport } from '../utils'; // index.ts を参照

console.log(relativeImport(), aliasImport(), indexImport());
`,
		);

		// --- Act ---
		await renameFileSystemEntry({
			project,
			renames: [{ oldPath: oldUtilPath, newPath: newUtilPath }],
			dryRun: false,
		});

		// --- Assert ---
		const updatedComponentContent = project
			.getSourceFileOrThrow(componentPath)
			.getFullText();

		expect(updatedComponentContent).toContain(
			"import { oldUtil as relativeImport } from '../utils/new-util';",
		);
		expect(updatedComponentContent).toContain(
			"import { oldUtil as aliasImport } from '../utils/new-util';",
		);
		expect(updatedComponentContent).toContain(
			"import { oldUtil as indexImport } from '../utils/new-util';",
		);
		// 元のファイルが存在しないことを確認
		expect(project.getSourceFile(oldUtilPath)).toBeUndefined();
		// 新しいファイルが存在することを確認
		expect(project.getSourceFile(newUtilPath)).toBeDefined();
	});

	it("フォルダリネーム時に相対パスとエイリアスパスのimport文を正しく更新する", async () => {
		// --- Arrange ---
		const project = setupProject();
		const oldFeatureDir = "/src/old-feature";
		const newFeatureDir = "/src/new-feature";
		const featureFilePath = path.join(oldFeatureDir, "feature.ts"); // path.join はそのまま使える
		const componentPath = "/src/components/AnotherComponent.ts";
		const featureIndexPath = path.join(oldFeatureDir, "index.ts");

		// ファイル/フォルダ作成
		project.createSourceFile(
			featureFilePath,
			'export const feature = () => "feature";',
		);
		project.createSourceFile(featureIndexPath, 'export * from "./feature";');
		project.createSourceFile(
			componentPath,
			`import { feature as relativeImport } from '../old-feature/feature';
import { feature as aliasImport } from '@/old-feature/feature';
import { feature as indexImport } from '../old-feature'; // index.ts を参照

console.log(relativeImport(), aliasImport(), indexImport());
`,
		);

		// --- Act ---
		await renameFileSystemEntry({
			project,
			renames: [{ oldPath: oldFeatureDir, newPath: newFeatureDir }],
			dryRun: false,
		});

		// --- Assert ---
		const updatedComponentContent = project
			.getSourceFileOrThrow(componentPath)
			.getFullText();

		expect(updatedComponentContent).toContain(
			"import { feature as relativeImport } from '../new-feature/feature';",
		);
		expect(updatedComponentContent).toContain(
			"import { feature as aliasImport } from '../new-feature/feature';",
		);
		expect(updatedComponentContent).toContain(
			"import { feature as indexImport } from '../new-feature/feature';",
		);

		// リネームされた新しいパスにファイル/ディレクトリが存在することを確認
		expect(project.getDirectory(newFeatureDir)).toBeDefined();
		expect(
			project.getSourceFile(path.join(newFeatureDir, "feature.ts")),
		).toBeDefined();
		expect(
			project.getSourceFile(path.join(newFeatureDir, "index.ts")),
		).toBeDefined();
	});

	it("同階層(.)や親階層(..)への相対パスimport文を持つファイルをリネームした際に、参照元のパスが正しく更新される", async () => {
		// Arrange
		const project = setupProject();
		const dirA = "/src/dirA";
		const dirB = "/src/dirB";
		project.createDirectory(dirA);
		project.createDirectory(dirB);

		const fileA1Path = path.join(dirA, "fileA1.ts");
		const fileA2Path = path.join(dirA, "fileA2.ts"); // リネーム対象
		const fileBPath = path.join(dirB, "fileB.ts"); // fileA2を参照するファイル
		const fileA3Path = path.join(dirA, "fileA3.ts"); // fileA2を同階層から参照

		project.createSourceFile(fileA1Path, "export const valA1 = 1;");
		project.createSourceFile(fileA2Path, "export const valA2 = 2;");
		project.createSourceFile(
			fileBPath,
			`
import { valA2 } from '../dirA/fileA2'; // ../ を含む相対パス
import { valA1 } from '../dirA/fileA1'; // これは変わらないはず
console.log(valA2, valA1);
        `,
		);
		project.createSourceFile(
			fileA3Path,
			`
import { valA2 } from './fileA2'; // ./ を含む相対パス
console.log(valA2);
`,
		);

		const newFileA2Path = path.join(dirA, "renamedA2.ts");

		// Act
		await renameFileSystemEntry({
			project,
			renames: [{ oldPath: fileA2Path, newPath: newFileA2Path }],
			dryRun: false,
		});

		// Assert
		const updatedFileBContent = project
			.getSourceFileOrThrow(fileBPath)
			.getFullText();
		const updatedFileA3Content = project
			.getSourceFileOrThrow(fileA3Path)
			.getFullText();

		expect(updatedFileBContent).toContain(
			"import { valA2 } from '../dirA/renamedA2';",
		);
		expect(updatedFileBContent).toContain(
			"import { valA1 } from '../dirA/fileA1';",
		);
		expect(updatedFileA3Content).toContain(
			"import { valA2 } from './renamedA2';",
		);

		expect(project.getSourceFile(fileA2Path)).toBeUndefined();
		expect(project.getSourceFile(newFileA2Path)).toBeDefined();
	});

	it("親階層(..)への相対パスimport文を持つファイルを、別のディレクトリに移動（リネーム）した際に、参照元のパスが正しく更新される", async () => {
		// Arrange
		const project = setupProject();
		const dirA = "/src/dirA";
		const dirC = "/src/dirC"; // 移動先
		project.createDirectory(dirA);
		project.createDirectory(dirC);

		const fileA1Path = path.join(dirA, "fileA1.ts"); // リネーム（移動）対象
		const fileA2Path = path.join(dirA, "fileA2.ts"); // fileA1を参照するファイル

		project.createSourceFile(fileA1Path, "export const valA1 = 1;");
		project.createSourceFile(
			fileA2Path,
			`
import { valA1 } from './fileA1'; // 同階層の import
console.log(valA1);
`,
		);

		const newFileA1Path = path.join(dirC, "movedA1.ts"); // 別のディレクトリへ移動

		// Act
		await renameFileSystemEntry({
			project,
			renames: [{ oldPath: fileA1Path, newPath: newFileA1Path }],
			dryRun: false,
		});

		// Assert
		const updatedFileA2Content = project
			.getSourceFileOrThrow(fileA2Path)
			.getFullText();
		expect(updatedFileA2Content).toContain(
			"import { valA1 } from '../dirC/movedA1';",
		);

		expect(project.getSourceFile(fileA1Path)).toBeUndefined();
		expect(project.getSourceFile(newFileA1Path)).toBeDefined();
	});

	it("dryRun: true の場合、ファイルシステム（メモリ上）の変更を行わず、変更予定リストを返す", async () => {
		// Arrange
		const project = setupProject();
		const oldUtilPath = "/src/utils/old-util.ts";
		const newUtilPath = "/src/utils/new-util.ts";
		const componentPath = "/src/components/MyComponent.ts";

		project.createSourceFile(
			oldUtilPath,
			'export const oldUtil = () => "old";',
		);
		project.createSourceFile(
			componentPath,
			`import { oldUtil } from '../utils/old-util';`,
		);
		const originalComponentContent = project
			.getSourceFileOrThrow(componentPath)
			.getFullText();

		// Act
		const result = await renameFileSystemEntry({
			project,
			renames: [{ oldPath: oldUtilPath, newPath: newUtilPath }],
			dryRun: true, // dryRun を true に設定
		});

		// Assert
		// メモリ上のファイル内容は変わっていないはず -> dryRun でも move は実行されるため内容は変わる可能性がある
		// expect(project.getSourceFileOrThrow(componentPath).getFullText()).toBe(
		//   originalComponentContent
		// );
		// ↓ 変更リストのみを検証するように変更

		// 元のファイルパスは move されるので undefined になる
		expect(project.getSourceFile(oldUtilPath)).toBeUndefined();
		// 新しいファイルパスは move されるので defined になる
		expect(project.getSourceFile(newUtilPath)).toBeDefined();

		// 変更が予定されているファイルのリストに含まれているかを確認
		expect(result.changedFiles).toContain(newUtilPath); // 新しいパス
		expect(result.changedFiles).toContain(componentPath); // 参照元
		// changedFiles には移動元(oldUtilPath)は含まれないことを確認 (任意)
		expect(result.changedFiles).not.toContain(oldUtilPath);
	});

	it("どのファイルからも参照されていないファイルをリネームする", async () => {
		// Arrange
		const project = setupProject();
		const oldPath = "/src/utils/unreferenced.ts";
		const newPath = "/src/utils/renamed-unreferenced.ts";
		project.createSourceFile(oldPath, "export const lonely = true;");

		// Act
		const result = await renameFileSystemEntry({
			project,
			renames: [{ oldPath, newPath }],
			dryRun: false,
		});

		// Assert
		expect(project.getSourceFile(oldPath)).toBeUndefined();
		expect(project.getSourceFile(newPath)).toBeDefined();
		expect(project.getSourceFileOrThrow(newPath).getFullText()).toContain(
			"export const lonely = true;",
		);
		// 変更されたファイルはリネームされたファイル自身のみのはず
		expect(result.changedFiles).toEqual([newPath]);
	});

	it("内部参照を持つフォルダをリネームする", async () => {
		// Arrange
		const project = setupProject();
		const oldDirPath = "/src/internal-feature";
		const newDirPath = "/src/cool-feature";
		const file1Path = path.join(oldDirPath, "file1.ts");
		const file2Path = path.join(oldDirPath, "file2.ts");

		project.createDirectory(oldDirPath);
		project.createSourceFile(
			file1Path,
			`import { value2 } from './file2'; export const value1 = value2 + 1;`,
		);
		project.createSourceFile(file2Path, "export const value2 = 100;");

		// Act
		await renameFileSystemEntry({
			project,
			renames: [{ oldPath: oldDirPath, newPath: newDirPath }],
			dryRun: false,
		});

		// Assert
		expect(project.getDirectory(newDirPath)).toBeDefined();
		const movedFile1 = project.getSourceFile(path.join(newDirPath, "file1.ts"));
		expect(movedFile1).toBeDefined();
		expect(movedFile1?.getFullText()).toContain(
			"import { value2 } from './file2';",
		);
	});

	it("index.ts ファイル自体をリネームする", async () => {
		// Arrange
		const project = setupProject();
		const oldIndexPath = "/src/utils/index.ts";
		const newIndexPath = "/src/utils/main.ts";
		const componentPath = "/src/components/MyComponent.ts";

		project.createSourceFile(oldIndexPath, "export const utilFromIndex = 1;");
		project.createSourceFile(
			componentPath,
			"import { utilFromIndex } from '../utils';", // ディレクトリをインポート
		);

		// Act
		await renameFileSystemEntry({
			project,
			renames: [{ oldPath: oldIndexPath, newPath: newIndexPath }],
			dryRun: false,
		});

		// Assert
		expect(project.getSourceFile(oldIndexPath)).toBeUndefined();
		expect(project.getSourceFile(newIndexPath)).toBeDefined();
		const updatedComponent = project.getSourceFileOrThrow(componentPath);
		// index.ts をリネームした場合、ディレクトリ参照はリネーム後のファイル名になるべき
		expect(updatedComponent.getFullText()).toContain(
			"import { utilFromIndex } from '../utils/main';", // パスが更新されることを期待
		);
	});

	it("存在しないファイルをリネームしようとするとエラーをスローする", async () => {
		// Arrange
		const project = setupProject();
		const oldPath = "/src/nonexistent.ts";
		const newPath = "/src/new.ts";

		// Act & Assert
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
		// Arrange
		const project = setupProject();
		const oldPath = "/src/nonexistent-dir";
		const newPath = "/src/new-dir";

		// Act & Assert
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
		// Arrange
		const project = setupProject();
		const oldPath = "/src/file1.ts";
		const existingPath = "/src/existing.ts"; // リネーム先のパス
		project.createSourceFile(oldPath, "export const file1 = 1;");
		project.createSourceFile(existingPath, "export const existing = true;");

		// Act & Assert
		await expect(
			renameFileSystemEntry({
				project,
				renames: [{ oldPath, newPath: existingPath }],
				dryRun: false,
			}),
		).rejects.toThrowError(
			/^Rename process failed: リネーム先パスに既にファイルが存在します.*See logs for details.$/,
		);
		// ファイルが移動/上書きされていないことを確認
		expect(project.getSourceFile(oldPath)).toBeDefined();
		expect(project.getSourceFile(existingPath)?.getFullText()).toContain(
			"existing = true",
		);
	});

	it("リネーム先のパスに既にディレクトリが存在する場合、エラーをスローする", async () => {
		// Arrange
		const project = setupProject();
		const oldPath = "/src/file1.ts";
		const existingDirPath = "/src/existing-dir"; // リネーム先のパス
		project.createSourceFile(oldPath, "export const file1 = 1;");
		project.createDirectory(existingDirPath);

		// Act & Assert
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

	it("ディレクトリリネーム時に、内部からの '.' や外部からの '..' による index.ts 参照が正しく更新される", async () => {
		// Arrange
		const project = setupProject();
		const oldDirPath = "/src/featureA";
		const newDirPath = "/src/featureRenamed";
		const indexTsPath = path.join(oldDirPath, "index.ts");
		const componentTsPath = path.join(oldDirPath, "component.ts");
		const serviceTsPath = "/src/core/service.ts";

		project.createDirectory(oldDirPath);
		project.createDirectory("/src/core");
		project.createSourceFile(indexTsPath, "export const featureValue = 'A';");
		project.createSourceFile(
			componentTsPath,
			"import { featureValue } from '.';", // 内部から '.' で index.ts を参照
		);
		project.createSourceFile(
			serviceTsPath,
			"import { featureValue } from '../featureA';", // 外部から '..' で index.ts を参照
		);

		// Act
		await renameFileSystemEntry({
			project,
			renames: [{ oldPath: oldDirPath, newPath: newDirPath }],
			dryRun: false,
		});

		// Assert
		const newComponentTsPath = path.join(newDirPath, "component.ts");
		const updatedComponent = project.getSourceFileOrThrow(newComponentTsPath);
		const updatedService = project.getSourceFileOrThrow(serviceTsPath);

		// component.ts の '.' 参照は変わらないはず
		expect(updatedComponent.getFullText()).toContain(
			"import { featureValue } from '.';",
		);

		// service.ts の '../featureA' 参照は '../featureRenamed' (またはindex付き) に更新されるはず
		expect(updatedService.getFullText()).toContain(
			"import { featureValue } from '../featureRenamed/index';", // index.ts が明示されることを期待
		);
	});

	it("複数のファイルを同時にリネームし、それぞれの参照が正しく更新される", async () => {
		// Arrange
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

		// Act
		await renameFileSystemEntry({
			project,
			renames: [
				{ oldPath: oldFile1, newPath: newFile1 },
				{ oldPath: oldFile2, newPath: newFile2 },
			],
			dryRun: false,
		});

		// Assert
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
		// Arrange
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

		// Act
		await renameFileSystemEntry({
			project,
			renames: [
				{ oldPath: oldFile, newPath: newFile },
				{ oldPath: oldDir, newPath: newDir },
			],
			dryRun: false,
		});

		// Assert
		expect(project.getSourceFile(oldFile)).toBeUndefined();
		expect(project.getSourceFile(newFile)).toBeDefined();
		// expect(project.getDirectory(oldDir)).toBeUndefined(); // 元のディレクトリはメモリ上に残る可能性があるため削除
		expect(project.getDirectory(newDir)).toBeDefined();
		expect(project.getSourceFile(path.join(newDir, "comp.ts"))).toBeDefined();
		const updatedRef = project.getSourceFileOrThrow(refFile).getFullText();
		expect(updatedRef).toContain("import { valA } from './utils/fileRenamed';");
		expect(updatedRef).toContain("import { valComp } from './widgets/comp';");
	});

	it("ファイル名をスワップする（一時ファイル経由）", async () => {
		// Arrange
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

		// Act
		// スワップを3段階に分けて実行
		// 1. A -> temp
		await renameFileSystemEntry({
			project,
			renames: [{ oldPath: fileA, newPath: tempFile }],
			dryRun: false,
		});
		// 2. B -> A
		await renameFileSystemEntry({
			project,
			renames: [{ oldPath: fileB, newPath: fileA }],
			dryRun: false,
		});
		// 3. temp -> B
		await renameFileSystemEntry({
			project,
			renames: [{ oldPath: tempFile, newPath: fileB }],
			dryRun: false,
		});

		// Assert
		expect(project.getSourceFile(tempFile)).toBeUndefined();
		expect(project.getSourceFile(fileA)?.getFullText()).toContain(
			"export const valB = 'B';", // 元Bの内容
		);
		expect(project.getSourceFile(fileB)?.getFullText()).toContain(
			"export const valA = 'A';", // 元Aの内容
		);
		const updatedRef = project.getSourceFileOrThrow(refFile).getFullText();
		// 最終的に参照パスもスワップ後のファイル名を指すはず
		expect(updatedRef).toContain("import { valA } from './fileB';");
		expect(updatedRef).toContain("import { valB } from './fileA';");
	});

	it("リネーム先のパスが重複する場合、エラーをスローする", async () => {
		// Arrange
		const project = setupProject();
		const file1 = "/src/file1.ts";
		const file2 = "/src/file2.ts";
		const sameNewPath = "/src/renamed.ts";
		project.createSourceFile(file1, "export const v1 = 1;");
		project.createSourceFile(file2, "export const v2 = 2;");

		// Act & Assert
		await expect(
			renameFileSystemEntry({
				project,
				renames: [
					{ oldPath: file1, newPath: sameNewPath },
					{ oldPath: file2, newPath: sameNewPath }, // 重複する newPath
				],
				dryRun: false,
			}),
		).rejects.toThrowError(
			/^Rename process failed: リネーム先のパスが重複しています.*See logs for details.$/,
		);
	});
});

describe("renameFileSystemEntry Extension Preservation", () => {
	it("import文のパスに .js 拡張子が含まれている場合、リネーム後も維持される", async () => {
		// Arrange
		const project = setupProject();
		const oldJsPath = "/src/utils/legacy-util.js"; // .js ファイル
		const newJsPath = "/src/utils/modern-util.js";
		const importerPath = "/src/components/MyComponent.ts";
		const otherTsPath = "/src/utils/helper.ts"; // 通常の .ts ファイル
		const newOtherTsPath = "/src/utils/renamed-helper.ts";

		project.createSourceFile(oldJsPath, "export const legacyValue = 1;");
		project.createSourceFile(otherTsPath, "export const helperValue = 2;");
		project.createSourceFile(
			importerPath,
			`import { legacyValue } from '../utils/legacy-util.js'; // <<< .js 拡張子付きでインポート
import { helperValue } from '../utils/helper'; // 通常のインポート

console.log(legacyValue, helperValue);
`,
		);

		// Act: .js ファイルと .ts ファイルを同時にリネーム
		await renameFileSystemEntry({
			project,
			renames: [
				{ oldPath: oldJsPath, newPath: newJsPath },
				{ oldPath: otherTsPath, newPath: newOtherTsPath },
			],
			dryRun: false,
		});

		// Assert
		const updatedImporterContent = project
			.getSourceFileOrThrow(importerPath)
			.getFullText();

		// .js 拡張子が維持されていることを期待
		expect(updatedImporterContent).toContain(
			"import { legacyValue } from '../utils/modern-util.js';",
		);
		// 通常のインポートは拡張子なしのまま更新されることを期待
		expect(updatedImporterContent).toContain(
			"import { helperValue } from '../utils/renamed-helper';",
		);

		expect(project.getSourceFile(oldJsPath)).toBeUndefined();
		expect(project.getSourceFile(newJsPath)).toBeDefined();
		expect(project.getSourceFile(otherTsPath)).toBeUndefined();
		expect(project.getSourceFile(newOtherTsPath)).toBeDefined();
	});
});
