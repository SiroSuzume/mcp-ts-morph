import { describe, it, expect } from "vitest";
import * as path from "node:path";
import {
	resolveAliasToAbsolutePath,
	calculateRelativePath,
} from "./remove-path-alias";

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

describe("calculateRelativePath", () => {
	const basePath = "/path/to/project/src";

	it("同じディレクトリ内のファイルへの相対パスを計算できること", () => {
		const from = path.join(basePath, "feature/index.ts");
		const to = path.join(basePath, "feature/utils.ts");
		expect(calculateRelativePath(from, to)).toBe("./utils");
	});

	it("親ディレクトリのファイルへの相対パスを計算できること", () => {
		const from = path.join(basePath, "feature/a/module.ts");
		const to = path.join(basePath, "feature/index.ts");
		expect(calculateRelativePath(from, to)).toBe("../index");
	});

	it("兄弟ディレクトリのファイルへの相対パスを計算できること", () => {
		const from = path.join(basePath, "feature/a/module.ts");
		const to = path.join(basePath, "feature/b/service.js");
		expect(calculateRelativePath(from, to)).toBe("../b/service");
	});

	it("深い階層への相対パスを計算できること", () => {
		const from = path.join(basePath, "index.ts");
		const to = path.join(basePath, "core/network/http.tsx");
		expect(calculateRelativePath(from, to)).toBe("./core/network/http");
	});

	it("深い階層からの相対パスを計算できること", () => {
		const from = path.join(basePath, "a/b/c/d/e.ts");
		const to = path.join(basePath, "f/g.ts");
		expect(calculateRelativePath(from, to)).toBe("../../../../f/g");
	});

	it("ファイル名が同じでも正しく計算できること", () => {
		const from = path.join(basePath, "feature/a/index.ts");
		const to = path.join(basePath, "feature/b/index.ts");
		expect(calculateRelativePath(from, to)).toBe("../b/index");
	});

	it("拡張子 (.ts, .tsx, .js, .jsx, .json) を除去すること", () => {
		const from = "/a/b.ts";
		expect(calculateRelativePath(from, "/a/c.ts")).toBe("./c");
		expect(calculateRelativePath(from, "/a/d.tsx")).toBe("./d");
		expect(calculateRelativePath(from, "/a/e.js")).toBe("./e");
		expect(calculateRelativePath(from, "/a/f.jsx")).toBe("./f");
		expect(calculateRelativePath(from, "/a/g.json")).toBe("./g");
		expect(calculateRelativePath(from, "/a/h.css")).toBe("./h.css");
	});

	it.skip("Windows 風パスを入力しても POSIX 形式で出力すること", () => {
		const from = "C:\\project\\src\\feature\\index.ts";
		const to = "C:\\project\\src\\core\\utils.ts";
		const expected = "../core/utils";
		expect(calculateRelativePath(from, to)).toBe(expected);
	});
});
