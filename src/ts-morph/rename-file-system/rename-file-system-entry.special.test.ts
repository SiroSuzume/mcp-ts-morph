import { describe, it, expect } from "vitest";
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

	return project;
};

describe("renameFileSystemEntry Special Cases", () => {
	it("dryRun: true の場合、ファイルシステム（メモリ上）の変更を行わず、変更予定リストを返す", async () => {
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

		const result = await renameFileSystemEntry({
			project,
			renames: [{ oldPath: oldUtilPath, newPath: newUtilPath }],
			dryRun: true,
		});

		expect(project.getSourceFile(oldUtilPath)).toBeUndefined();
		expect(project.getSourceFile(newUtilPath)).toBeDefined();

		expect(result.changedFiles).toContain(newUtilPath);
		expect(result.changedFiles).toContain(componentPath);
		expect(result.changedFiles).not.toContain(oldUtilPath);
	});

	it("どのファイルからも参照されていないファイルをリネームする", async () => {
		const project = setupProject();
		const oldPath = "/src/utils/unreferenced.ts";
		const newPath = "/src/utils/renamed-unreferenced.ts";
		project.createSourceFile(oldPath, "export const lonely = true;");

		const result = await renameFileSystemEntry({
			project,
			renames: [{ oldPath, newPath }],
			dryRun: false,
		});

		expect(project.getSourceFile(oldPath)).toBeUndefined();
		expect(project.getSourceFile(newPath)).toBeDefined();
		expect(project.getSourceFileOrThrow(newPath).getFullText()).toContain(
			"export const lonely = true;",
		);
		expect(result.changedFiles).toEqual([newPath]);
	});

	it("デフォルトインポートのパスが正しく更新される", async () => {
		const project = setupProject();
		const oldDefaultPath = "/src/utils/defaultExport.ts";
		const newDefaultPath = "/src/utils/renamedDefaultExport.ts";
		const importerPath = "/src/importer.ts";

		project.createSourceFile(
			oldDefaultPath,
			"export default function myDefaultFunction() { return 'default'; }",
		);
		project.createSourceFile(
			importerPath,
			"import MyDefaultImport from './utils/defaultExport';\nconsole.log(MyDefaultImport());",
		);

		await renameFileSystemEntry({
			project,
			renames: [{ oldPath: oldDefaultPath, newPath: newDefaultPath }],
			dryRun: false,
		});

		const updatedImporterContent = project
			.getSourceFileOrThrow(importerPath)
			.getFullText();
		expect(project.getSourceFile(oldDefaultPath)).toBeUndefined();
		expect(project.getSourceFile(newDefaultPath)).toBeDefined();
		expect(updatedImporterContent).toContain(
			"import MyDefaultImport from './utils/renamedDefaultExport';",
		);
	});

	it("デフォルトエクスポートされた変数 (export default variableName) のパスが正しく更新される", async () => {
		const project = setupProject();
		const oldVarDefaultPath = "/src/utils/variableDefaultExport.ts";
		const newVarDefaultPath = "/src/utils/renamedVariableDefaultExport.ts";
		const importerPath = "/src/importerVar.ts";

		project.createSourceFile(
			oldVarDefaultPath,
			"const myVar = { value: 'default var' };\nexport default myVar;",
		);
		project.createSourceFile(
			importerPath,
			"import MyVarImport from './utils/variableDefaultExport';\nconsole.log(MyVarImport.value);",
		);

		await renameFileSystemEntry({
			project,
			renames: [{ oldPath: oldVarDefaultPath, newPath: newVarDefaultPath }],
			dryRun: false,
		});

		const updatedImporterContent = project
			.getSourceFileOrThrow(importerPath)
			.getFullText();
		expect(project.getSourceFile(oldVarDefaultPath)).toBeUndefined();
		expect(project.getSourceFile(newVarDefaultPath)).toBeDefined();
		expect(updatedImporterContent).toContain(
			"import MyVarImport from './utils/renamedVariableDefaultExport';",
		);
	});
});

describe("renameFileSystemEntry Extension Preservation", () => {
	it("import文のパスに .js 拡張子が含まれている場合、リネーム後も維持される", async () => {
		const project = setupProject();
		const oldJsPath = "/src/utils/legacy-util.js";
		const newJsPath = "/src/utils/modern-util.js";
		const importerPath = "/src/components/MyComponent.ts";
		const otherTsPath = "/src/utils/helper.ts";
		const newOtherTsPath = "/src/utils/renamed-helper.ts";

		project.createSourceFile(oldJsPath, "export const legacyValue = 1;");
		project.createSourceFile(otherTsPath, "export const helperValue = 2;");
		project.createSourceFile(
			importerPath,
			`import { legacyValue } from '../utils/legacy-util.js';
import { helperValue } from '../utils/helper';

console.log(legacyValue, helperValue);
`,
		);

		await renameFileSystemEntry({
			project,
			renames: [
				{ oldPath: oldJsPath, newPath: newJsPath },
				{ oldPath: otherTsPath, newPath: newOtherTsPath },
			],
			dryRun: false,
		});

		const updatedImporterContent = project
			.getSourceFileOrThrow(importerPath)
			.getFullText();

		expect(updatedImporterContent).toContain(
			"import { legacyValue } from '../utils/modern-util.js';",
		);
		expect(updatedImporterContent).toContain(
			"import { helperValue } from '../utils/renamed-helper';",
		);

		expect(project.getSourceFile(oldJsPath)).toBeUndefined();
		expect(project.getSourceFile(newJsPath)).toBeDefined();
		expect(project.getSourceFile(otherTsPath)).toBeUndefined();
		expect(project.getSourceFile(newOtherTsPath)).toBeDefined();
	});
});

