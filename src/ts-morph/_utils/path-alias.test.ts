import { describe, expect, it } from "vitest";
import { isPathAlias } from "./path-alias";

describe("isPathAlias", () => {
	it("ワイルドカードエイリアスの prefix と前方一致するとき true", () => {
		expect(isPathAlias("@/components/Button", ["@/*"])).toBe(true);
	});

	it("ワイルドカードエイリアスの prefix と一致しないとき false", () => {
		expect(isPathAlias("react", ["@/*"])).toBe(false);
	});

	it("ワイルドカードなしエイリアスとは完全一致のみ true", () => {
		expect(isPathAlias("@app", ["@app"])).toBe(true);
		expect(isPathAlias("@app/router", ["@app"])).toBe(false);
	});

	it("似た prefix を持つ別エイリアスを誤判定しない", () => {
		// "@foo" 定義に対し "@foobar/baz" は別物として false
		expect(isPathAlias("@foobar/baz", ["@foo"])).toBe(false);
		// `/*` 付きでも prefix 末尾の `/` まで一致が必要
		expect(isPathAlias("@foobar/baz", ["@foo/*"])).toBe(false);
	});

	it("エイリアス配列が空なら常に false", () => {
		expect(isPathAlias("@/components", [])).toBe(false);
	});

	it("複数エイリアスのうちどれかに一致すれば true", () => {
		expect(isPathAlias("@components/Card", ["@/*", "@components/*"])).toBe(
			true,
		);
	});

	it("階層 prefix を含むワイルドカードは prefix 全体が一致したときのみ true", () => {
		expect(isPathAlias("@foo/bar/x", ["@foo/bar/*"])).toBe(true);
		// `@foo/barz` は `@foo/bar/` で始まらないため false
		expect(isPathAlias("@foo/barz", ["@foo/bar/*"])).toBe(false);
	});

	// 「`/*` で終わらないワイルドカードは完全一致のみ扱う」という挙動を spec として固定
	it.each([
		// "*" 単体: 完全一致のみ (実質的にほぼ常に false)
		{ specifier: "anything", alias: "*", expected: false },
		{ specifier: "*", alias: "*", expected: true },
		// "@*" のような `/` なし末尾アスタリスク: 完全一致のみ。前方一致は期待しない
		{ specifier: "@foo", alias: "@*", expected: false },
		{ specifier: "@*", alias: "@*", expected: true },
		// 末尾 `/` のみ (`*` なし): 完全一致のみ
		{ specifier: "@/foo", alias: "@/", expected: false },
		{ specifier: "@/", alias: "@/", expected: true },
		// 空文字エイリアス (malformed tsconfig 防御)
		{ specifier: "x", alias: "", expected: false },
		{ specifier: "", alias: "", expected: true },
	])(
		"alias=$alias / specifier=$specifier のとき $expected",
		({ specifier, alias, expected }) => {
			expect(isPathAlias(specifier, [alias])).toBe(expected);
		},
	);
});
