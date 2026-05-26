import type { Project } from "ts-morph";
import { describe, expect, it } from "vitest";
import { createInMemoryProject } from "../_test-utils/create-in-memory-project";
import { findIdentifierNode } from "../rename-symbol/rename-symbol";
import {
	computeNewArgumentTexts,
	computeNewParameterStructures,
	validateRestParameterIsLast,
} from "./apply-changes";
import { changeSignatureOnProject } from "./change-signature";
import { filterCallSites } from "./find-call-sites";
import {
	findFunctionLikeDeclaration,
	getAllRelatedFunctionDeclarations,
} from "./find-function-declaration";
import type { ChangeSignatureOperation } from "./types";

function setup(files: Record<string, string>): Project {
	const project = createInMemoryProject();
	for (const [path, content] of Object.entries(files)) {
		project.createSourceFile(path, content, { overwrite: true });
	}
	return project;
}

describe("computeNewArgumentTexts", () => {
	it("add: argumentForCallers が指定されていれば指定 index に挿入", () => {
		const result = computeNewArgumentTexts(
			["a", "b"],
			[{ kind: "add", index: 1, name: "x", argumentForCallers: "ctx" }],
		);
		expect(result).toEqual(["a", "ctx", "b"]);
	});

	it("add: argumentForCallers が無ければ呼び出し引数は変えない", () => {
		const result = computeNewArgumentTexts(
			["a"],
			[{ kind: "add", name: "x", defaultValue: "0" }],
		);
		expect(result).toEqual(["a"]);
	});

	it("add: index が呼び出しの引数数を超える場合はエラー", () => {
		expect(() =>
			computeNewArgumentTexts(
				[],
				[
					{
						kind: "add",
						index: 2,
						name: "c",
						argumentForCallers: "9",
					},
				],
			),
		).toThrow(/index=2 に挿入/);
	});

	it("remove: 指定 index の引数を削除", () => {
		const result = computeNewArgumentTexts(
			["a", "b", "c"],
			[{ kind: "remove", index: 1 }],
		);
		expect(result).toEqual(["a", "c"]);
	});

	it("remove: 引数数が足りない (省略 optional) 場合は無変更", () => {
		const result = computeNewArgumentTexts(
			["a"],
			[{ kind: "remove", index: 2 }],
		);
		expect(result).toEqual(["a"]);
	});

	it("reorder: newOrder に従い並び替える", () => {
		const result = computeNewArgumentTexts(
			["a", "b", "c"],
			[{ kind: "reorder", newOrder: [2, 0, 1] }],
		);
		expect(result).toEqual(["c", "a", "b"]);
	});

	it("reorder: 引数数が不一致ならエラー", () => {
		expect(() =>
			computeNewArgumentTexts(
				["a", "b"],
				[{ kind: "reorder", newOrder: [2, 0, 1] }],
			),
		).toThrow(/Reorder requires call sites/);
	});

	it("複数操作を順次適用", () => {
		const result = computeNewArgumentTexts(
			["a", "b"],
			[
				{ kind: "add", index: 0, name: "x", argumentForCallers: "ctx" },
				{ kind: "remove", index: 2 },
			],
		);
		// after add: [ctx, a, b], after remove index 2: [ctx, a]
		expect(result).toEqual(["ctx", "a"]);
	});
});

describe("computeNewParameterStructures", () => {
	it("add: 末尾に追加 (index 省略)", () => {
		const result = computeNewParameterStructures(
			[{ name: "a", type: "string" }],
			[{ kind: "add", name: "b", typeText: "number", defaultValue: "0" }],
		);
		expect(result).toEqual([
			{ name: "a", type: "string" },
			{
				name: "b",
				type: "number",
				hasQuestionToken: undefined,
				initializer: "0",
			},
		]);
	});

	it("add: 中間挿入で argumentForCallers 未指定はエラー", () => {
		expect(() =>
			computeNewParameterStructures(
				[{ name: "a" }, { name: "b" }],
				[{ kind: "add", index: 1, name: "x", typeText: "string" }],
			),
		).toThrow(/argumentForCallers が必須/);
	});

	it("add: 末尾追加でも optional/default が無く argumentForCallers も無いとエラー", () => {
		expect(() =>
			computeNewParameterStructures(
				[{ name: "a" }],
				[{ kind: "add", name: "b", typeText: "string" }],
			),
		).toThrow(/optional または defaultValue/);
	});

	it("remove: index が範囲外ならエラー", () => {
		expect(() =>
			computeNewParameterStructures(
				[{ name: "a" }],
				[{ kind: "remove", index: 1 }],
			),
		).toThrow(/範囲/);
	});

	it("reorder: 長さ不一致はエラー", () => {
		expect(() =>
			computeNewParameterStructures(
				[{ name: "a" }, { name: "b" }],
				[{ kind: "reorder", newOrder: [0] }],
			),
		).toThrow(/newOrder/);
	});

	it("reorder: 重複した index はエラー", () => {
		expect(() =>
			computeNewParameterStructures(
				[{ name: "a" }, { name: "b" }],
				[{ kind: "reorder", newOrder: [0, 0] }],
			),
		).toThrow(/重複|range/i);
	});

	it("rest パラメータを reorder で末尾以外に動かすとエラー", () => {
		expect(() =>
			computeNewParameterStructures(
				[{ name: "a" }, { name: "rest", isRestParameter: true }],
				[{ kind: "reorder", newOrder: [1, 0] }],
			),
		).toThrow(/rest パラメータ/);
	});

	it("rest パラメータの後ろに add するとエラー", () => {
		expect(() =>
			computeNewParameterStructures(
				[{ name: "rest", isRestParameter: true }],
				[
					{
						kind: "add",
						name: "b",
						typeText: "string",
						argumentForCallers: '"x"',
					},
				],
			),
		).toThrow(/rest パラメータ/);
	});
});

