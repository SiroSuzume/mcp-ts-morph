import { describe, it, expect } from "vitest";
import { Project, IndentationText, QuoteKind, SyntaxKind } from "ts-morph";
import { moveSymbolToFile } from "./move-symbol-to-file"; // 作成予定の関数

describe("moveSymbolToFile", () => {
	it("指定された const シンボルを新しいファイルに移動し、参照を更新する", async () => {
		// Arrange
		const project = new Project({
			useInMemoryFileSystem: true,
			manipulationSettings: {
				indentationText: IndentationText.TwoSpaces,
				quoteKind: QuoteKind.Double,
			},
			compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } },
		});

		const oldFilePath = "/src/utils.ts";
		const newFilePath = "/src/new-utils.ts";
		const symbolToMove = "myUtil";
		const referencingFilePath = "/src/component.ts";

		// 移動元のファイル
		project.createSourceFile(
			oldFilePath,
			`export const myUtil = () => 'utility';
export const anotherUtil = 1;
`,
		);

		// 参照元のファイル
		project.createSourceFile(
			referencingFilePath,
			`import { myUtil } from "./utils";
console.log(myUtil());
`,
		);

		// Act
		await moveSymbolToFile(
			project,
			oldFilePath,
			newFilePath,
			symbolToMove,
			SyntaxKind.VariableStatement, // const は VariableStatement
		);

		// Assert
		// 1. 新しいファイルの内容確認
		const newSourceFile = project.getSourceFile(newFilePath);
		const expectedNewContent = `export const myUtil = () => 'utility';
`;
		expect(newSourceFile?.getFullText()).toBe(expectedNewContent);

		// 2. 元のファイルの内容確認
		const updatedOldSourceFile = project.getSourceFile(oldFilePath);
		// 元のファイルからシンボルが削除され、他のシンボルは残る
		const expectedOldContent = `export const anotherUtil = 1;
`;
		expect(updatedOldSourceFile?.getFullText()).toBe(expectedOldContent);

		// 3. 参照元のインポートパス確認
		const referencingSourceFile = project.getSourceFile(referencingFilePath);
		const expectedReferencingContent = `import { myUtil } from "./new-utils";
console.log(myUtil());
`;
		expect(referencingSourceFile?.getFullText()).toBe(
			expectedReferencingContent,
		);
	});

	it("外部依存関係を持つシンボルを移動し、新しいファイルにインポートを追加する", async () => {
		// Arrange
		const project = new Project({
			useInMemoryFileSystem: true,
			manipulationSettings: {
				indentationText: IndentationText.TwoSpaces,
				quoteKind: QuoteKind.Double,
			},
			compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } },
		});

		const dependencyFilePath = "/src/dependency.ts";
		const oldFilePath = "/src/source.ts";
		const newFilePath = "/src/new-location.ts";
		const referencingFilePath = "/src/importer.ts";

		const dependencySymbol = "dependencyFunc";
		const symbolToMove = "symbolUsingDependency";

		// 依存ファイル
		project.createSourceFile(
			dependencyFilePath,
			`export const dependencyFunc = () => 'dependency result';
`,
		);

		// 移動元のファイル (依存関係をインポートして使用)
		project.createSourceFile(
			oldFilePath,
			`import { dependencyFunc } from "./dependency";
export const symbolUsingDependency = () => {
  return 'using ' + dependencyFunc();
};
export const anotherInSource = true;
`,
		);

		// 参照元のファイル
		project.createSourceFile(
			referencingFilePath,
			`import { symbolUsingDependency } from "./source";
console.log(symbolUsingDependency());
`,
		);

		// Act
		await moveSymbolToFile(
			project,
			oldFilePath,
			newFilePath,
			symbolToMove,
			SyntaxKind.VariableStatement,
		);

		// Assert
		// 1. 新しいファイルの内容確認
		const newSourceFile = project.getSourceFile(newFilePath);
		// 移動されたシンボルの定義と依存関係のインポートが含まれる
		const expectedNewContent = `import { dependencyFunc } from "./dependency";

export const symbolUsingDependency = () => {
  return 'using ' + dependencyFunc();
};
`;
		expect(newSourceFile?.getFullText()).toBe(expectedNewContent);

		// 2. 元のファイルの内容確認
		const updatedOldSourceFile = project.getSourceFile(oldFilePath);
		// シンボルは削除され、他のシンボルと、(現状の実装では)依存関係のインポートは残る
		const expectedOldContent = `import { dependencyFunc } from "./dependency";
export const anotherInSource = true;
`; // 注意: 依存関係のインポートが残る想定
		expect(updatedOldSourceFile?.getFullText()).toBe(expectedOldContent);

		// 3. 参照元のインポートパス確認
		const referencingSourceFile = project.getSourceFile(referencingFilePath);
		const expectedReferencingContent = `import { symbolUsingDependency } from "./new-location";
console.log(symbolUsingDependency());
`;
		expect(referencingSourceFile?.getFullText()).toBe(
			expectedReferencingContent,
		);
	});

	it("指定された function シンボルを新しいファイルに移動し、参照を更新する", async () => {
		// Arrange
		const project = new Project({
			useInMemoryFileSystem: true,
			manipulationSettings: {
				indentationText: IndentationText.TwoSpaces,
				quoteKind: QuoteKind.Double,
			},
			compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } },
		});

		const oldFilePath = "/src/functions.ts";
		const newFilePath = "/src/new-functions.ts";
		const symbolToMove = "myFunction";
		const referencingFilePath = "/src/caller.ts";

		// 移動元のファイル
		project.createSourceFile(
			oldFilePath,
			`export function myFunction() { return 'hello'; }
export const anotherValue = 42;
`,
		);

		// 参照元のファイル
		project.createSourceFile(
			referencingFilePath,
			`import { myFunction } from "./functions";
myFunction();
`,
		);

		// Act
		await moveSymbolToFile(
			project,
			oldFilePath,
			newFilePath,
			symbolToMove,
			SyntaxKind.FunctionDeclaration, // function は FunctionDeclaration
		);

		// Assert
		// 1. 新しいファイルの内容確認
		const newSourceFile = project.getSourceFile(newFilePath);
		const expectedNewContent = `export function myFunction() { return 'hello'; }
`;
		expect(newSourceFile?.getFullText()).toBe(expectedNewContent);

		// 2. 元のファイルの内容確認
		const updatedOldSourceFile = project.getSourceFile(oldFilePath);
		const expectedOldContent = `export const anotherValue = 42;
`;
		expect(updatedOldSourceFile?.getFullText()).toBe(expectedOldContent);

		// 3. 参照元のインポートパス確認
		const referencingSourceFile = project.getSourceFile(referencingFilePath);
		const expectedReferencingContent = `import { myFunction } from "./new-functions";
myFunction();
`;
		expect(referencingSourceFile?.getFullText()).toBe(
			expectedReferencingContent,
		);
	});

	it("指定された class シンボルを新しいファイルに移動し、参照を更新する", async () => {
		// Arrange
		const project = new Project({
			useInMemoryFileSystem: true,
			manipulationSettings: {
				indentationText: IndentationText.TwoSpaces,
				quoteKind: QuoteKind.Double,
			},
			compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } },
		});

		const oldFilePath = "/src/models.ts";
		const newFilePath = "/src/new-models.ts";
		const symbolToMove = "MyClass";
		const referencingFilePath = "/src/user.ts";

		// 移動元のファイル
		project.createSourceFile(
			oldFilePath,
			`export class MyClass { constructor() { console.log("Model created"); } }
export interface AnotherInterface {}
`,
		);

		// 参照元のファイル
		project.createSourceFile(
			referencingFilePath,
			`import { MyClass } from "./models";
const instance = new MyClass();
`,
		);

		// Act
		await moveSymbolToFile(
			project,
			oldFilePath,
			newFilePath,
			symbolToMove,
			SyntaxKind.ClassDeclaration,
		);

		// Assert
		// 1. 新しいファイルの内容確認
		const newSourceFile = project.getSourceFile(newFilePath);
		const expectedNewContent = `export class MyClass { constructor() { console.log("Model created"); } }
`;
		expect(newSourceFile?.getFullText()).toBe(expectedNewContent);

		// 2. 元のファイルの内容確認
		const updatedOldSourceFile = project.getSourceFile(oldFilePath);
		const expectedOldContent = `export interface AnotherInterface {}
`;
		expect(updatedOldSourceFile?.getFullText()).toBe(expectedOldContent);

		// 3. 参照元のインポートパス確認
		const referencingSourceFile = project.getSourceFile(referencingFilePath);
		const expectedReferencingContent = `import { MyClass } from "./new-models";
const instance = new MyClass();
`;
		expect(referencingSourceFile?.getFullText()).toBe(
			expectedReferencingContent,
		);
	});

	it("指定された interface シンボルを新しいファイルに移動し、参照を更新する", async () => {
		// Arrange
		const project = new Project({
			useInMemoryFileSystem: true,
			manipulationSettings: {
				indentationText: IndentationText.TwoSpaces,
				quoteKind: QuoteKind.Double,
			},
			compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } },
		});

		const oldFilePath = "/src/types.ts";
		const newFilePath = "/src/new-types.ts";
		const symbolToMove = "MyInterface";
		const referencingFilePath = "/src/data.ts";

		// 移動元のファイル
		project.createSourceFile(
			oldFilePath,
			`export interface MyInterface { id: string; }
export type AnotherType = number;
`,
		);

		// 参照元のファイル
		project.createSourceFile(
			referencingFilePath,
			`import type { MyInterface } from "./types";
const data: MyInterface = { id: '1' };`,
		);

		// Act
		await moveSymbolToFile(
			project,
			oldFilePath,
			newFilePath,
			symbolToMove,
			SyntaxKind.InterfaceDeclaration,
		);

		// Assert
		// 1. 新しいファイルの内容確認
		const newSourceFile = project.getSourceFile(newFilePath);
		const expectedNewContent = `export interface MyInterface { id: string; }
`;
		expect(newSourceFile?.getFullText()).toBe(expectedNewContent);

		// 2. 元のファイルの内容確認
		const updatedOldSourceFile = project.getSourceFile(oldFilePath);
		const expectedOldContent = `export type AnotherType = number;
`;
		expect(updatedOldSourceFile?.getFullText()).toBe(expectedOldContent);

		// 3. 参照元のインポートパス確認
		const referencingSourceFile = project.getSourceFile(referencingFilePath);
		// \`import type\` も正しく更新される
		const expectedReferencingContent = `import type { MyInterface } from "./new-types";
const data: MyInterface = { id: '1' };`;
		expect(referencingSourceFile?.getFullText()).toBe(
			expectedReferencingContent,
		);
	});

	it("指定された type alias シンボルを新しいファイルに移動し、参照を更新する", async () => {
		// Arrange
		const project = new Project({
			useInMemoryFileSystem: true,
			manipulationSettings: {
				indentationText: IndentationText.TwoSpaces,
				quoteKind: QuoteKind.Double,
			},
			compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } },
		});

		const oldFilePath = "/src/aliases.ts";
		const newFilePath = "/src/new-aliases.ts";
		const symbolToMove = "MyType";
		const referencingFilePath = "/src/config.ts";

		// 移動元のファイル
		project.createSourceFile(
			oldFilePath,
			`export type MyType = string | number;
export const CONFIG_KEY = 'key';
`,
		);

		// 参照元のファイル
		project.createSourceFile(
			referencingFilePath,
			`import type { MyType } from "./aliases";
let value: MyType = 'test';
`,
		);

		// Act
		await moveSymbolToFile(
			project,
			oldFilePath,
			newFilePath,
			symbolToMove,
			SyntaxKind.TypeAliasDeclaration,
		);

		// Assert
		// 1. 新しいファイルの内容確認
		const newSourceFile = project.getSourceFile(newFilePath);
		const expectedNewContent = `export type MyType = string | number;
`;
		expect(newSourceFile?.getFullText()).toBe(expectedNewContent);

		// 2. 元のファイルの内容確認
		const updatedOldSourceFile = project.getSourceFile(oldFilePath);
		const expectedOldContent = `export const CONFIG_KEY = 'key';
`;
		expect(updatedOldSourceFile?.getFullText()).toBe(expectedOldContent);

		// 3. 参照元のインポートパス確認
		const referencingSourceFile = project.getSourceFile(referencingFilePath);
		const expectedReferencingContent = `import type { MyType } from "./new-aliases";
let value: MyType = 'test';
`;
		expect(referencingSourceFile?.getFullText()).toBe(
			expectedReferencingContent,
		);
	});

	it("指定された enum シンボルを新しいファイルに移動し、参照を更新する", async () => {
		// Arrange
		const project = new Project({
			useInMemoryFileSystem: true,
			manipulationSettings: {
				indentationText: IndentationText.TwoSpaces,
				quoteKind: QuoteKind.Double,
			},
			compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } },
		});

		const oldFilePath = "/src/constants.ts";
		const newFilePath = "/src/new-constants.ts";
		const symbolToMove = "Color";
		const referencingFilePath = "/src/painter.ts";

		// 移動元のファイル
		project.createSourceFile(
			oldFilePath,
			`export enum Color { Red, Green, Blue }
export const DEFAULT_SIZE = 10;
`,
		);

		// 参照元のファイル
		project.createSourceFile(
			referencingFilePath,
			'import { Color } from "./constants";\nlet myColor = Color.Red;',
		);

		// Act
		await moveSymbolToFile(
			project,
			oldFilePath,
			newFilePath,
			symbolToMove,
			SyntaxKind.EnumDeclaration,
		);

		// Assert
		// 1. 新しいファイルの内容確認
		const newSourceFile = project.getSourceFile(newFilePath);
		const expectedNewContent = `export enum Color { Red, Green, Blue }
`;
		expect(newSourceFile?.getFullText()).toBe(expectedNewContent);

		// 2. 元のファイルの内容確認
		const updatedOldSourceFile = project.getSourceFile(oldFilePath);
		const expectedOldContent = `export const DEFAULT_SIZE = 10;
`;
		expect(updatedOldSourceFile?.getFullText()).toBe(expectedOldContent);

		// 3. 参照元のインポートパス確認
		const referencingSourceFile = project.getSourceFile(referencingFilePath);
		const expectedReferencingContent = `import { Color } from "./new-constants";
let myColor = Color.Red;`;
		expect(referencingSourceFile?.getFullText()).toBe(
			expectedReferencingContent,
		);
	});

	// TODO: 他の宣言タイプ、内部依存関係、エッジケースなどのテストを追加
});
