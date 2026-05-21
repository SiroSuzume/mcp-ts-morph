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
});