describe("validateRestParameterIsLast", () => {
	it("rest が末尾なら OK", () => {
		expect(() =>
			validateRestParameterIsLast([
				{ name: "a" },
				{ name: "rest", isRestParameter: true },
			]),
		).not.toThrow();
	});

	it("rest が中間にあるとエラー", () => {
		expect(() =>
			validateRestParameterIsLast([
				{ name: "rest", isRestParameter: true },
				{ name: "b" },
			]),
		).toThrow(/rest パラメータ/);
	});
});

describe("findFunctionLikeDeclaration", () => {
	it("関数宣言を取得できる", () => {
		const project = setup({
			"/a.ts": "export function foo(a: number) { return a; }",
		});
		const id = findIdentifierNode(project, "/a.ts", { line: 1, column: 17 });
		const fn = findFunctionLikeDeclaration(id);
		expect(fn.getParameters()).toHaveLength(1);
	});

	it("アロー関数代入を取得できる", () => {
		const project = setup({
			"/a.ts": "export const foo = (a: number) => a;",
		});
		const id = findIdentifierNode(project, "/a.ts", { line: 1, column: 14 });
		const fn = findFunctionLikeDeclaration(id);
		expect(fn.getParameters()).toHaveLength(1);
	});

	it("メソッド宣言を取得できる", () => {
		const project = setup({
			"/a.ts": "export class C { foo(a: number) { return a; } }",
		});
		const id = findIdentifierNode(project, "/a.ts", { line: 1, column: 18 });
		const fn = findFunctionLikeDeclaration(id);
		expect(fn.getParameters()).toHaveLength(1);
	});

	it("GetAccessor / SetAccessor を取得できる", () => {
		const project = setup({
			"/a.ts": [
				"export class C {",
				"  get foo() { return 1; }",
				"  set foo(v: number) { /* */ }",
				"}",
			].join("\n"),
		});
		const getterId = findIdentifierNode(project, "/a.ts", {
			line: 2,
			column: 7,
		});
		const setterId = findIdentifierNode(project, "/a.ts", {
			line: 3,
			column: 7,
		});
		expect(findFunctionLikeDeclaration(getterId).getKindName()).toBe(
			"GetAccessor",
		);
		expect(findFunctionLikeDeclaration(setterId).getKindName()).toBe(
			"SetAccessor",
		);
	});

	it("関数でない位置 (パラメータ) を指すと種別を含むエラー", () => {
		const project = setup({
			"/a.ts": "export function bar(foo: string) { return foo; }",
		});
		const id = findIdentifierNode(project, "/a.ts", { line: 1, column: 21 });
		expect(() => findFunctionLikeDeclaration(id)).toThrow(
			/関数宣言\/メソッド\/関数式ではありません.*Parameter/,
		);
	});
});

describe("getAllRelatedFunctionDeclarations", () => {
	it("オーバーロード無しなら単独", () => {
		const project = setup({
			"/a.ts": "export function foo(a: number) { return a; }",
		});
		const id = findIdentifierNode(project, "/a.ts", { line: 1, column: 17 });
		const fn = findFunctionLikeDeclaration(id);
		expect(getAllRelatedFunctionDeclarations(fn)).toHaveLength(1);
	});

	it("オーバーロード implementation を指せば全 signature を返す", () => {
		const project = setup({
			"/a.ts": [
				"export function foo(a: string): string;",
				"export function foo(a: number): number;",
				"export function foo(a: string | number) { return a; }",
			].join("\n"),
		});
		const id = findIdentifierNode(project, "/a.ts", { line: 3, column: 17 });
		const fn = findFunctionLikeDeclaration(id);
		const all = getAllRelatedFunctionDeclarations(fn);
		expect(all).toHaveLength(3);
	});

	it("オーバーロード signature 側を指しても全 signature を返す", () => {
		const project = setup({
			"/a.ts": [
				"export function foo(a: string): string;",
				"export function foo(a: number): number;",
				"export function foo(a: string | number) { return a; }",
			].join("\n"),
		});
		const id = findIdentifierNode(project, "/a.ts", { line: 1, column: 17 });
		const fn = findFunctionLikeDeclaration(id);
		const all = getAllRelatedFunctionDeclarations(fn);
		expect(all).toHaveLength(3);
	});
});