describe("renameFileSystemEntry with index.ts re-exports", () => {
	it("index.ts が 'export * from \"./moduleB\"' 形式で moduleB.ts を再エクスポートし、moduleB.ts をリネームした場合", async () => {
		const project = setupProject();
		const utilsDir = "/src/utils";
		const moduleBOriginalPath = `${utilsDir}/moduleB.ts`;
		const moduleBRenamedPath = `${utilsDir}/moduleBRenamed.ts`;
		const indexTsPath = `${utilsDir}/index.ts`;
		const componentPath = "/src/components/MyComponent.ts";

		project.createSourceFile(
			moduleBOriginalPath,
			"export const importantValue = 'Hello from B';",
		);
		project.createSourceFile(indexTsPath, 'export * from "./moduleB";');
		project.createSourceFile(
			componentPath,
			"import { importantValue } from '@/utils';\\nconsole.log(importantValue);",
		);

		const result = await renameFileSystemEntry({
			project,
			renames: [{ oldPath: moduleBOriginalPath, newPath: moduleBRenamedPath }],
			dryRun: false,
		});

		expect(project.getSourceFile(moduleBOriginalPath)).toBeUndefined();
		expect(project.getSourceFile(moduleBRenamedPath)).toBeDefined();
		expect(project.getSourceFileOrThrow(moduleBRenamedPath).getFullText()).toBe(
			"export const importantValue = 'Hello from B';",
		);

		const indexTsContent = project
			.getSourceFileOrThrow(indexTsPath)
			.getFullText();
		expect(indexTsContent).toContain('export * from "./moduleBRenamed";');
		expect(indexTsContent).not.toContain('export * from "./moduleB";');

		const componentContent = project
			.getSourceFileOrThrow(componentPath)
			.getFullText();
		expect(componentContent).toContain(
			"import { importantValue } from '../utils/moduleBRenamed';",
		);

		expect(result.changedFiles).toHaveLength(3);
		expect(result.changedFiles).toEqual(
			expect.arrayContaining([moduleBRenamedPath, indexTsPath, componentPath]),
		);
	});

	it("index.ts が 'export { specificExport } from \"./moduleC\"' 形式で moduleC.ts を再エクスポートし、moduleC.ts をリネームした場合", async () => {
		const project = setupProject();
		const utilsDir = "/src/utils";
		const moduleCOriginalPath = `${utilsDir}/moduleC.ts`;
		const moduleCRenamedPath = `${utilsDir}/moduleCRenamed.ts`;
		const indexTsPath = `${utilsDir}/index.ts`;
		const componentPath = "/src/components/MyComponentForC.ts";

		project.createSourceFile(
			moduleCOriginalPath,
			"export const specificExport = 'Hello from C';",
		);
		project.createSourceFile(
			indexTsPath,
			'export { specificExport } from "./moduleC";',
		);
		project.createSourceFile(
			componentPath,
			"import { specificExport } from '@/utils';\\nconsole.log(specificExport);",
		);

		const result = await renameFileSystemEntry({
			project,
			renames: [{ oldPath: moduleCOriginalPath, newPath: moduleCRenamedPath }],
			dryRun: false,
		});

		expect(project.getSourceFile(moduleCOriginalPath)).toBeUndefined();
		expect(project.getSourceFile(moduleCRenamedPath)).toBeDefined();
		expect(project.getSourceFileOrThrow(moduleCRenamedPath).getFullText()).toBe(
			"export const specificExport = 'Hello from C';",
		);

		const indexTsContent = project
			.getSourceFileOrThrow(indexTsPath)
			.getFullText();
		expect(indexTsContent).toContain(
			'export { specificExport } from "./moduleCRenamed";',
		);
		expect(indexTsContent).not.toContain(
			'export { specificExport } from "./moduleC";',
		);

		const componentContent = project
			.getSourceFileOrThrow(componentPath)
			.getFullText();
		expect(componentContent).toContain(
			"import { specificExport } from '../utils/moduleCRenamed';",
		);

		expect(result.changedFiles).toHaveLength(3);
		expect(result.changedFiles).toEqual(
			expect.arrayContaining([moduleCRenamedPath, indexTsPath, componentPath]),
		);
	});

	it("index.ts が再エクスポートを行い、その utils ディレクトリ全体をリネームした場合", async () => {
		const project = setupProject();
		const oldUtilsDir = "/src/utils";
		const newUtilsDir = "/src/newUtils";

		const moduleDOriginalPath = `${oldUtilsDir}/moduleD.ts`;
		const indexTsOriginalPath = `${oldUtilsDir}/index.ts`;
		const componentPath = "/src/components/MyComponentForD.ts";

		project.createSourceFile(
			moduleDOriginalPath,
			"export const valueFromD = 'Hello from D';",
		);
		project.createSourceFile(indexTsOriginalPath, 'export * from "./moduleD";');
		project.createSourceFile(
			componentPath,
			"import { valueFromD } from '@/utils';\\nconsole.log(valueFromD);",
		);

		const result = await renameFileSystemEntry({
			project,
			renames: [{ oldPath: oldUtilsDir, newPath: newUtilsDir }],
			dryRun: false,
		});

		const moduleDRenamedPath = `${newUtilsDir}/moduleD.ts`;
		const indexTsRenamedPath = `${newUtilsDir}/index.ts`;

		expect(project.getSourceFile(moduleDOriginalPath)).toBeUndefined();
		expect(project.getSourceFile(indexTsOriginalPath)).toBeUndefined();
		// expect(project.getDirectory(oldUtilsDir)).toBeUndefined(); // ユーザーの指示によりコメントアウト

		expect(project.getDirectory(newUtilsDir)).toBeDefined();
		expect(project.getSourceFile(moduleDRenamedPath)).toBeDefined();
		expect(project.getSourceFile(indexTsRenamedPath)).toBeDefined();

		expect(project.getSourceFileOrThrow(moduleDRenamedPath).getFullText()).toBe(
			"export const valueFromD = 'Hello from D';",
		);
		expect(project.getSourceFileOrThrow(indexTsRenamedPath).getFullText()).toBe(
			'export * from "./moduleD";',
		);

		const componentContent = project
			.getSourceFileOrThrow(componentPath)
			.getFullText();
		expect(componentContent).toContain(
			"import { valueFromD } from '../newUtils/index';",
		);

		expect(result.changedFiles).toHaveLength(3);
		expect(result.changedFiles).toEqual(
			expect.arrayContaining([
				moduleDRenamedPath,
				indexTsRenamedPath,
				componentPath,
			]),
		);
	});
});

