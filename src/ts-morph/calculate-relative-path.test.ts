import { describe, it, expect } from "vitest";
import { calculateRelativePath } from "./calculate-relative-path";

describe("calculateRelativePath", () => {
	it("同じディレクトリ内の index.ts を参照する場合、'.' を返す", () => {
		const fromPath = "/src/components/Button.tsx";
		const toPath = "/src/components/index.ts";
		expect(calculateRelativePath(fromPath, toPath)).toBe(".");
	});

	it("親ディレクトリの index.ts を参照する場合、'..' を返す", () => {
		const fromPath = "/src/components/core/Icon.tsx";
		const toPath = "/src/components/index.ts";
		expect(calculateRelativePath(fromPath, toPath)).toBe("..");
	});

	it("二階層親の index.ts を参照する場合、'../..' を返す", () => {
		const fromPath = "/src/components/core/primitive/Box.tsx";
		const toPath = "/src/components/index.ts";
		expect(calculateRelativePath(fromPath, toPath)).toBe("../.."); // 期待値
	});

	it("三階層親の index.ts を参照する場合、'../../..' を返す", () => {
		const fromPath = "/src/components/core/primitive/utils/helper.ts";
		const toPath = "/src/components/index.ts";
		expect(calculateRelativePath(fromPath, toPath)).toBe("../../.."); // 期待値
	});

	it("同じディレクトリ内の別のファイルを参照する場合、'./filename' を返す", () => {
		const fromPath = "/src/utils/format.ts";
		const toPath = "/src/utils/parse.tsx";
		expect(calculateRelativePath(fromPath, toPath)).toBe("./parse");
	});

	it("サブディレクトリのファイルを参照する場合、'./subdir/filename' を返す", () => {
		const fromPath = "/src/hooks/useCounter.ts";
		const toPath = "/src/hooks/internal/state.ts";
		expect(calculateRelativePath(fromPath, toPath)).toBe("./internal/state");
	});

	it("親ディレクトリのファイルを参照する場合、'../filename' を返す", () => {
		const fromPath = "/src/components/Button.tsx";
		const toPath = "/src/utils/common.ts";
		expect(calculateRelativePath(fromPath, toPath)).toBe("../utils/common");
	});

	it("パスに拡張子が含まれていても削除される", () => {
		const fromPath = "/src/a.ts";
		const toPath = "/src/b.tsx";
		expect(calculateRelativePath(fromPath, toPath)).toBe("./b");
	});

	it("参照先が index ではない親ディレクトリの場合、'../dir' を返す", () => {
		const fromPath = "/src/components/core/Icon.tsx";
		const toPath = "/src/hooks/useFetch.ts";
		expect(calculateRelativePath(fromPath, toPath)).toBe(
			"../../hooks/useFetch",
		);
	});
});