describe("filterCallSites", () => {
	it("呼び出し位置のみを抽出する (代入や型注釈は含めない)", () => {
		const project = setup({
			"/a.ts": [
				"export function foo(a: number) { return a; }",
				"foo(1);",
				"const ref = foo;",
				"foo(2);",
			].join("\n"),
		});
		const id = findIdentifierNode(project, "/a.ts", { line: 1, column: 17 });
		const refs = id.findReferencesAsNodes();
		const calls = filterCallSites(refs);
		expect(calls).toHaveLength(2);
		expect(calls[0].getText()).toBe("foo(1)");
		expect(calls[1].getText()).toBe("foo(2)");
	});
});

// ---- 統合テスト (実 changeSignatureOnProject を通す) ----

async function run(
	project: Project,
	args: {
		targetFilePath: string;
		position: { line: number; column: number };
		functionName: string;
		changes: ChangeSignatureOperation[];
	},
) {
	return changeSignatureOnProject(project, {
		...args,
		dryRun: true, // テストでは保存しない
	});
}

describe("changeSignatureOnProject", () => {
	it("add: 末尾にデフォルト値付きパラメータを追加し、呼び出し側は変えない", async () => {
		const project = setup({
			"/a.ts": ["export function foo(a: number) { return a; }", "foo(1);"].join(
				"\n",
			),
			"/b.ts": ['import { foo } from "./a";', "foo(2);"].join("\n"),
		});
		await run(project, {
			targetFilePath: "/a.ts",
			position: { line: 1, column: 17 },
			functionName: "foo",
			changes: [
				{ kind: "add", name: "b", typeText: "number", defaultValue: "0" },
			],
		});
		const a = project.getSourceFileOrThrow("/a.ts").getFullText();
		const b = project.getSourceFileOrThrow("/b.ts").getFullText();
		expect(a).toContain("function foo(a: number, b: number = 0)");
		expect(a).toContain("foo(1);");
		expect(b).toContain("foo(2);");
	});

	it("add: 先頭に必須パラメータを追加し、全呼び出しに引数を挿入", async () => {
		const project = setup({
			"/a.ts": ["export function foo(a: number) {}", "foo(1);"].join("\n"),
			"/b.ts": ['import { foo } from "./a";', "foo(2);", "foo(3);"].join("\n"),
		});
		await run(project, {
			targetFilePath: "/a.ts",
			position: { line: 1, column: 17 },
			functionName: "foo",
			changes: [
				{
					kind: "add",
					index: 0,
					name: "ctx",
					typeText: "string",
					argumentForCallers: '"ctx"',
				},
			],
		});
		const a = project.getSourceFileOrThrow("/a.ts").getFullText();
		const b = project.getSourceFileOrThrow("/b.ts").getFullText();
		expect(a).toContain("function foo(ctx: string, a: number)");
		expect(a).toContain('foo("ctx", 1);');
		expect(b).toContain('foo("ctx", 2);');
		expect(b).toContain('foo("ctx", 3);');
	});

	it("remove: パラメータと対応する引数を削除", async () => {
		const project = setup({
			"/a.ts": [
				"export function foo(a: number, b: string, c: boolean) {}",
				'foo(1, "x", true);',
			].join("\n"),
		});
		await run(project, {
			targetFilePath: "/a.ts",
			position: { line: 1, column: 17 },
			functionName: "foo",
			changes: [{ kind: "remove", index: 1 }],
		});
		const a = project.getSourceFileOrThrow("/a.ts").getFullText();
		expect(a).toContain("function foo(a: number, c: boolean)");
		expect(a).toContain("foo(1, true);");
	});

	it("reorder: パラメータと引数を並び替え", async () => {
		const project = setup({
			"/a.ts": [
				"export function foo(a: number, b: string, c: boolean) {}",
				'foo(1, "x", true);',
			].join("\n"),
		});
		await run(project, {
			targetFilePath: "/a.ts",
			position: { line: 1, column: 17 },
			functionName: "foo",
			changes: [{ kind: "reorder", newOrder: [2, 0, 1] }],
		});
		const a = project.getSourceFileOrThrow("/a.ts").getFullText();
		expect(a).toContain("function foo(c: boolean, a: number, b: string)");
		expect(a).toContain('foo(true, 1, "x");');
	});

	it("メソッド呼び出しも更新する", async () => {
		const project = setup({
			"/a.ts": [
				"export class C {",
				"  foo(a: number) { return a; }",
				"}",
				"const c = new C();",
				"c.foo(1);",
			].join("\n"),
		});
		await run(project, {
			targetFilePath: "/a.ts",
			position: { line: 2, column: 3 },
			functionName: "foo",
			changes: [
				{
					kind: "add",
					index: 0,
					name: "ctx",
					typeText: "string",
					argumentForCallers: '"x"',
				},
			],
		});
		const text = project.getSourceFileOrThrow("/a.ts").getFullText();
		expect(text).toContain("foo(ctx: string, a: number)");
		expect(text).toContain('c.foo("x", 1);');
	});

	it("オーバーロード関数: 全 signature と implementation を同時に更新", async () => {
		const project = setup({
			"/a.ts": [
				"export function foo(a: string): string;",
				"export function foo(a: number): number;",
				"export function foo(a: string | number) { return a; }",
				'foo("hi");',
				"foo(1);",
			].join("\n"),
		});
		await run(project, {
			targetFilePath: "/a.ts",
			position: { line: 3, column: 17 }, // implementation
			functionName: "foo",
			changes: [
				{
					kind: "add",
					index: 0,
					name: "ctx",
					typeText: "string",
					argumentForCallers: '"c"',
				},
			],
		});
		const a = project.getSourceFileOrThrow("/a.ts").getFullText();
		expect(a).toContain("function foo(ctx: string, a: string): string");
		expect(a).toContain("function foo(ctx: string, a: number): number");
		expect(a).toContain("function foo(ctx: string, a: string | number)");
		expect(a).toContain('foo("c", "hi");');
		expect(a).toContain('foo("c", 1);');
	});

	it("スプレッド呼び出しがあり引数を変更する場合はエラー (部分適用しない)", async () => {
		const original = [
			"export function foo(a: number, b: number) {}",
			"const args: [number, number] = [1, 2];",
			"foo(...args);",
			"foo(3, 4);",
		].join("\n");
		const project = setup({ "/a.ts": original });

		await expect(
			run(project, {
				targetFilePath: "/a.ts",
				position: { line: 1, column: 17 },
				functionName: "foo",
				changes: [{ kind: "remove", index: 0 }],
			}),
		).rejects.toThrow(/スプレッド引数/);

		// 部分適用されていないこと (foo(3, 4) が元のまま)
		expect(project.getSourceFileOrThrow("/a.ts").getFullText()).toContain(
			"foo(3, 4);",
		);
	});

	it("plan フェーズで検証エラー: 呼び出しの引数数不足が混在 → 部分適用しない", async () => {
		const project = setup({
			"/a.ts": [
				"export function foo(a: number, b: number) { return a + b; }",
				"foo(1, 2);",
				"foo(3, 4);",
			].join("\n"),
			// 引数数が足りない呼び出しを別ファイルに置く
			"/b.ts": [
				'import { foo } from "./a";',
				"// @ts-expect-error 引数不足を意図的に",
				"foo(99);",
			].join("\n"),
		});

		await expect(
			run(project, {
				targetFilePath: "/a.ts",
				position: { line: 1, column: 17 },
				functionName: "foo",
				changes: [{ kind: "reorder", newOrder: [1, 0] }],
			}),
		).rejects.toThrow(/Reorder requires/);

		// 部分適用されていないこと (a.ts の呼び出しは元のまま)
		const a = project.getSourceFileOrThrow("/a.ts").getFullText();
		expect(a).toContain("foo(1, 2);");
		expect(a).toContain("foo(3, 4);");
	});

	it("add 中間挿入で argumentForCallers が無いとエラー", async () => {
		const project = setup({
			"/a.ts": [
				"export function foo(a: string, b: string) {}",
				'foo("x","y");',
			].join("\n"),
		});
		await expect(
			run(project, {
				targetFilePath: "/a.ts",
				position: { line: 1, column: 17 },
				functionName: "foo",
				changes: [{ kind: "add", index: 1, name: "ctx", typeText: "string" }],
			}),
		).rejects.toThrow(/argumentForCallers が必須/);
	});

	it("rest パラメータの後ろに add するとエラー", async () => {
		const project = setup({
			"/a.ts": "export function foo(...rest: number[]) {}\nfoo(1, 2);",
		});
		await expect(
			run(project, {
				targetFilePath: "/a.ts",
				position: { line: 1, column: 17 },
				functionName: "foo",
				changes: [
					{
						kind: "add",
						name: "b",
						typeText: "string",
						optional: true,
					},
				],
			}),
		).rejects.toThrow(/rest パラメータ/);
	});
});