describe("renameFileSystemEntry with index.ts re-exports (actual bug reproduction)", () => {
	it("index.tsが複数のモジュールを再エクスポートし、そのうちの1つをリネームした際、インポート元のパスがindex.tsを指し続けること", async () => {
		const project = setupProject();
		const utilsDir = "/src/utils";
		const moduleAOriginalPath = `${utilsDir}/moduleA.ts`;
		const moduleARenamedPath = `${utilsDir}/moduleARenamed.ts`;
		const moduleBPath = `${utilsDir}/moduleB.ts`;
		const indexTsPath = `${utilsDir}/index.ts`;
		const componentPath = "/src/components/MyComponent.ts";

		project.createSourceFile(
			moduleAOriginalPath,
			"export const funcA = () => 'original_A';",
		);
		project.createSourceFile(moduleBPath, "export const funcB = () => 'B';");
		project.createSourceFile(
			indexTsPath,
			'export * from "./moduleA";\nexport * from "./moduleB";',
		);
		project.createSourceFile(
			componentPath,
			"import { funcA, funcB } from '@/utils';\nconsole.log(funcA(), funcB());",
		);

		const originalComponentContent = project
			.getSourceFileOrThrow(componentPath)
			.getFullText();

		const result = await renameFileSystemEntry({
			project,
			renames: [{ oldPath: moduleAOriginalPath, newPath: moduleARenamedPath }],
			dryRun: false,
		});

		// 1. moduleA.ts がリネームされていること
		expect(project.getSourceFile(moduleAOriginalPath)).toBeUndefined();
		expect(project.getSourceFile(moduleARenamedPath)).toBeDefined();
		expect(project.getSourceFileOrThrow(moduleARenamedPath).getFullText()).toBe(
			"export const funcA = () => 'original_A';",
		);

		// 2. index.ts が正しく更新されていること
		const indexTsContent = project
			.getSourceFileOrThrow(indexTsPath)
			.getFullText();
		expect(indexTsContent).toContain('export * from "./moduleARenamed";');
		expect(indexTsContent).toContain('export * from "./moduleB";');
		expect(indexTsContent).not.toContain('export * from "./moduleA";');

		// 3. MyComponent.ts のインポートパスが変更されていないこと
		const updatedComponentContent = project
			.getSourceFileOrThrow(componentPath)
			.getFullText();
		expect(updatedComponentContent).toBe(originalComponentContent);
		// さらに具体的に確認
		expect(updatedComponentContent).toContain(
			"import { funcA, funcB } from '@/utils';",
		);

		// 4. 変更されたファイルのリスト確認
		// moduleARenamed.ts と index.ts のみが変更されているはず
		expect(result.changedFiles).toHaveLength(2);
		expect(result.changedFiles).toEqual(
			expect.arrayContaining([moduleARenamedPath, indexTsPath]),
		);
	});
});
