import { describe, it, expect } from "vitest";
import { Project } from "ts-morph";
import * as path from "node:path";
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

	// 共通のディレクトリ構造をメモリ上に作成
	project.createDirectory("/src");
	project.createDirectory("/src/utils");
	project.createDirectory("/src/components");
	project.createDirectory("/src/old-feature");
	project.createDirectory("/src/myFeature");
	project.createDirectory("/src/anotherFeature");
	project.createDirectory("/src/dirA");
	project.createDirectory("/src/dirB");
	project.createDirectory("/src/dirC");
	project.createDirectory("/src/core");
	project.createDirectory("/src/widgets");

	return project;
};

describe("renameFileSystemEntry Base Cases", () => {
	it("ファイルリネーム時に相対パスとエイリアスパスのimport文を正しく更新する", async () => {
		const project = setupProject();
		const oldUtilPath = "/src/utils/old-util.ts";
		const newUtilPath = "/src/utils/new-util.ts";
		const componentPath = "/src/components/MyComponent.ts";
		const utilIndexPath = "/src/utils/index.ts";

		project.createSourceFile(
			oldUtilPath,
			'export const oldUtil = () => "old";',
		);
		project.createSourceFile(utilIndexPath, 'export * from "./old-util";');
		project.createSourceFile(
			componentPath,
			`import { oldUtil as relativeImport } from '../utils/old-util';
import { oldUtil as aliasImport } from '@/utils/old-util';
import { oldUtil as indexImport } from '../utils';

console.log(relativeImport(), aliasImport(), indexImport());
`,
		);

		await renameFileSystemEntry({
			project,
			renames: [{ oldPath: oldUtilPath, newPath: newUtilPath }],
			dryRun: false,
		});

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
		expect(project.getSourceFile(oldUtilPath)).toBeUndefined();
		expect(project.getSourceFile(newUtilPath)).toBeDefined();
	});

	it("フォルダリネーム時に相対パスとエイリアスパスのimport文を正しく更新する", async () => {
		const project = setupProject();
		const oldFeatureDir = "/src/old-feature";
		const newFeatureDir = "/src/new-feature";
		const featureFilePath = path.join(oldFeatureDir, "feature.ts");
		const componentPath = "/src/components/AnotherComponent.ts";
		const featureIndexPath = path.join(oldFeatureDir, "index.ts");

		project.createSourceFile(
			featureFilePath,
			'export const feature = () => "feature";',
		);
		project.createSourceFile(featureIndexPath, 'export * from "./feature";');
		project.createSourceFile(
			componentPath,
			`import { feature as relativeImport } from '../old-feature/feature';
import { feature as aliasImport } from '@/old-feature/feature';
import { feature as indexImport } from '../old-feature';

console.log(relativeImport(), aliasImport(), indexImport());
`,
		);

		await renameFileSystemEntry({
			project,
			renames: [{ oldPath: oldFeatureDir, newPath: newFeatureDir }],
			dryRun: false,
		});

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
			"import { feature as indexImport } from '../new-feature/feature';", // or '../new-feature/index'
		);

		expect(project.getDirectory(newFeatureDir)).toBeDefined();
		expect(
			project.getSourceFile(path.join(newFeatureDir, "feature.ts")),
		).toBeDefined();
		expect(
			project.getSourceFile(path.join(newFeatureDir, "index.ts")),
		).toBeDefined();
	});

	it("同階層(.)や親階層(..)への相対パスimport文を持つファイルをリネームした際に、参照元のパスが正しく更新される", async () => {
		const project = setupProject();
		const dirA = "/src/dirA";
		const dirB = "/src/dirB";

		const fileA1Path = path.join(dirA, "fileA1.ts");
		const fileA2Path = path.join(dirA, "fileA2.ts");
		const fileBPath = path.join(dirB, "fileB.ts");
		const fileA3Path = path.join(dirA, "fileA3.ts");

		project.createSourceFile(fileA1Path, "export const valA1 = 1;");
		project.createSourceFile(fileA2Path, "export const valA2 = 2;");
		project.createSourceFile(
			fileBPath,
			`
import { valA2 } from '../dirA/fileA2';
import { valA1 } from '../dirA/fileA1';
console.log(valA2, valA1);
        `,
		);
		project.createSourceFile(
			fileA3Path,
			`
import { valA2 } from './fileA2';
console.log(valA2);
`,
		);

		const newFileA2Path = path.join(dirA, "renamedA2.ts");

		await renameFileSystemEntry({
			project,
			renames: [{ oldPath: fileA2Path, newPath: newFileA2Path }],
			dryRun: false,
		});

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
		const project = setupProject();
		const dirA = "/src/dirA";
		const dirC = "/src/dirC";

		const fileA1Path = path.join(dirA, "fileA1.ts");
		const fileA2Path = path.join(dirA, "fileA2.ts");

		project.createSourceFile(fileA1Path, "export const valA1 = 1;");
		project.createSourceFile(
			fileA2Path,
			`
import { valA1 } from './fileA1';
console.log(valA1);
`,
		);

		const newFileA1Path = path.join(dirC, "movedA1.ts");

		await renameFileSystemEntry({
			project,
			renames: [{ oldPath: fileA1Path, newPath: newFileA1Path }],
			dryRun: false,
		});

		const updatedFileA2Content = project
			.getSourceFileOrThrow(fileA2Path)
			.getFullText();
		expect(updatedFileA2Content).toContain(
			"import { valA1 } from '../dirC/movedA1';",
		);

		expect(project.getSourceFile(fileA1Path)).toBeUndefined();
		expect(project.getSourceFile(newFileA1Path)).toBeDefined();
	});
});
