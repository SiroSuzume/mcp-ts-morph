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
