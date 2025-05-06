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

	// 共通のディレクトリ構造をメモリ上に作成
	project.createDirectory("/src");
	project.createDirectory("/src/utils");
	project.createDirectory("/src/components");
	project.createDirectory("/src/myFeature");
	project.createDirectory("/src/anotherFeature");
	project.createDirectory("/src/featureA");
	project.createDirectory("/src/core");

	return project;
};

describe("renameFileSystemEntry Index File Cases", () => {
	it("index.ts ファイル自体をリネームする", async () => {
		const project = setupProject();
		const oldIndexPath = "/src/utils/index.ts";
		const newIndexPath = "/src/utils/main.ts";
		const componentPath = "/src/components/MyComponent.ts";

		project.createSourceFile(oldIndexPath, "export const utilFromIndex = 1;");
		project.createSourceFile(
			componentPath,
			"import { utilFromIndex } from '../utils';",
		);

		await renameFileSystemEntry({
			project,
			renames: [{ oldPath: oldIndexPath, newPath: newIndexPath }],
			dryRun: false,
		});

		expect(project.getSourceFile(oldIndexPath)).toBeUndefined();
		expect(project.getSourceFile(newIndexPath)).toBeDefined();
		const updatedComponent = project.getSourceFileOrThrow(componentPath);
		// index.ts をリネームした場合、ディレクトリ参照はリネーム後のファイル名になるべき
		expect(updatedComponent.getFullText()).toContain(
			"import { utilFromIndex } from '../utils/main';",
		);
	});

	it("ディレクトリリネーム時に、内部からの '.' や外部からの '..' による index.ts 参照が正しく更新される", async () => {
		const project = setupProject();
		const oldDirPath = "/src/featureA";
		const newDirPath = "/src/featureRenamed";
		const indexTsPath = path.join(oldDirPath, "index.ts");
		const componentTsPath = path.join(oldDirPath, "component.ts");
		const serviceTsPath = "/src/core/service.ts";

		project.createSourceFile(indexTsPath, "export const featureValue = 'A';");
		project.createSourceFile(
			componentTsPath,
			"import { featureValue } from '.';",
		);
		project.createSourceFile(
			serviceTsPath,
			"import { featureValue } from '../featureA';",
		);

		await renameFileSystemEntry({
			project,
			renames: [{ oldPath: oldDirPath, newPath: newDirPath }],
			dryRun: false,
		});

		const newComponentTsPath = path.join(newDirPath, "component.ts");
		const updatedComponent = project.getSourceFileOrThrow(newComponentTsPath);
		const updatedService = project.getSourceFileOrThrow(serviceTsPath);

		expect(updatedComponent.getFullText()).toContain(
			"import { featureValue } from '.';",
		);

		// service.ts の '../featureA' 参照は '../featureRenamed/index' に更新されるはず
		expect(updatedService.getFullText()).toContain(
			"import { featureValue } from '../featureRenamed/index';",
		);
	});

	it("index.ts でデフォルトエクスポートされた変数をパスエイリアス付きディレクトリ名でインポートしている場合、index.ts リネーム時にパスが正しく更新される", async () => {
		const project = setupProject();
		const featureDir = "/src/myFeature";
		const oldIndexPath = path.join(featureDir, "index.ts");
		const newIndexPath = path.join(featureDir, "mainComponent.ts");
		const importerPath = "/src/app.ts";

		project.createSourceFile(
			oldIndexPath,
			"const MyFeatureComponent = () => {};\nexport default MyFeatureComponent;",
		);
		project.createSourceFile(
			importerPath,
			"import MyFeature from '@/myFeature';\nMyFeature();",
		);

		await renameFileSystemEntry({
			project,
			renames: [{ oldPath: oldIndexPath, newPath: newIndexPath }],
			dryRun: false,
		});

		const updatedImporterContent = project
			.getSourceFileOrThrow(importerPath)
			.getFullText();
		expect(project.getSourceFile(oldIndexPath)).toBeUndefined();
		expect(project.getSourceFile(newIndexPath)).toBeDefined();
		// パスエイリアス参照がリネーム後のファイルパスに更新されることを期待。
		expect(updatedImporterContent).toContain(
			"import MyFeature from './myFeature/mainComponent';",
		);
	});

	it("index.ts でデフォルトエクスポートされた関数をパスエイリアス付きディレクトリ名でインポートしている場合、index.ts リネーム時にパスが正しく更新される", async () => {
		const project = setupProject();
		const featureDir = "/src/anotherFeature";
		const oldIndexPath = path.join(featureDir, "index.ts");
		const newIndexPath = path.join(featureDir, "coreFunction.ts");
		const importerPath = "/src/main.ts";

		project.createSourceFile(
			oldIndexPath,
			"export default function myCoreFunction() {}\n",
		);
		project.createSourceFile(
			importerPath,
			"import CoreFunc from '@/anotherFeature';\nCoreFunc();",
		);

		await renameFileSystemEntry({
			project,
			renames: [{ oldPath: oldIndexPath, newPath: newIndexPath }],
			dryRun: false,
		});

		const updatedImporterContent = project
			.getSourceFileOrThrow(importerPath)
			.getFullText();
		expect(project.getSourceFile(oldIndexPath)).toBeUndefined();
		expect(project.getSourceFile(newIndexPath)).toBeDefined();
		// パスエイリアス参照がリネーム後のファイルパスに更新されることを期待。
		expect(updatedImporterContent).toContain(
			"import CoreFunc from './anotherFeature/coreFunction';",
		);
	});
});
