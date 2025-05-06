import { describe, it, expect } from "vitest";
import { Project } from "ts-morph";
import { updateTargetFile } from "./update-target-file";
import type { ImportMap } from "./generate-content/build-new-file-import-section";

describe("updateTargetFile", () => {
	it("既存ファイルに新しい宣言と、それに必要な新しい名前付きインポートを追加・マージできる", () => {
		const project = new Project({ useInMemoryFileSystem: true });
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
		const project = new Project({ useInMemoryFileSystem: true });
		const targetFilePath = "/src/target.ts";
		const initialContent = `export type ExistingType = number;

console.log('hello');
`;
		const targetSourceFile = project.createSourceFile(
			targetFilePath,
			initialContent,
		);

		const requiredImportMap: ImportMap = new Map([
			[
				".",
				{
					namedImports: new Set(["ExistingType"]),
					isNamespaceImport: false,
				},
			],
		]);

		const declarationStrings: string[] = [];

		const expectedContent = initialContent;

		updateTargetFile(targetSourceFile, requiredImportMap, declarationStrings);

		expect(targetSourceFile.getFullText().trim()).toBe(expectedContent.trim());
	});

	// TODO: Add more realistic test cases (e.g., default imports, different modules)
});
