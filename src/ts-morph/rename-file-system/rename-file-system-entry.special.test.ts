import { describe, it, expect } from "vitest";
import { createInMemoryProject } from "../_test-utils/create-in-memory-project";
import { expectFileMoved } from "../_test-utils/expect-file-moved";
import { renameFileSystemEntry } from "./rename-file-system-entry";
import { getFileText } from "../_test-utils/get-file-text";

describe("renameFileSystemEntry Special Cases", () => {
	it("dryRun: true の場合、ファイルシステム（メモリ上）の変更を行わず、変更予定リストを返す", async () => {
		const project = createInMemoryProject();
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

		expectFileMoved(project, oldUtilPath, newUtilPath);

		expect(result.changedFiles).toContain(newUtilPath);
		expect(result.changedFiles).toContain(componentPath);
		expect(result.changedFiles).not.toContain(oldUtilPath);
	});

	it("どのファイルからも参照されていないファイルをリネームする", async () => {
		const project = createInMemoryProject();
		const oldPath = "/src/utils/unreferenced.ts";
		const newPath = "/src/utils/renamed-unreferenced.ts";
		project.createSourceFile(oldPath, "export const lonely = true;");

		const result = await renameFileSystemEntry({
			project,
			renames: [{ oldPath, newPath }],
			dryRun: false,
		});

		expectFileMoved(project, oldPath, newPath);
		expect(getFileText(project, newPath)).toContain(
			"export const lonely = true;",
		);
		expect(result.changedFiles).toEqual([newPath]);
	});

	it("デフォルトインポートのパスが正しく更新される", async () => {
		const project = createInMemoryProject();
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

		const updatedImporterContent = getFileText(project, importerPath);
		expectFileMoved(project, oldDefaultPath, newDefaultPath);
		expect(updatedImporterContent).toContain(
			"import MyDefaultImport from './utils/renamedDefaultExport';",
		);
	});

	it("デフォルトエクスポートされた変数 (export default variableName) のパスが正しく更新される", async () => {
		const project = createInMemoryProject();
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

		const updatedImporterContent = getFileText(project, importerPath);
		expectFileMoved(project, oldVarDefaultPath, newVarDefaultPath);
		expect(updatedImporterContent).toContain(
			"import MyVarImport from './utils/renamedVariableDefaultExport';",
		);
	});
});

describe("renameFileSystemEntry Extension Preservation", () => {
	it("import文のパスに .js 拡張子が含まれている場合、リネーム後も維持される", async () => {
		const project = createInMemoryProject();
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

		const updatedImporterContent = getFileText(project, importerPath);

		expect(updatedImporterContent).toContain(
			"import { legacyValue } from '../utils/modern-util.js';",
		);
		expect(updatedImporterContent).toContain(
			"import { helperValue } from '../utils/renamed-helper';",
		);

		expectFileMoved(project, oldJsPath, newJsPath);
		expectFileMoved(project, otherTsPath, newOtherTsPath);
	});
});

