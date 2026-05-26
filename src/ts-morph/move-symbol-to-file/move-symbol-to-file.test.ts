import { describe, it, expect } from "vitest";
import { SyntaxKind } from "ts-morph";
import { createInMemoryProjectWithDoubleQuotes } from "../_test-utils/create-in-memory-project";
import { getFileText } from "../_test-utils/get-file-text";
import { moveSymbolToFile } from "./move-symbol-to-file";

describe("moveSymbolToFile", () => {
	it("指定された const シンボルを新しいファイルに移動し、参照を更新する", async () => {
		const project = createInMemoryProjectWithDoubleQuotes();
		const oldFilePath = "/src/utils.ts";
		const newFilePath = "/src/new-utils.ts";
		const referencingFilePath = "/src/component.ts";

		project.createSourceFile(
			oldFilePath,
			`export const myUtil = () => 'utility';
export const anotherUtil = 1;
`,
		);
		project.createSourceFile(
			referencingFilePath,
			`import { myUtil } from "./utils";
console.log(myUtil());
`,
		);

		await moveSymbolToFile(
			project,
			oldFilePath,
			newFilePath,
			"myUtil",
			SyntaxKind.VariableStatement,
		);

		expect(getFileText(project, newFilePath)).toBe(
			`export const myUtil = () => 'utility';
`,
		);
		expect(getFileText(project, oldFilePath)).toBe(
			`export const anotherUtil = 1;
`,
		);
		expect(getFileText(project, referencingFilePath)).toBe(
			`import { myUtil } from "./new-utils";
console.log(myUtil());
`,
		);
	});

	it("外部依存関係を持つシンボルを移動し、新しいファイルにインポートを追加する", async () => {
		const project = createInMemoryProjectWithDoubleQuotes();
		const dependencyFilePath = "/src/dependency.ts";
		const oldFilePath = "/src/source.ts";
		const newFilePath = "/src/new-location.ts";
		const referencingFilePath = "/src/importer.ts";

		project.createSourceFile(
			dependencyFilePath,
			`export const dependencyFunc = () => 'dependency result';
`,
		);
		project.createSourceFile(
			oldFilePath,
			`import { dependencyFunc } from "./dependency";
export const symbolUsingDependency = () => {
  return 'using ' + dependencyFunc();
};
export const anotherInSource = true;
`,
		);
		project.createSourceFile(
			referencingFilePath,
			`import { symbolUsingDependency } from "./source";
console.log(symbolUsingDependency());
`,
		);

		await moveSymbolToFile(
			project,
			oldFilePath,
			newFilePath,
			"symbolUsingDependency",
			SyntaxKind.VariableStatement,
		);

		expect(getFileText(project, newFilePath)).toBe(
			`import { dependencyFunc } from "./dependency";

export const symbolUsingDependency = () => {
  return 'using ' + dependencyFunc();
};
`,
		);
		expect(getFileText(project, oldFilePath)).toBe(
			`export const anotherInSource = true;
`,
		);
		expect(getFileText(project, referencingFilePath)).toBe(
			`import { symbolUsingDependency } from "./new-location";
console.log(symbolUsingDependency());
`,
		);
	});

	it("指定された function シンボルを新しいファイルに移動し、参照を更新する", async () => {
		const project = createInMemoryProjectWithDoubleQuotes();
		const oldFilePath = "/src/functions.ts";
		const newFilePath = "/src/new-functions.ts";
		const referencingFilePath = "/src/caller.ts";

		project.createSourceFile(
			oldFilePath,
			`export function myFunction() { return 'hello'; }
export const anotherValue = 42;
`,
		);
		project.createSourceFile(
			referencingFilePath,
			`import { myFunction } from "./functions";
myFunction();
`,
		);

		await moveSymbolToFile(
			project,
			oldFilePath,
			newFilePath,
			"myFunction",
			SyntaxKind.FunctionDeclaration,
		);

		expect(getFileText(project, newFilePath)).toBe(
			`export function myFunction() { return 'hello'; }
`,
		);
		expect(getFileText(project, oldFilePath)).toBe(
			`export const anotherValue = 42;
`,
		);
		expect(getFileText(project, referencingFilePath)).toBe(
			`import { myFunction } from "./new-functions";
myFunction();
`,
		);
	});

	it("指定された class シンボルを新しいファイルに移動し、参照を更新する", async () => {
		const project = createInMemoryProjectWithDoubleQuotes();
		const oldFilePath = "/src/models.ts";
		const newFilePath = "/src/new-models.ts";
		const referencingFilePath = "/src/user.ts";

		project.createSourceFile(
			oldFilePath,
			`export class MyClass { constructor() { console.log("Model created"); } }
export interface AnotherInterface {}
`,
		);
		project.createSourceFile(
			referencingFilePath,
			`import { MyClass } from "./models";
const instance = new MyClass();
`,
		);

		await moveSymbolToFile(
			project,
			oldFilePath,
			newFilePath,
			"MyClass",
			SyntaxKind.ClassDeclaration,
		);

		expect(getFileText(project, newFilePath)).toBe(
			`export class MyClass { constructor() { console.log("Model created"); } }
`,
		);
		expect(getFileText(project, oldFilePath)).toBe(
			`export interface AnotherInterface {}
`,
		);
		expect(getFileText(project, referencingFilePath)).toBe(
			`import { MyClass } from "./new-models";
const instance = new MyClass();
`,
		);
	});

	it("指定された interface シンボルを新しいファイルに移動し、参照を更新する", async () => {
		const project = createInMemoryProjectWithDoubleQuotes();
		const oldFilePath = "/src/types.ts";
		const newFilePath = "/src/new-types.ts";
		const referencingFilePath = "/src/data.ts";

		project.createSourceFile(
			oldFilePath,
			`export interface MyInterface { id: string; }
export type AnotherType = number;
`,
		);
		project.createSourceFile(
			referencingFilePath,
			`import type { MyInterface } from "./types";
const data: MyInterface = { id: '1' };`,
		);

		await moveSymbolToFile(
			project,
			oldFilePath,
			newFilePath,
			"MyInterface",
			SyntaxKind.InterfaceDeclaration,
		);

		expect(getFileText(project, newFilePath)).toBe(
			`export interface MyInterface { id: string; }
`,
		);
		expect(getFileText(project, oldFilePath)).toBe(
			`export type AnotherType = number;
`,
		);
		expect(getFileText(project, referencingFilePath)).toBe(
			`import type { MyInterface } from "./new-types";
const data: MyInterface = { id: '1' };`,
		);
	});

	it("指定された type alias シンボルを新しいファイルに移動し、参照を更新する", async () => {
		const project = createInMemoryProjectWithDoubleQuotes();
		const oldFilePath = "/src/aliases.ts";
		const newFilePath = "/src/new-aliases.ts";
		const referencingFilePath = "/src/config.ts";

		project.createSourceFile(
			oldFilePath,
			`export type MyType = string | number;
export const CONFIG_KEY = 'key';
`,
		);
		project.createSourceFile(
			referencingFilePath,
			`import type { MyType } from "./aliases";
let value: MyType = 'test';
`,
		);

		await moveSymbolToFile(
			project,
			oldFilePath,
			newFilePath,
			"MyType",
			SyntaxKind.TypeAliasDeclaration,
		);

		expect(getFileText(project, newFilePath)).toBe(
			`export type MyType = string | number;
`,
		);
		expect(getFileText(project, oldFilePath)).toBe(
			`export const CONFIG_KEY = 'key';
`,
		);
		expect(getFileText(project, referencingFilePath)).toBe(
			`import type { MyType } from "./new-aliases";
let value: MyType = 'test';
`,
		);
	});

	it("指定された enum シンボルを新しいファイルに移動し、参照を更新する", async () => {
		const project = createInMemoryProjectWithDoubleQuotes();
		const oldFilePath = "/src/constants.ts";
		const newFilePath = "/src/new-constants.ts";
		const referencingFilePath = "/src/painter.ts";

		project.createSourceFile(
			oldFilePath,
			`export enum Color { Red, Green, Blue }
export const DEFAULT_SIZE = 10;
`,
		);
		project.createSourceFile(
			referencingFilePath,
			'import { Color } from "./constants";\nlet myColor = Color.Red;',
		);

		await moveSymbolToFile(
			project,
			oldFilePath,
			newFilePath,
			"Color",
			SyntaxKind.EnumDeclaration,
		);

		expect(getFileText(project, newFilePath)).toBe(
			`export enum Color { Red, Green, Blue }
`,
		);
		expect(getFileText(project, oldFilePath)).toBe(
			`export const DEFAULT_SIZE = 10;
`,
		);
		expect(getFileText(project, referencingFilePath)).toBe(
			`import { Color } from "./new-constants";
let myColor = Color.Red;`,
		);
	});
});
