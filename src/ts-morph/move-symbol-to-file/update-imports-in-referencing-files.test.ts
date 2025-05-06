import { describe, it, expect } from "vitest";
import { Project, IndentationText, QuoteKind } from "ts-morph";
import { updateImportsInReferencingFiles } from "./update-imports-in-referencing-files";

describe("updateImportsInReferencingFiles", () => {
	const oldDirPath = "/src/moduleA";
	const oldFilePath = `${oldDirPath}/old-location.ts`;
	const moduleAIndexPath = `${oldDirPath}/index.ts`;
	const newFilePath = "/src/moduleC/new-location.ts";

	// --- Setup Helper Function ---
	const setupTestProject = () => {
		const project = new Project({
			manipulationSettings: {
				indentationText: IndentationText.TwoSpaces,
				quoteKind: QuoteKind.Single,
			},
			useInMemoryFileSystem: true,
			compilerOptions: {
				baseUrl: ".",
				paths: {
					"@/*": ["src/*"],
				},
				typeRoots: [],
			},
		});

		project.createDirectory("/src");
		project.createDirectory(oldDirPath);
		project.createDirectory("/src/moduleB");
		project.createDirectory("/src/moduleC");
		project.createDirectory("/src/moduleD");
		project.createDirectory("/src/moduleE");
		project.createDirectory("/src/moduleF");
		project.createDirectory("/src/moduleG");

		// Use literal strings for symbols in setup
		project.createSourceFile(
			oldFilePath,
			`export const exportedSymbol = 123;
export const anotherSymbol = 456;
export type MyType = { id: number };
`,
		);

		project.createSourceFile(
			moduleAIndexPath,
			`export { exportedSymbol, anotherSymbol } from './old-location';
export type { MyType } from './old-location';
`,
		);

		const importerRel = project.createSourceFile(
			"/src/moduleB/importer-relative.ts",
			`import { exportedSymbol } from '../moduleA/old-location';\nconsole.log(exportedSymbol);`,
		);

		const importerAlias = project.createSourceFile(
			"/src/moduleD/importer-alias.ts",
			`import { anotherSymbol } from '@/moduleA/old-location';\nconsole.log(anotherSymbol);`,
		);

		const importerIndex = project.createSourceFile(
			"/src/moduleE/importer-index.ts",
			`import { exportedSymbol } from '../moduleA';\nconsole.log(exportedSymbol);`,
		);

		const importerMulti = project.createSourceFile(
			"/src/moduleF/importer-multi.ts",
			`import { exportedSymbol, anotherSymbol } from '../moduleA/old-location';\nconsole.log(exportedSymbol, anotherSymbol);`,
		);

		const importerType = project.createSourceFile(
			"/src/moduleG/importer-type.ts",
			`import type { MyType } from '../moduleA/old-location';\nlet val: MyType;`,
		);

		const noRefFile = project.createSourceFile(
			"/src/no-ref.ts",
			'console.log("hello");',
		);

		return {
			project,
			importerRelPath: "/src/moduleB/importer-relative.ts",
			importerAliasPath: "/src/moduleD/importer-alias.ts",
			importerIndexPath: "/src/moduleE/importer-index.ts",
			importerMultiPath: "/src/moduleF/importer-multi.ts",
			importerTypePath: "/src/moduleG/importer-type.ts",
			noRefFilePath: "/src/no-ref.ts",
			oldFilePath,
			newFilePath,
		};
	};

	it("相対パスでインポートしているファイルのパスを正しく更新する", async () => {
		const { project, oldFilePath, newFilePath, importerRelPath } =
			setupTestProject();
		await updateImportsInReferencingFiles(
			project,
			oldFilePath,
			newFilePath,
			"exportedSymbol",
		);
		const expected = `import { exportedSymbol } from '../moduleC/new-location';
console.log(exportedSymbol);`;
		expect(project.getSourceFile(importerRelPath)?.getText()).toBe(expected);
	});

	it("エイリアスパスでインポートしているファイルのパスを正しく更新する (相対パスになる)", async () => {
		const { project, oldFilePath, newFilePath, importerAliasPath } =
			setupTestProject();
		await updateImportsInReferencingFiles(
			project,
			oldFilePath,
			newFilePath,
			"anotherSymbol",
		);
		const expected = `import { anotherSymbol } from '../moduleC/new-location';
console.log(anotherSymbol);`;
		expect(project.getSourceFile(importerAliasPath)?.getText()).toBe(expected);
	});

	it("複数のファイルから参照されている場合、指定したシンボルのパスのみ更新する", async () => {
		const {
			project,
			oldFilePath,
			newFilePath,
			importerRelPath,
			importerAliasPath,
		} = setupTestProject();
		await updateImportsInReferencingFiles(
			project,
			oldFilePath,
			newFilePath,
			"exportedSymbol",
		);

		const expectedRel = `import { exportedSymbol } from '../moduleC/new-location';
console.log(exportedSymbol);`;
		expect(project.getSourceFile(importerRelPath)?.getText()).toBe(expectedRel);

		const expectedAlias = `import { anotherSymbol } from '@/moduleA/old-location';
console.log(anotherSymbol);`;
		expect(project.getSourceFile(importerAliasPath)?.getText()).toBe(
			expectedAlias,
		);
	});

	it("複数の名前付きインポートを持つファイルのパスを、指定したシンボルのみ更新する", async () => {
		const { project, oldFilePath, newFilePath, importerMultiPath } =
			setupTestProject();
		const symbolToMove = "exportedSymbol";

		await updateImportsInReferencingFiles(
			project,
			oldFilePath,
			newFilePath,
			symbolToMove,
		);

		const expected = `import { anotherSymbol } from '../moduleA/old-location';
import { exportedSymbol } from '../moduleC/new-location';

console.log(exportedSymbol, anotherSymbol);`;
		expect(project.getSourceFile(importerMultiPath)?.getText()).toBe(expected);
	});

	it("Typeインポートを持つファイルのパスを正しく更新する", async () => {
		const { project, oldFilePath, newFilePath, importerTypePath } =
			setupTestProject();
		await updateImportsInReferencingFiles(
			project,
			oldFilePath,
			newFilePath,
			"MyType",
		);
		const expected = `import type { MyType } from '../moduleC/new-location';
let val: MyType;`;
		expect(project.getSourceFile(importerTypePath)?.getText()).toBe(expected);
	});

	it("移動元ファイルへの参照がない場合、エラーなく完了し、他のファイルは変更されない", async () => {
		const { project, oldFilePath, newFilePath, noRefFilePath } =
			setupTestProject();
		const originalContent =
			project.getSourceFile(noRefFilePath)?.getText() ?? "";

		await expect(
			updateImportsInReferencingFiles(
				project,
				oldFilePath,
				newFilePath,
				"exportedSymbol",
			),
		).resolves.toBeUndefined();

		expect(project.getSourceFile(noRefFilePath)?.getText()).toBe(
			originalContent,
		);
	});

	it("移動先ファイルが元々移動元シンボルをインポートしていた場合、そのインポート指定子/宣言を削除する", async () => {
		const project = new Project({ useInMemoryFileSystem: true });
		const oldPath = "/src/old.ts";
		const newPath = "/src/new.ts";

		project.createSourceFile(
			oldPath,
			"export const symbolToMove = 1; export const keepSymbol = 2;",
		);
		const referencingFile = project.createSourceFile(
			newPath,
			`import { symbolToMove, keepSymbol } from './old';
console.log(symbolToMove, keepSymbol);`,
		);

		await updateImportsInReferencingFiles(
			project,
			oldPath,
			newPath,
			"symbolToMove",
		);

		const expected = `import { keepSymbol } from './old';
console.log(symbolToMove, keepSymbol);`;
		expect(referencingFile.getText()).toBe(expected);

		// --- ケース2: 移動対象シンボルのみインポートしていた場合 ---
		const project2 = new Project({ useInMemoryFileSystem: true });
		project2.createSourceFile(oldPath, "export const symbolToMove = 1;");
		const referencingFile2 = project2.createSourceFile(
			newPath,
			`import { symbolToMove } from './old';
console.log(symbolToMove);`,
		);

		await updateImportsInReferencingFiles(
			project2,
			oldPath,
			newPath,
			"symbolToMove",
		);

		expect(referencingFile2.getText()).toBe("console.log(symbolToMove);");
	});

	// --- 【制限事項確認】将来的に対応したいケース ---
	it.skip("【制限事項】バレルファイル経由でインポートしているファイルのパスは更新される", async () => {
		const { project, oldFilePath, newFilePath, importerIndexPath } =
			setupTestProject();
		await updateImportsInReferencingFiles(
			project,
			oldFilePath,
			newFilePath,
			"exportedSymbol",
		);
		const updatedContent =
			project.getSourceFile(importerIndexPath)?.getText() ?? "";
		const expectedImportPath = "../../moduleC/new-location";
		const expected = `import { exportedSymbol } from '${expectedImportPath}';
console.log(exportedSymbol);`;
		expect(updatedContent).toBe(expected);
	});
});
