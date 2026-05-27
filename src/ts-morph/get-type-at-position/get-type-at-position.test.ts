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
			expect(result.type).toBe("(name: string) => string");
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
				column: 11,
			});
			expect(result.type).toBe("() => number");
		});
	});

	describe("関数 signature の修飾子保持", () => {
		it("rest パラメータの `...` を保持する", () => {
			const project = setup({
				"/a.ts": [
					"function f(a: number, ...rest: number[]): void {}",
					"f(1, 2, 3);",
				].join("\n"),
			});
			const result = getTypeAtPosition(project, "/a.ts", {
				line: 2,
				column: 1,
			});
			expect(result.type).toBe("(a: number, ...rest: number[]) => void");
		});

		it("optional `?` を保持する", () => {
			const project = setup({
				"/a.ts": ["function f(a: number, b?: string): void {}", "f(1);"].join(
					"\n",
				),
			});
			const result = getTypeAtPosition(project, "/a.ts", {
				line: 2,
				column: 1,
			});
			expect(result.type).toBe("(a: number, b?: string) => void");
		});

		it("分割代入パラメータが `__0` ではなく元のテキストで保持される", () => {
			const project = setup({
				"/a.ts": [
					"function f({ a, b }: { a: number; b: string }): void {}",
					"f({ a: 1, b: 'x' });",
				].join("\n"),
			});
			const result = getTypeAtPosition(project, "/a.ts", {
				line: 2,
				column: 1,
			});
			// __0 のような合成名が露出しないこと
			expect(result.type).not.toContain("__0");
			expect(result.type).toContain("{ a, b }");
			expect(result.type).toContain("a: number");
		});
	});

	describe("オーバーロード関数", () => {
		it("オーバーロード signature を `&` で結合して返す (implementation は隠す)", () => {
			const project = setup({
				"/a.ts": [
					"function f(a: string): string;",
					"function f(a: number): number;",
					"function f(a: string | number) { return a; }",
					"f('hi');",
				].join("\n"),
			});
			const result = getTypeAtPosition(project, "/a.ts", {
				line: 4,
				column: 1,
			});
			expect(result.type).toBe(
				"((a: string) => string) & ((a: number) => number)",
			);
		});
	});

	describe("関数 + namespace マージ", () => {
		it("namespace 側のプロパティを保つために signature 形に展開しない", () => {
			const project = setup({
				"/a.ts": [
					"function fn(x: number): string { return ''; }",
					"namespace fn { export const version = '1.0'; }",
					"const ref = fn;",
				].join("\n"),
			});
			const result = getTypeAtPosition(project, "/a.ts", {
				line: 3,
				column: 13,
			});
			// signature 展開してしまうと "(x: number) => string" となり namespace 側 (version) が消える。
			// TS が返す `typeof fn` のまま保ち、エージェントが宣言を辿れるようにする。
			expect(result.type).not.toMatch(/^\(x: number\) => string$/);
			expect(result.type).toBe("typeof fn");
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

	describe("import alias 解決", () => {
		it("直接 import された symbol の宣言位置を元ファイルで返す", () => {
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
			expect(result.type).toBe("(n: number) => string");
		});

		it("barrel re-export (export * from) 越しでも元の宣言まで再帰解決する", () => {
			const project = setup({
				"/a.ts":
					"export function helper(n: number): string { return String(n); }",
				"/index.ts": 'export * from "./a";',
				"/main.ts": ['import { helper } from "./index";', "helper(1);"].join(
					"\n",
				),
			});
			const result = getTypeAtPosition(project, "/main.ts", {
				line: 2,
				column: 1,
			});
			expect(result.symbol?.name).toBe("helper");
			expect(result.declaration?.filePath).toBe("/a.ts");
			expect(result.declaration?.line).toBe(1);
		});

		it("named re-export (export { x } from) 越しでも元の宣言まで再帰解決する", () => {
			const project = setup({
				"/a.ts":
					"export function helper(n: number): string { return String(n); }",
				"/index.ts": 'export { helper } from "./a";',
				"/main.ts": ['import { helper } from "./index";', "helper(1);"].join(
					"\n",
				),
			});
			const result = getTypeAtPosition(project, "/main.ts", {
				line: 2,
				column: 1,
			});
			expect(result.declaration?.filePath).toBe("/a.ts");
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

		it("ジェネリック関数の signature は元の型パラメータを保持する", () => {
			const project = setup({
				"/a.ts": [
					"function identity<T>(x: T): T { return x; }",
					"identity(1);",
				].join("\n"),
			});
			const result = getTypeAtPosition(project, "/a.ts", {
				line: 2,
				column: 1,
			});
			// 元の宣言から組み立てるので、推論された number ではなく T が残る
			expect(result.type).toBe("(x: T) => T");
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

		it("line=0 / column=0 のような不正な位置はエラー", () => {
			const project = setup({ "/a.ts": "const x = 1;" });
			expect(() =>
				getTypeAtPosition(project, "/a.ts", { line: 0, column: 1 }),
			).toThrow(/1-based/);
			expect(() =>
				getTypeAtPosition(project, "/a.ts", { line: 1, column: 0 }),
			).toThrow(/1-based/);
			expect(() =>
				getTypeAtPosition(project, "/a.ts", { line: -1, column: 1 }),
			).toThrow(/1-based/);
		});

		it("末尾の空白行に対しても型情報を返す (SourceFile レベルの型)", () => {
			// getDescendantAtPos は空白でも SourceFile を返すため、エラーにはならない。
			// nodeKind と type の双方を確認することで、ts-morph のバージョン差を検出可能にする。
			const project = setup({ "/a.ts": "const x = 1;\n\n" });
			const result = getTypeAtPosition(project, "/a.ts", {
				line: 2,
				column: 1,
			});
			expect(["SourceFile", "EndOfFileToken"]).toContain(result.nodeKind);
			// 空白位置でも何らかの型文字列が返ること (空文字や undefined ではない)
			expect(typeof result.type).toBe("string");
			expect(result.type.length).toBeGreaterThan(0);
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

	describe("メソッド / accessor", () => {
		it("インスタンスメソッド呼び出しの signature を取得できる", () => {
			const project = setup({
				"/a.ts": [
					"class C {",
					"  greet(name: string): string { return name; }",
					"}",
					"const c = new C();",
					"c.greet('hi');",
				].join("\n"),
			});
			const result = getTypeAtPosition(project, "/a.ts", {
				line: 5,
				column: 3, // "greet" in c.greet(...)
			});
			expect(result.type).toBe("(name: string) => string");
		});
	});

	describe("nodeText の安全な切り詰め", () => {
		it("UTF-16 サロゲートペアを途中で切らない", () => {
			// 79 chars + 1 emoji (= 81 code points)。コードポイント80でカットすると emoji の前で止まる。
			const longString = `"${"a".repeat(78)}\u{1F389}xyz"`;
			const project = setup({
				"/a.ts": `const x = ${longString};`,
			});
			// 文字列リテラル本体の位置を指す
			const result = getTypeAtPosition(project, "/a.ts", {
				line: 1,
				column: 11,
			});
			expect(result.nodeKind).toBe("StringLiteral");
			// 切り詰めが起きていれば '…' で終わるが、孤立サロゲートが残らないこと
			if (result.nodeText.endsWith("…")) {
				// 末尾 '…' を取り除いた残りが well-formed UTF-16 であること
				const body = result.nodeText.slice(0, -1);
				// lone high surrogate の検出
				expect(body).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
			}
		});
	});
});
