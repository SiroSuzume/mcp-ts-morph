import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { resolveAliasToAbsolutePath } from "./remove-path-alias";

describe("resolveAliasToAbsolutePath", () => {
	const baseUrl = "/path/to/project/src";
	const paths = {
		"@/*": ["*"],
		"@components/*": ["components/specific/*"],
		"@utils/helpers": ["utils/helpers.ts"],
		"exact-alias": ["lib/exact"],
	};

	it("単純なワイルドカードエイリアス (@/*) を解決できること", () => {
		const result = resolveAliasToAbsolutePath(
			"@/logic/core.ts",
			baseUrl,
			paths,
		);
		expect(result).toBe(path.resolve(baseUrl, "logic/core.ts"));
	});

	it("特定パスのワイルドカードエイリアス (@components/*) を解決できること", () => {
		const result = resolveAliasToAbsolutePath(
			"@components/ui/Button.tsx",
			baseUrl,
			paths,
		);
		expect(result).toBe(
			path.resolve(baseUrl, "components/specific/ui/Button.tsx"),
		);
	});

	it("ファイルへの直接エイリアス (@utils/helpers) を解決できること", () => {
		const result = resolveAliasToAbsolutePath("@utils/helpers", baseUrl, paths);
		expect(result).toBe(path.resolve(baseUrl, "utils/helpers.ts"));
	});

	it("完全一致のエイリアス (exact-alias) を解決できること", () => {
		const result = resolveAliasToAbsolutePath("exact-alias", baseUrl, paths);
		expect(result).toBe(path.resolve(baseUrl, "lib/exact"));
	});

	it("一致しないエイリアスは undefined を返すこと", () => {
		const result = resolveAliasToAbsolutePath(
			"@nonexistent/path",
			baseUrl,
			paths,
		);
		expect(result).toBeUndefined();
	});

	it("エイリアスのプレフィックスだけ一致しても解決しないこと", () => {
		const result = resolveAliasToAbsolutePath(
			"@/components/but/not/specific",
			baseUrl,
			paths,
		);
		expect(result).toBe(path.resolve(baseUrl, "components/but/not/specific"));
	});

	it("パス区切り文字が混在していても解決できること (入力は正規化される前提)", () => {
		const aliasPath = "@/logic\\core.ts".replace(/\\/g, path.posix.sep);
		const result = resolveAliasToAbsolutePath(aliasPath, baseUrl, paths);
		expect(result).toBe(path.resolve(baseUrl, "logic/core.ts"));
	});
});
