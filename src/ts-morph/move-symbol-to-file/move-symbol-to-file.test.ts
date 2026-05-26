import { describe, it, expect } from "vitest";
import { SyntaxKind } from "ts-morph";
import { createInMemoryProjectWithDoubleQuotes } from "../_test-utils/create-in-memory-project";
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

		expect(project.getSourceFile(newFilePath)?.getFullText()).toBe(
			`export const myUtil = () => 'utility';
`,
		);
		expect(project.getSourceFile(oldFilePath)?.getFullText()).toBe(
			`export const anotherUtil = 1;
`,
		);
		expect(project.getSourceFile(referencingFilePath)?.getFullText()).toBe(
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

		expect(project.getSourceFile(newFilePath)?.getFullText()).toBe(
			`import { dependencyFunc } from "./dependency";

export const symbolUsingDependency = () => {
  return 'using ' + dependencyFunc();
};
`,
		);
		expect(project.getSourceFile(oldFilePath)?.getFullText()).toBe(
			`export const anotherInSource = true;
`,
		);
		expect(project.getSourceFile(referencingFilePath)?.getFullText()).toBe(
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

		expect(project.getSourceFile(newFilePath)?.getFullText()).toBe(
			`export function myFunction() { return 'hello'; }
`,
		);
		expect(project.getSourceFile(oldFilePath)?.getFullText()).toBe(
			`export const anotherValue = 42;
`,
		);
		expect(project.getSourceFile(referencingFilePath)?.getFullText()).toBe(
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

		expect(project.getSourceFile(newFilePath)?.getFullText()).toBe(
			`export class MyClass { constructor() { console.log("Model created"); } }
`,
		);
		expect(project.getSourceFile(oldFilePath)?.getFullText()).toBe(
			`export interface AnotherInterface {}
`,
		);
		expect(project.getSourceFile(referencingFilePath)?.getFullText()).toBe(
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

		expect(project.getSourceFile(newFilePath)?.getFullText()).toBe(
			`export interface MyInterface { id: string; }
`,
		);
		expect(project.getSourceFile(oldFilePath)?.getFullText()).toBe(
			`export type AnotherType = number;
`,
		);
		expect(project.getSourceFile(referencingFilePath)?.getFullText()).toBe(
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

		expect(project.getSourceFile(newFilePath)?.getFullText()).toBe(
			`export type MyType = string | number;
`,
		);
		expect(project.getSourceFile(oldFilePath)?.getFullText()).toBe(
			`export const CONFIG_KEY = 'key';
`,
		);
		expect(project.getSourceFile(referencingFilePath)?.getFullText()).toBe(
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

		expect(project.getSourceFile(newFilePath)?.getFullText()).toBe(
			`export enum Color { Red, Green, Blue }
`,
		);
		expect(project.getSourceFile(oldFilePath)?.getFullText()).toBe(
			`export const DEFAULT_SIZE = 10;
`,
		);
		expect(project.getSourceFile(referencingFilePath)?.getFullText()).toBe(
			`import { Color } from "./new-constants";
let myColor = Color.Red;`,
		);
	});
});
