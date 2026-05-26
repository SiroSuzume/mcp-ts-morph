import { describe, it, expect, vi } from "vitest";
import { createInMemoryProject } from "../_test-utils/create-in-memory-project";
import {
	getTsConfigAliasKeys,
	getTsConfigBaseUrl,
	getTsConfigPaths,
} from "./ts-morph-project";

vi.mock("../../utils/logger");

describe("getTsConfigPaths", () => {
	it("paths が設定されていない場合は undefined を返す", () => {
		const project = createInMemoryProject({ pathAliases: {} });
		project.compilerOptions.set({ baseUrl: ".", paths: undefined });
		expect(getTsConfigPaths(project)).toBeUndefined();
	});

	it("正常な paths を返す", () => {
		const project = createInMemoryProject({
			pathAliases: { "@/*": ["src/*"], "@lib/*": ["lib/*"] },
		});
		expect(getTsConfigPaths(project)).toEqual({
			"@/*": ["src/*"],
			"@lib/*": ["lib/*"],
		});
	});

	it("paths の値が文字列配列でないエントリはスキップされる", () => {
		const project = createInMemoryProject();
		project.compilerOptions.set({
			baseUrl: ".",
			paths: {
				"@/*": ["src/*"],
				// @ts-expect-error 不正値の動作を検証
				"@bad": "not-an-array",
				// @ts-expect-error 不正値の動作を検証
				"@mixed/*": [123, "lib/*"],
			},
		});

		expect(getTsConfigPaths(project)).toEqual({ "@/*": ["src/*"] });
	});

	it("paths がオブジェクト以外の場合は undefined を返す", () => {
		const project = createInMemoryProject();
		// @ts-expect-error 不正値の動作を検証
		project.compilerOptions.set({ baseUrl: ".", paths: "invalid" });
		expect(getTsConfigPaths(project)).toBeUndefined();
	});
});

describe("getTsConfigAliasKeys", () => {
	it("paths のキー一覧を返す", () => {
		const project = createInMemoryProject({
			pathAliases: { "@/*": ["src/*"], "@lib/*": ["lib/*"] },
		});
		expect(getTsConfigAliasKeys(project).sort()).toEqual(["@/*", "@lib/*"]);
	});

	it("paths が無ければ空配列を返す", () => {
		const project = createInMemoryProject({ pathAliases: {} });
		project.compilerOptions.set({ baseUrl: ".", paths: undefined });
		expect(getTsConfigAliasKeys(project)).toEqual([]);
	});
});

describe("getTsConfigBaseUrl", () => {
	it("baseUrl を返す", () => {
		const project = createInMemoryProject();
		expect(getTsConfigBaseUrl(project)).toBe(".");
	});

	it("baseUrl が設定されていない場合は undefined を返す", () => {
		const project = createInMemoryProject();
		project.compilerOptions.set({ baseUrl: undefined });
		expect(getTsConfigBaseUrl(project)).toBeUndefined();
	});
});
