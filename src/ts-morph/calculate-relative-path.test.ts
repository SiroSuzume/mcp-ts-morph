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

	it("removeExtensions: false の場合、拡張子を維持する", () => {
		const fromPath = "/src/a.ts";
		const toPath = "/src/b.jsx";
		expect(
			calculateRelativePath(fromPath, toPath, { removeExtensions: false }),
		).toBe("./b.jsx");
	});

	it("removeExtensions: false の場合、simplifyIndex: true でも index は省略されない", () => {
		const fromPath = "/src/components/core/Icon.tsx";
		const toPath = "/src/components/index.js"; // .js 拡張子付き
		expect(
			calculateRelativePath(fromPath, toPath, {
				removeExtensions: false,
				simplifyIndex: true,
			}),
		).toBe("../index.js");
		expect(
			calculateRelativePath(fromPath, toPath, {
				removeExtensions: false,
				simplifyIndex: false,
			}),
		).toBe("../index.js"); // simplifyIndex: false でも同じ
	});

	it("removeExtensions: true, simplifyIndex: false の場合、拡張子は削除するが index は省略しない", () => {
		const fromPath = "/src/components/core/primitive/utils/helper.ts";
		const toPath = "/src/components/index.ts";
		expect(
			calculateRelativePath(fromPath, toPath, {
				removeExtensions: true,
				simplifyIndex: false,
			}),
		).toBe("../../../index");
	});

	it("removeExtensions にカスタム配列を指定した場合、指定された拡張子のみ削除する", () => {
		const fromPath = "/src/dir/file.ts";
		const toPathTsx = "/src/dir/other.tsx";
		const toPathJson = "/src/dir/data.json";
		const toPathCss = "/src/dir/styles.css"; // これは削除されないはず

		const options = { removeExtensions: [".ts", ".tsx"] }; // .json は削除対象外

		expect(calculateRelativePath(fromPath, toPathTsx, options)).toBe("./other");
		expect(calculateRelativePath(fromPath, toPathJson, options)).toBe(
			"./data.json",
		); // 維持される
		expect(calculateRelativePath(fromPath, toPathCss, options)).toBe(
			"./styles.css",
		); // 維持される
	});
});