describe("renameFileSystemEntry with index.ts re-exports", () => {
	it("index.ts が 'export * from \"./moduleB\"' 形式で moduleB.ts を再エクスポートし、moduleB.ts をリネームした場合", async () => {
		const project = createInMemoryProject();
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
			"import { importantValue } from '@/utils';\nconsole.log(importantValue);",
		);

		const result = await renameFileSystemEntry({
			project,
			renames: [{ oldPath: moduleBOriginalPath, newPath: moduleBRenamedPath }],
			dryRun: false,
		});

		expectFileMoved(project, moduleBOriginalPath, moduleBRenamedPath);
		expect(getFileText(project, moduleBRenamedPath)).toBe(
			"export const importantValue = 'Hello from B';",
		);

		const indexTsContent = getFileText(project, indexTsPath);
		expect(indexTsContent).toContain('export * from "./moduleBRenamed";');
		expect(indexTsContent).not.toContain('export * from "./moduleB";');

		const componentContent = getFileText(project, componentPath);
		expect(componentContent).toContain(
			"import { importantValue } from '@/utils';",
		);

		expect(result.changedFiles).toHaveLength(3);
		expect(result.changedFiles).toEqual(
			expect.arrayContaining([moduleBRenamedPath, indexTsPath, componentPath]),
		);
	});

	it("index.ts が 'export { specificExport } from \"./moduleC\"' 形式で moduleC.ts を再エクスポートし、moduleC.ts をリネームした場合", async () => {
		const project = createInMemoryProject();
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
			"import { specificExport } from '@/utils';\nconsole.log(specificExport);",
		);

		const result = await renameFileSystemEntry({
			project,
			renames: [{ oldPath: moduleCOriginalPath, newPath: moduleCRenamedPath }],
			dryRun: false,
		});

		expectFileMoved(project, moduleCOriginalPath, moduleCRenamedPath);
		expect(getFileText(project, moduleCRenamedPath)).toBe(
			"export const specificExport = 'Hello from C';",
		);

		const indexTsContent = getFileText(project, indexTsPath);
		expect(indexTsContent).toContain(
			'export { specificExport } from "./moduleCRenamed";',
		);
		expect(indexTsContent).not.toContain(
			'export { specificExport } from "./moduleC";',
		);

		const componentContent = getFileText(project, componentPath);
		expect(componentContent).toContain(
			"import { specificExport } from '@/utils';",
		);

		expect(result.changedFiles).toHaveLength(3);
		expect(result.changedFiles).toEqual(
			expect.arrayContaining([moduleCRenamedPath, indexTsPath, componentPath]),
		);
	});

	it("index.ts が再エクスポートを行い、その utils ディレクトリ全体をリネームした場合", async () => {
		const project = createInMemoryProject();
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
			"import { valueFromD } from '@/utils';\nconsole.log(valueFromD);",
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
		expect(project.getDirectory(oldUtilsDir)).toBeUndefined();

		expect(project.getDirectory(newUtilsDir)).toBeDefined();
		expect(project.getSourceFile(moduleDRenamedPath)).toBeDefined();
		expect(project.getSourceFile(indexTsRenamedPath)).toBeDefined();

		expect(getFileText(project, moduleDRenamedPath)).toBe(
			"export const valueFromD = 'Hello from D';",
		);
		expect(getFileText(project, indexTsRenamedPath)).toBe(
			'export * from "./moduleD";',
		);

		const componentContent = getFileText(project, componentPath);
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

describe("renameFileSystemEntry with type-only namespace import (issue #26)", () => {
	it("`import type * as X from '@/...'` (type-only namespace import + path-alias) も rename で更新されること", async () => {
		const project = createInMemoryProject();
		const oldTargetPath = "/src/types/request.ts";
		const newTargetPath = "/src/typings/request.ts";
		const usagePath = "/src/usage.ts";

		project.createDirectory("/src/types");
		project.createSourceFile(
			oldTargetPath,
			"export type CreateRequest = { id: string };",
		);
		project.createSourceFile(
			usagePath,
			`import type * as Req from "@/types/request";
import type { CreateRequest } from "@/types/request";

export const a: Req.CreateRequest = { id: "x" };
export const b: CreateRequest = { id: "y" };
`,
		);

		await renameFileSystemEntry({
			project,
			renames: [{ oldPath: oldTargetPath, newPath: newTargetPath }],
			dryRun: false,
		});

		const updatedUsageContent = getFileText(project, usagePath);

		// 旧パスは namespace import (A) / named import (B) 両方から消えていること
		expect(updatedUsageContent).not.toContain("@/types/request");
		// 新パスは 2 つの import 文両方に現れていること
		expect(updatedUsageContent).toContain(
			'import type * as Req from "./typings/request"',
		);
		expect(updatedUsageContent).toContain(
			'import type { CreateRequest } from "./typings/request"',
		);
	});

	it("`import type * as X from './relative'` (type-only namespace import + 相対パス) が rename で更新されること (回帰防止)", async () => {
		const project = createInMemoryProject();
		const oldTargetPath = "/src/types/request.ts";
		const newTargetPath = "/src/typings/request.ts";
		const usagePath = "/src/usage.ts";

		project.createDirectory("/src/types");
		project.createSourceFile(
			oldTargetPath,
			"export type CreateRequest = { id: string };",
		);
		project.createSourceFile(
			usagePath,
			`import type * as Req from "./types/request";

export const a: Req.CreateRequest = { id: "x" };
`,
		);

		await renameFileSystemEntry({
			project,
			renames: [{ oldPath: oldTargetPath, newPath: newTargetPath }],
			dryRun: false,
		});

		const updatedUsageContent = getFileText(project, usagePath);

		expect(updatedUsageContent).not.toContain("./types/request");
		expect(updatedUsageContent).toContain(
			'import type * as Req from "./typings/request"',
		);
	});
});

describe("renameFileSystemEntry with index.ts re-exports (actual bug reproduction)", () => {
	it("index.tsが複数のモジュールを再エクスポートし、そのうちの1つをリネームした際、インポート元のパスがindex.tsを指し続けること", async () => {
		const project = createInMemoryProject();
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

		const originalComponentContent = getFileText(project, componentPath);

		await renameFileSystemEntry({
			project,
			renames: [{ oldPath: moduleAOriginalPath, newPath: moduleARenamedPath }],
			dryRun: false,
		});

		// 1. moduleA.ts がリネームされていること
		expectFileMoved(project, moduleAOriginalPath, moduleARenamedPath);
		expect(getFileText(project, moduleARenamedPath)).toBe(
			"export const funcA = () => 'original_A';",
		);

		// 2. index.ts が正しく更新されていること
		const indexTsContent = getFileText(project, indexTsPath);
		expect(indexTsContent).toContain('export * from "./moduleARenamed";');
		expect(indexTsContent).toContain('export * from "./moduleB";');
		expect(indexTsContent).not.toContain('export * from "./moduleA";');

		// 3. MyComponent.ts のインポートパスが変更されていないこと
		const updatedComponentContent = getFileText(project, componentPath);
		expect(updatedComponentContent).toBe(originalComponentContent);
		// さらに具体的に確認
		expect(updatedComponentContent).toContain(
			"import { funcA, funcB } from '@/utils';",
		);
	});
});
