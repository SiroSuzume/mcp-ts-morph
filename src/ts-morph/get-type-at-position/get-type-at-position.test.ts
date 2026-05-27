import type { Project } from "ts-morph";
import { describe, expect, it } from "vitest";
import { createInMemoryProject } from "../_test-utils/create-in-memory-project";
import { getTypeAtPosition } from "./get-type-at-position";

function setup(files: Record<string, string>): Project {
	const project = createInMemoryProject();
	for (const [path, content] of Object.entries(files)) {
		project.createSourceFile(path, content, { overwrite: true });
	}
	return project;
}

describe("getTypeAtPosition", () => {
	describe("基本", () => {
		it("変数識別子の型を取得できる", () => {
			const project = setup({
				"/a.ts": [
					'const user = { id: "u1", name: "alice" };',
					"console.log(user);",
				].join("\n"),
			});
			const result = getTypeAtPosition(project, "/a.ts", {
				line: 2,
				column: 13,
			});
			expect(result.nodeKind).toBe("Identifier");
			expect(result.nodeText).toBe("user");
			expect(result.type).toBe("{ id: string; name: string; }");
			expect(result.symbol).toEqual({
				name: "user",
				kind: "VariableDeclaration",
			});
			expect(result.declaration?.filePath).toBe("/a.ts");
			expect(result.declaration?.line).toBe(1);
		});

		it("関数識別子の型 (シグネチャ) を取得できる", () => {
			const project = setup({
				"/a.ts": [
					"function greet(name: string): string {",
					'  return "hello " + name;',
					"}",
					"greet('world');",
				].join("\n"),
			});
			const result = getTypeAtPosition(project, "/a.ts", {
				line: 4,
				column: 1,
			});
			expect(result.nodeKind).toBe("Identifier");
			expect(result.type).toContain("(name: string)");
			expect(result.type).toContain("string");
			expect(result.symbol).toEqual({
				name: "greet",
				kind: "FunctionDeclaration",
			});
		});

		it("プロパティアクセスのプロパティ部分の型を取得できる", () => {
			const project = setup({
				"/a.ts": [
					'const user = { id: 42, name: "alice" };',
					"const x = user.name;",
				].join("\n"),
			});
			const result = getTypeAtPosition(project, "/a.ts", {
				line: 2,
				column: 16, // "name" in user.name
			});
			expect(result.nodeKind).toBe("Identifier");
			expect(result.nodeText).toBe("name");
			expect(result.type).toBe("string");
		});

		it("関数呼び出し結果は呼び出された関数識別子位置で関数の型として返す", () => {
			const project = setup({
				"/a.ts": [
					"function getNumber(): number { return 1; }",
					"const x = getNumber();",
				].join("\n"),
			});
			const result = getTypeAtPosition(project, "/a.ts", {
				line: 2,
				column: 11, // "getNumber" identifier
			});
			expect(result.type).toContain("() => number");
		});
	});

	describe("リテラル", () => {
		it("文字列リテラルの位置で string リテラル型を返す", () => {
			const project = setup({
				"/a.ts": 'const x = "hello";',
			});
			const result = getTypeAtPosition(project, "/a.ts", {
				line: 1,
				column: 12, // inside "hello"
			});
			expect(result.nodeKind).toBe("StringLiteral");
			expect(result.type).toBe('"hello"');
		});

		it("数値リテラルの位置で number リテラル型を返す", () => {
			const project = setup({
				"/a.ts": "const x = 42;",
			});
			const result = getTypeAtPosition(project, "/a.ts", {
				line: 1,
				column: 11,
			});
			expect(result.nodeKind).toBe("NumericLiteral");
			expect(result.type).toBe("42");
		});
	});

	describe("import された symbol", () => {
		it("別ファイルで宣言されたシンボルの宣言位置を含む結果を返す", () => {
			const project = setup({
				"/lib.ts":
					"export function helper(n: number): string { return String(n); }",
				"/a.ts": ['import { helper } from "./lib";', "helper(1);"].join("\n"),
			});
			const result = getTypeAtPosition(project, "/a.ts", {
				line: 2,
				column: 1,
			});
			expect(result.symbol?.name).toBe("helper");
			expect(result.declaration?.filePath).toBe("/lib.ts");
			expect(result.declaration?.line).toBe(1);
		});
	});

	describe("ジェネリック", () => {
		it("ユーザ定義ジェネリック型も復元できる", () => {
			const project = setup({
				"/a.ts": [
					"type Box<T> = { value: T };",
					'const b: Box<string> = { value: "hi" };',
					"const v = b;",
				].join("\n"),
			});
			const result = getTypeAtPosition(project, "/a.ts", {
				line: 3,
				column: 11,
			});
			expect(result.type).toBe("Box<string>");
		});

		it("ユニオン型を保持する", () => {
			const project = setup({
				"/a.ts": [
					"function f(): string | number { return 1; }",
					"const v = f();",
					"const w = v;",
				].join("\n"),
			});
			const result = getTypeAtPosition(project, "/a.ts", {
				line: 3,
				column: 11,
			});
			expect(result.type).toBe("string | number");
		});
	});

	describe("エラー処理", () => {
		it("存在しないファイルでエラー", () => {
			const project = setup({});
			expect(() =>
				getTypeAtPosition(project, "/nonexistent.ts", {
					line: 1,
					column: 1,
				}),
			).toThrow(/ファイルが見つかりません/);
		});

		it("ファイル範囲外の位置でエラー", () => {
			const project = setup({ "/a.ts": "const x = 1;" });
			expect(() =>
				getTypeAtPosition(project, "/a.ts", { line: 99, column: 1 }),
			).toThrow(/範囲外/);
		});

		it("末尾の空白行に対しても型情報を返す (SourceFile 全体の型)", () => {
			// getDescendantAtPos は空白でも SourceFile を返すため、エラーにはならない。
			// ただし結果の nodeKind を見れば呼び出し側で判定可能。
			const project = setup({ "/a.ts": "const x = 1;\n\n" });
			const result = getTypeAtPosition(project, "/a.ts", {
				line: 2,
				column: 1,
			});
			// 空白上だと EndOfFileToken や SourceFile になることがある
			expect(["SourceFile", "EndOfFileToken"]).toContain(result.nodeKind);
		});
	});

	describe("型注釈位置", () => {
		it("型エイリアス使用位置の型 (引数の型注釈) を取得できる", () => {
			const project = setup({
				"/a.ts": [
					"type UserId = string;",
					"function f(id: UserId) { return id; }",
				].join("\n"),
			});
			const result = getTypeAtPosition(project, "/a.ts", {
				line: 2,
				column: 16, // "UserId" in type annotation
			});
			expect(result.symbol?.name).toBe("UserId");
			expect(result.symbol?.kind).toBe("TypeAliasDeclaration");
		});
	});
});
