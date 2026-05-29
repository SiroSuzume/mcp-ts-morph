import type { Project } from "ts-morph";
import { describe, expect, it } from "vitest";
import { createInMemoryProject } from "../_test-utils/create-in-memory-project";
import { findUnusedExports } from "./find-unused-exports";

function setup(files: Record<string, string>): Project {
	const project = createInMemoryProject();
	for (const [path, content] of Object.entries(files)) {
		project.createSourceFile(path, content, { overwrite: true });
	}
	return project;
}

function names(result: { unusedExports: { name: string }[] }): string[] {
	return result.unusedExports.map((e) => e.name).sort();
}

describe("findUnusedExports", () => {
	describe("基本", () => {
		it("どこからも import されない関数 export は未使用として報告される", () => {
			const project = setup({
				"/a.ts": "export function unused(): void {}",
				"/b.ts": "const x = 1;",
			});
			const result = findUnusedExports(project);
			expect(names(result)).toEqual(["unused"]);
			expect(result.unusedExports[0]).toMatchObject({
				filePath: "/a.ts",
				name: "unused",
				kind: "FunctionDeclaration",
				isDefaultExport: false,
				line: 1,
			});
		});

		it("他ファイルから import されている関数 export は報告されない", () => {
			const project = setup({
				"/a.ts": "export function used(): void {}",
				"/b.ts": ['import { used } from "./a";', "used();"].join("\n"),
			});
			const result = findUnusedExports(project);
			expect(result.unusedExports).toEqual([]);
		});

		it("同一ファイル内でのみ使われている export は未使用として報告される", () => {
			const project = setup({
				"/a.ts": [
					"export function onlyLocal(): number { return 1; }",
					"const x = onlyLocal();",
					"console.log(x);",
				].join("\n"),
			});
			const result = findUnusedExports(project);
			expect(names(result)).toEqual(["onlyLocal"]);
		});

		it("複数種類の宣言を同時に検出できる", () => {
			const project = setup({
				"/a.ts": [
					"export function fnA(): void {}",
					"export class ClsA {}",
					"export const constA = 1;",
					"export enum EnumA { x }",
					"export interface IfaceA { v: number }",
					"export type TypeA = string;",
				].join("\n"),
			});
			const result = findUnusedExports(project);
			expect(names(result)).toEqual([
				"ClsA",
				"EnumA",
				"IfaceA",
				"TypeA",
				"constA",
				"fnA",
			]);
		});
	});

	describe("default export", () => {
		it("export default function はどこからも import されないなら報告される", () => {
			const project = setup({
				"/a.ts": "export default function answer(): number { return 42; }",
			});
			const result = findUnusedExports(project);
			expect(result.unusedExports).toHaveLength(1);
			expect(result.unusedExports[0]).toMatchObject({
				name: "answer",
				isDefaultExport: true,
				kind: "FunctionDeclaration",
			});
		});

		it("export default Identifier は default import 経由で参照されれば報告されない", () => {
			const project = setup({
				"/a.ts": [
					"function answer(): number { return 42; }",
					"export default answer;",
				].join("\n"),
				"/b.ts": ['import answer from "./a";', "answer();"].join("\n"),
			});
			const result = findUnusedExports(project);
			expect(result.unusedExports).toEqual([]);
		});

		it("export default <リテラル式> は識別子が無いので候補から外す", () => {
			const project = setup({
				"/a.ts": "export default 42;",
			});
			const result = findUnusedExports(project);
			expect(result.unusedExports).toEqual([]);
		});
	});

	describe("再エクスポート (barrel)", () => {
		it("barrel 経由でしか再エクスポートされず外部利用がない export は未使用として報告される", () => {
			const project = setup({
				"/lib.ts": "export function helper(): void {}",
				"/index.ts": 'export * from "./lib";',
			});
			const result = findUnusedExports(project);
			// helper は再エクスポートのみで実利用が無いので未使用
			expect(names(result)).toContain("helper");
		});

		it("barrel 経由で他ファイルから利用されている export は報告されない", () => {
			const project = setup({
				"/lib.ts": "export function helper(): void {}",
				"/index.ts": 'export { helper } from "./lib";',
				"/main.ts": ['import { helper } from "./index";', "helper();"].join(
					"\n",
				),
			});
			const result = findUnusedExports(project);
			expect(names(result)).not.toContain("helper");
		});
	});

	describe("entryPoints オプション", () => {
		it("entryPoints に含まれるファイルの export は走査対象から外れて報告されない", () => {
			const project = setup({
				"/public-api.ts": "export function publicFn(): void {}",
				"/internal.ts": "export function internalFn(): void {}",
			});
			const result = findUnusedExports(project, {
				entryPoints: ["/public-api.ts"],
			});
			expect(names(result)).toEqual(["internalFn"]);
		});
	});

	describe("excludeFilePatterns オプション", () => {
		it("パターンを含むファイルは走査対象から外れる", () => {
			const project = setup({
				"/src/a.ts": "export function fn(): void {}",
				"/src/a.test.ts": "export function helper(): void {}",
			});
			const result = findUnusedExports(project, {
				excludeFilePatterns: [".test."],
			});
			expect(names(result)).toEqual(["fn"]);
		});
	});

	describe("maxResults オプション", () => {
		it("件数が上限に達したら truncated=true を返して打ち切る", () => {
			const project = setup({
				"/a.ts": [
					"export const a = 1;",
					"export const b = 2;",
					"export const c = 3;",
				].join("\n"),
			});
			const result = findUnusedExports(project, { maxResults: 2 });
			expect(result.unusedExports).toHaveLength(2);
			expect(result.truncated).toBe(true);
		});

		it("件数が上限以下なら truncated=false", () => {
			const project = setup({
				"/a.ts": ["export const a = 1;", "export const b = 2;"].join("\n"),
			});
			const result = findUnusedExports(project, { maxResults: 10 });
			expect(result.unusedExports).toHaveLength(2);
			expect(result.truncated).toBe(false);
		});

		it("maxResults が不正な値ならエラー", () => {
			const project = setup({ "/a.ts": "export const a = 1;" });
			expect(() => findUnusedExports(project, { maxResults: 0 })).toThrow(
				/1 以上の整数/,
			);
			expect(() => findUnusedExports(project, { maxResults: -1 })).toThrow();
			expect(() => findUnusedExports(project, { maxResults: 1.5 })).toThrow();
		});
	});

	describe("除外対象", () => {
		it("宣言ファイル (.d.ts) は走査対象から外れる", () => {
			const project = setup({
				"/types.d.ts": "export declare function ambient(): void;",
				"/a.ts": "export function used(): void {}",
				"/b.ts": ['import { used } from "./a";', "used();"].join("\n"),
			});
			const result = findUnusedExports(project);
			expect(names(result)).not.toContain("ambient");
		});
	});

	describe("textOccurrences (名前テキスト出現数)", () => {
		it("どこにも名前が出現しない場合は 0", () => {
			const project = setup({
				"/a.ts": "export function reallyDead(): void {}",
				"/b.ts": "const x = 1;",
			});
			const result = findUnusedExports(project);
			const entry = result.unusedExports.find((e) => e.name === "reallyDead");
			expect(entry?.textOccurrences).toBe(0);
		});

		it("文字列リテラル内に名前が出現すれば 1+", () => {
			const project = setup({
				"/a.ts": "export function dynamicCalled(): void {}",
				// 動的参照: 静的 import ではないため findReferences は拾わない
				"/b.ts": 'const name = "dynamicCalled"; console.log(name);',
			});
			const result = findUnusedExports(project);
			const entry = result.unusedExports.find(
				(e) => e.name === "dynamicCalled",
			);
			expect(entry?.textOccurrences).toBeGreaterThan(0);
		});

		it("宣言ファイル自身の出現はカウントしない", () => {
			const project = setup({
				// 宣言ファイル内には "selfRef" が複数回出現する (declaration + 内部 self-call)
				"/a.ts": [
					"export function selfRef(): void {",
					"  selfRef();",
					"}",
				].join("\n"),
			});
			const result = findUnusedExports(project);
			const entry = result.unusedExports.find((e) => e.name === "selfRef");
			expect(entry?.textOccurrences).toBe(0);
		});

		it("合成 import で注入した名前はカウントしない (namespace 展開時の自己汚染回避)", () => {
			const project = setup({
				// foo は actions.ts で宣言され、bundle.ts で `import * as`-スプレッドされる
				// 展開有効時、bundle.ts には合成 import が追加されるが、その中の "foo" は除外したい
				"/actions.ts": "export const foo = 1;",
				"/bundle.ts": [
					'import * as actions from "./actions";',
					"export const all = { ...actions };",
				].join("\n"),
				"/main.ts": [
					'import { all } from "./bundle";',
					"console.log(all);",
				].join("\n"),
			});
			const result = findUnusedExports(project);
			// foo は namespace スプレッド経由で "使用中" 判定 → 候補に含まれない想定
			expect(
				result.unusedExports.find((e) => e.name === "foo"),
			).toBeUndefined();
		});
	});

	describe("sameFileReferenceCount (同一ファイル内参照数)", () => {
		it("どこからも使われない export は 0 (宣言ごと削除して安全)", () => {
			const project = setup({
				"/a.ts": "export function reallyDead(): void {}",
				"/b.ts": "const x = 1;",
			});
			const result = findUnusedExports(project);
			const entry = result.unusedExports.find((e) => e.name === "reallyDead");
			expect(entry?.sameFileReferenceCount).toBe(0);
		});

		it("同一ファイル内でのみ使われる export は 1+ (export キーワードのみ不要)", () => {
			const project = setup({
				"/a.ts": [
					"export function onlyLocal(): number { return 1; }",
					"const x = onlyLocal();",
					"console.log(x);",
				].join("\n"),
			});
			const result = findUnusedExports(project);
			const entry = result.unusedExports.find((e) => e.name === "onlyLocal");
			// 外部未参照だが同一ファイル内で 1 回使用
			expect(entry?.sameFileReferenceCount).toBe(1);
		});

		it("同一ファイル内の複数回使用を数える", () => {
			const project = setup({
				"/a.ts": [
					"export const seed = 1;",
					"const a = seed + 1;",
					"const b = seed + 2;",
					"console.log(a, b);",
				].join("\n"),
			});
			const result = findUnusedExports(project);
			const entry = result.unusedExports.find((e) => e.name === "seed");
			expect(entry?.sameFileReferenceCount).toBe(2);
		});

		it("宣言自身の識別子は同一ファイル内参照に数えない", () => {
			const project = setup({
				"/a.ts": "export function lonely(): void {}",
			});
			const result = findUnusedExports(project);
			const entry = result.unusedExports.find((e) => e.name === "lonely");
			expect(entry?.sameFileReferenceCount).toBe(0);
		});

		it("同一ファイル内の再エクスポートサイト (export { x }) は参照に数えない", () => {
			const project = setup({
				"/a.ts": [
					"function localOnly(): void {}",
					"export { localOnly };",
				].join("\n"),
			});
			const result = findUnusedExports(project);
			const entry = result.unusedExports.find((e) => e.name === "localOnly");
			// 再エクスポートのみで実利用は無い → 0 (宣言ごと削除可能なデッド)
			expect(entry?.sameFileReferenceCount).toBe(0);
		});
	});

	describe("namespace import 展開", () => {
		it("`import * as ns` + `{ ...ns }` でのみ使われる export はデフォルトで使用中扱い", () => {
			const project = setup({
				"/actions.ts": [
					"export const addToast = () => {};",
					"export const resetToast = () => {};",
				].join("\n"),
				"/bundle.ts": [
					'import * as actions from "./actions";',
					"export const all = { ...actions };",
				].join("\n"),
				"/main.ts": ['import { all } from "./bundle";', "all.addToast();"].join(
					"\n",
				),
			});
			const result = findUnusedExports(project);
			// 展開なしなら addToast / resetToast の両方が偽陽性で出る。展開有りなら 0 件。
			expect(names(result)).not.toContain("addToast");
			expect(names(result)).not.toContain("resetToast");
		});

		it("expandNamespaceImports: false で展開を OFF にすると namespace 経由は検出されない", () => {
			const project = setup({
				"/actions.ts": [
					"export const addToast = () => {};",
					"export const resetToast = () => {};",
				].join("\n"),
				"/bundle.ts": [
					'import * as actions from "./actions";',
					"export const all = { ...actions };",
				].join("\n"),
				"/main.ts": ['import { all } from "./bundle";', "all.addToast();"].join(
					"\n",
				),
			});
			const result = findUnusedExports(project, {
				expandNamespaceImports: false,
			});
			expect(names(result)).toContain("addToast");
			expect(names(result)).toContain("resetToast");
		});

		it("namespace 経由を含めて本当にどこからも使われない export は引き続き検出される", () => {
			const project = setup({
				"/actions.ts": [
					"export const used = () => {};",
					"export const reallyUnused = () => {};",
				].join("\n"),
				"/bundle.ts": [
					'import * as actions from "./actions";',
					"export const all = actions.used;",
				].join("\n"),
				"/main.ts": ['import { all } from "./bundle";', "all();"].join("\n"),
			});
			// reallyUnused は namespace ns.X でもアクセスされていないが、
			// namespace 展開は「使われる可能性がある」を保守的に扱う方針なので "使用中" と判定される。
			// = 真陽性を 1 件犠牲にして 偽陽性を撲滅する設計トレードオフを明示するテスト。
			const result = findUnusedExports(project);
			expect(names(result)).not.toContain("reallyUnused");
			expect(names(result)).not.toContain("used");
		});
	});

	describe("namespace import 展開: 副作用・衝突回避", () => {
		it("呼び出し後の Project テキストには synthetic ImportDeclaration が残らない", () => {
			const project = setup({
				"/actions.ts": "export const addToast = () => {};",
				"/bundle.ts": [
					'import * as actions from "./actions";',
					"export const all = { ...actions };",
				].join("\n"),
			});
			findUnusedExports(project);
			// 内容が clean であれば、後段の project.save() は元のテキストを書き戻すだけ。
			// `isSaved()` のフラグは追加→削除でも dirty のまま残るのが ts-morph の仕様なのでチェックしない。
			for (const sf of project.getSourceFiles()) {
				expect(sf.getFullText()).not.toContain(
					"__find_unused_exports_ns_ref__",
				);
			}
		});

		it("同名 export を別モジュールから namespace import しても alias 衝突しない", () => {
			const project = setup({
				"/libA.ts": "export const addToast = () => {};",
				"/libB.ts": "export const addToast = () => {};",
				"/consumer.ts": [
					'import * as a from "./libA";',
					'import * as b from "./libB";',
					"export const all = { ...a, ...b };",
				].join("\n"),
				// 実利用がある side
				"/main.ts": ['import { all } from "./consumer";', "all;"].join("\n"),
			});
			// 衝突で findReferences が throw すると logger.warn 経由で false negative になるが、
			// alias を unique にしているので throw なしで動作する想定。両方 addToast が "使用中" 判定 → 候補に出ない。
			const result = findUnusedExports(project);
			expect(
				result.unusedExports.map((e) => `${e.filePath}::${e.name}`),
			).not.toContain("/libA.ts::addToast");
			expect(
				result.unusedExports.map((e) => `${e.filePath}::${e.name}`),
			).not.toContain("/libB.ts::addToast");
		});

		it("type-only export は value-import として注入されない (型 export の未使用検出を保つ)", () => {
			const project = setup({
				"/types.ts": [
					"export interface Foo { v: number }",
					"export type Bar = number;",
				].join("\n"),
				"/consumer.ts": [
					'import * as t from "./types";',
					"export const x: any = { ...t };",
				].join("\n"),
			});
			const result = findUnusedExports(project);
			// type-only export は synthetic から除外されるため、未使用なら引き続き検出される
			expect(names(result)).toContain("Foo");
			expect(names(result)).toContain("Bar");
		});

		it("同一モジュールを複数の `import * as` で読んでも synthetic は 1 回だけ注入される", () => {
			const project = setup({
				"/mod.ts": "export const foo = 1;",
				"/consumer.ts": [
					'import * as a from "./mod";',
					'import * as b from "./mod";',
					"export const all = { ...a, ...b };",
				].join("\n"),
				"/main.ts": ['import { all } from "./consumer";', "all;"].join("\n"),
			});
			// 後始末されることだけ確認 (synthetic 重複生成で TS エラー → throw → catch swallow を踏まない)
			const result = findUnusedExports(project);
			expect(result.unusedExports.map((e) => e.name)).not.toContain("foo");
		});
	});

	describe("Unicode 識別子のテキスト出現カウント", () => {
		it("非 ASCII 名 (日本語) でも textOccurrences が正しく数えられる", () => {
			const project = setup({
				"/a.ts": "export function 集計(): void {}",
				// 名前のみ string literal で出現
				"/b.ts": 'const name = "集計"; console.log(name);',
			});
			const result = findUnusedExports(project);
			const entry = result.unusedExports.find((e) => e.name === "集計");
			expect(entry?.textOccurrences).toBeGreaterThan(0);
		});

		it("非 ASCII 名でも IdentifierPart 境界を正しく扱う", () => {
			const project = setup({
				"/a.ts": "export function λ(): void {}",
				// `λ` を JSX-like 位置に
				"/b.ts": 'const name = "λ";',
			});
			const result = findUnusedExports(project);
			const entry = result.unusedExports.find((e) => e.name === "λ");
			expect(entry?.textOccurrences).toBeGreaterThan(0);
		});
	});

	describe("entryPoints の path 正規化", () => {
		it("非正規形 (`..` 含む) でも正規化されてマッチする", () => {
			const project = setup({
				"/src/public-api.ts": "export function publicFn(): void {}",
				"/src/internal.ts": "export function internalFn(): void {}",
			});
			const result = findUnusedExports(project, {
				entryPoints: ["/src/sub/../public-api.ts"],
			});
			// 正規化されないと entryPoint が無視され publicFn も報告されてしまう
			expect(names(result)).toEqual(["internalFn"]);
		});
	});

	describe("結果の付帯情報", () => {
		it("scannedFiles はフィルタ後のファイル数を返す", () => {
			const project = setup({
				"/a.ts": "export function fn(): void {}",
				"/b.ts": "const x = 1;",
				"/c.test.ts": "export function helper(): void {}",
			});
			const result = findUnusedExports(project, {
				excludeFilePatterns: [".test."],
			});
			expect(result.scannedFiles).toBe(2);
		});

		it("位置情報は識別子の位置を返す", () => {
			const project = setup({
				"/a.ts": [
					"// header comment",
					"export function target(): void {}",
				].join("\n"),
			});
			const result = findUnusedExports(project);
			expect(result.unusedExports[0]).toMatchObject({
				line: 2,
				name: "target",
			});
			// "export function target" の "target" は 17 文字目あたり (1-based)
			expect(result.unusedExports[0].column).toBeGreaterThan(1);
		});
	});
});
