import { describe, it, expect } from "vitest";
import { Project, IndentationText, QuoteKind } from "ts-morph";
import { updateImportsInReferencingFiles } from "./update-imports-in-referencing-files";

describe("updateImportsInReferencingFiles", () => {
	const oldDirPath = "/src/moduleA";
	const oldFilePath = `${oldDirPath}/old-location.ts`;
	const moduleAIndexPath = `${oldDirPath}/index.ts`;
	const newFilePath = "/src/moduleC/new-location.ts";
	const symbolToMove = "exportedSymbol";
	const anotherSymbol = "anotherSymbol";
	const typeToMove = "MyType";
	const defaultSymbol = "defaultSymbol";

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

		const oldSourceFile = project.createSourceFile(
			oldFilePath,
			`export const ${symbolToMove} = 123;
export const ${anotherSymbol} = 456;
export type ${typeToMove} = { id: number };
export default function ${defaultSymbol}() { return 'default'; }
`,
		);

		project.createSourceFile(
			moduleAIndexPath,
			`export { ${symbolToMove}, ${anotherSymbol} } from './old-location';
export type { ${typeToMove} } from './old-location';
export { default as ${defaultSymbol} } from './old-location';
`,
		);

		const importerRel = project.createSourceFile(
			"/src/moduleB/importer-relative.ts",
			`import { ${symbolToMove} } from '../moduleA/old-location';
console.log(${symbolToMove});`,
		);

		const importerAlias = project.createSourceFile(
			"/src/moduleD/importer-alias.ts",
			`import { ${anotherSymbol} } from '@/moduleA/old-location';
console.log(${anotherSymbol});`,
		);

		const importerIndex = project.createSourceFile(
			"/src/moduleE/importer-index.ts",
			`import { ${symbolToMove} } from '../moduleA';
console.log(${symbolToMove});`,
		);

		const importerMulti = project.createSourceFile(
			"/src/moduleF/importer-multi.ts",
			`import { ${symbolToMove}, ${anotherSymbol} } from '../moduleA/old-location';
console.log(${symbolToMove}, ${anotherSymbol});`,
		);

		const importerDefault = project.createSourceFile(
			"/src/moduleG/importer-default.ts",
			`import myDefault from '../moduleA/old-location';
console.log(myDefault());`,
		);

		const importerType = project.createSourceFile(
			"/src/moduleG/importer-type.ts",
			`import type { ${typeToMove} } from '../moduleA/old-location';
let val: ${typeToMove};`,
		);

		const noRefFile = project.createSourceFile(
			"/src/no-ref.ts",
			'console.log("hello");',
		);

		return {
			project,
			oldSourceFile,
			importerRel,
			importerAlias,
			importerIndex,
			importerMulti,
			importerDefault,
			importerType,
			noRefFile,
		};
	};

	it("相対パスでインポートしているファイルのパスを正しく更新する", async () => {
		const { project, importerRel } = setupTestProject();
		await updateImportsInReferencingFiles(project, oldFilePath, newFilePath);
		const expected = `import { ${symbolToMove} } from '../moduleC/new-location';`;
		expect(importerRel.getText()).toContain(expected);
	});

	it("エイリアスパスでインポートしているファイルのパスを正しく更新する (相対パスになる)", async () => {
		const { project, importerAlias } = setupTestProject();
		await updateImportsInReferencingFiles(project, oldFilePath, newFilePath);
		const expected = `import { ${anotherSymbol} } from '../moduleC/new-location';`;
		expect(importerAlias.getText()).toContain(expected);
	});

	it("複数のファイルから参照されている場合、すべてのファイルのパスを更新する", async () => {
		const { project, importerRel, importerAlias } = setupTestProject();
		await updateImportsInReferencingFiles(project, oldFilePath, newFilePath);
		const expectedRel = `import { ${symbolToMove} } from '../moduleC/new-location';`;
		const expectedAlias = `import { ${anotherSymbol} } from '../moduleC/new-location';`;
		expect(importerRel.getText()).toContain(expectedRel);
		expect(importerAlias.getText()).toContain(expectedAlias);
	});

	it("複数の名前付きインポートを持つファイルのパスを正しく更新する", async () => {
		const { project, importerMulti } = setupTestProject();
		await updateImportsInReferencingFiles(project, oldFilePath, newFilePath);
		const expected = `import { ${symbolToMove}, ${anotherSymbol} } from '../moduleC/new-location';`;
		expect(importerMulti.getText()).toContain(expected);
	});

	it("デフォルトインポートを持つファイルのパスを正しく更新する", async () => {
		const { project, importerDefault } = setupTestProject();
		await updateImportsInReferencingFiles(project, oldFilePath, newFilePath);
		const expected = `import myDefault from '../moduleC/new-location';`;
		expect(importerDefault.getText()).toContain(expected);
	});

	it("Typeインポートを持つファイルのパスを正しく更新する", async () => {
		const { project, importerType } = setupTestProject();
		await updateImportsInReferencingFiles(project, oldFilePath, newFilePath);
		const expected = `import type { ${typeToMove} } from '../moduleC/new-location';`;
		expect(importerType.getText()).toContain(expected);
	});

	it("移動元ファイルへの参照がない場合、エラーなく完了し、他のファイルは変更されない", async () => {
		const { project, noRefFile } = setupTestProject();
		const originalContent = noRefFile.getText();

		await expect(
			updateImportsInReferencingFiles(project, oldFilePath, newFilePath),
		).resolves.toBeUndefined();

		expect(noRefFile.getText()).toBe(originalContent);
	});

	// --- 【制限事項確認】将来的に対応したいケース ---
	it.skip("【制限事項】バレルファイル経由でインポートしているファイルのパスは更新される", async () => {
		const { project, importerIndex } = setupTestProject();
		await updateImportsInReferencingFiles(project, oldFilePath, newFilePath);
		const updatedContent = importerIndex.getText();
		const expectedImportPath = "../../moduleC/new-location";
		expect(updatedContent).toContain(
			`import { ${symbolToMove} } from '${expectedImportPath}';`,
		);
	});
});
