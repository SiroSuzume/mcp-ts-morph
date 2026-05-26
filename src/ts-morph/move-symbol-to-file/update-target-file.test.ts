import { describe, it, expect } from "vitest";
import { createInMemoryProject } from "../_test-utils/create-in-memory-project";
import { updateTargetFile } from "./update-target-file";
import type { ImportMap } from "./generate-content/build-new-file-import-section";

describe("updateTargetFile", () => {
	it("既存ファイルに新しい宣言と、それに必要な新しい名前付きインポートを追加・マージできる", () => {
		const project = createInMemoryProject();
		const targetFilePath = "/src/target.ts";
		project.createSourceFile(
			"/utils.ts",
			"export const foo = 1; export const bar = 2; export const qux = 3;",
		);

		const initialContent = `import { foo, bar } from "../utils";

console.log(foo);
console.log(bar);
`;
		const targetSourceFile = project.createSourceFile(
			targetFilePath,
			initialContent,
		);

		const requiredImportMap: ImportMap = new Map([
			[
				"../utils",
				{
					namedImports: new Set(["qux"]),
					isNamespaceImport: false,
				},
			],
		]);

		const declarationStrings: string[] = [
			"export function baz() { return qux(); }",
		];

		const expectedContent = `import { bar, foo, qux } from "../utils";

console.log(foo);
console.log(bar);

export function baz() { return qux(); }
`;

		updateTargetFile(targetSourceFile, requiredImportMap, declarationStrings);

		expect(targetSourceFile.getFullText().trim()).toBe(expectedContent.trim());
	});

	it("requiredImportMap に自己参照パスが含まれていても、自己参照インポートは追加しない", () => {
		const project = createInMemoryProject();
		const targetSourceFile = project.createSourceFile(
			"/src/target.ts",
			"export type ExistingType = number;\n",
		);

		updateTargetFile(
			targetSourceFile,
			new Map([
				[
					".",
					{ namedImports: new Set(["ExistingType"]), isNamespaceImport: false },
				],
			]),
			[],
		);

		expect(targetSourceFile.getFullText().trim()).toBe(
			"export type ExistingType = number;",
		);
	});

	it("既存インポートがない場合、デフォルトインポートを新規追加できる", () => {
		const project = createInMemoryProject();
		const targetSourceFile = project.createSourceFile(
			"/src/target.ts",
			"console.log('start');\n",
		);

		updateTargetFile(
			targetSourceFile,
			new Map([
				[
					"./logger",
					{
						defaultName: "logger",
						namedImports: new Set(),
						isNamespaceImport: false,
					},
				],
			]),
			["export const tap = () => logger.info('x');"],
		);

		expect(targetSourceFile.getFullText()).toContain(
			'import logger from "./logger";',
		);
	});

	it("既存インポートがない場合、名前空間インポートを新規追加できる", () => {
		const project = createInMemoryProject();
		const targetSourceFile = project.createSourceFile(
			"/src/target.ts",
			"console.log('start');\n",
		);

		updateTargetFile(
			targetSourceFile,
			new Map([
				[
					"node:path",
					{
						namedImports: new Set(),
						isNamespaceImport: true,
						namespaceImportName: "path",
					},
				],
			]),
			["export const resolve = (a: string, b: string) => path.resolve(a, b);"],
		);

		expect(targetSourceFile.getFullText()).toContain(
			'import * as path from "node:path";',
		);
	});

	it("既存と異なるデフォルトインポートを追加しようとした場合、既存を優先する", () => {
		const project = createInMemoryProject();
		const targetSourceFile = project.createSourceFile(
			"/src/target.ts",
			'import original from "./logger";\noriginal();\n',
		);

		updateTargetFile(
			targetSourceFile,
			new Map([
				[
					"./logger",
					{
						defaultName: "renamed",
						namedImports: new Set(),
						isNamespaceImport: false,
					},
				],
			]),
			[],
		);

		expect(targetSourceFile.getFullText()).toContain(
			'import original from "./logger";',
		);
		expect(targetSourceFile.getFullText()).not.toContain("renamed");
	});

	it("名前空間インポートと通常インポートが衝突する場合、既存を優先する", () => {
		const project = createInMemoryProject();
		const targetSourceFile = project.createSourceFile(
			"/src/target.ts",
			'import { existing } from "./mod";\nexisting();\n',
		);

		updateTargetFile(
			targetSourceFile,
			new Map([
				[
					"./mod",
					{
						namedImports: new Set(),
						isNamespaceImport: true,
						namespaceImportName: "mod",
					},
				],
			]),
			[],
		);

		expect(targetSourceFile.getFullText()).toContain(
			'import { existing } from "./mod";',
		);
		expect(targetSourceFile.getFullText()).not.toContain("import * as mod");
	});
});
