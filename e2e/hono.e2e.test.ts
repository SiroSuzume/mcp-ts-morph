import { beforeAll, afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import { HONO } from "./targets";
import {
	absPath,
	createScenario,
	isWorkingTreeClean,
	locateSymbolPosition,
	textOf,
	tsconfigPathOf,
} from "./scenario";

const URL_FILE = "src/utils/url.ts";

const { harness, setup, reset, requirePrepared, expectNoRegression } =
	createScenario(HONO);

beforeAll(setup, 600_000);
afterEach(reset);

describe("hono E2E (read-only tools)", () => {
	it("find_references: getPattern の参照を 1 件以上返す", async (ctx) => {
		requirePrepared(ctx);
		const { absFilePath, position } = locateSymbolPosition(
			HONO,
			URL_FILE,
			"getPattern",
		);

		const result = await harness.callTool("find_references_by_tsmorph", {
			tsconfigPath: tsconfigPathOf(HONO),
			targetFilePath: absFilePath,
			position,
		});

		expect(result.isError).toBeFalsy();
		expect(textOf(result).toLowerCase()).toContain("reference");
	});

	it("get_type_at_position: getPattern の型情報を取得できる", async (ctx) => {
		requirePrepared(ctx);
		const { absFilePath, position } = locateSymbolPosition(
			HONO,
			URL_FILE,
			"getPattern",
		);

		const result = await harness.callTool("get_type_at_position_by_tsmorph", {
			tsconfigPath: tsconfigPathOf(HONO),
			targetFilePath: absFilePath,
			position,
		});

		expect(result.isError).toBeFalsy();
		const text = textOf(result);
		expect(text).toContain("Type:");
		expect(text).toContain("getPattern");
	});

	it("find_unused_exports: エラーなく候補を列挙する", async (ctx) => {
		requirePrepared(ctx);
		const result = await harness.callTool("find_unused_exports_by_tsmorph", {
			tsconfigPath: tsconfigPathOf(HONO),
		});

		expect(result.isError).toBeFalsy();
		const text = textOf(result);
		expect(
			text.includes("Unused export candidates") ||
				text.includes("No unused exports found"),
		).toBe(true);
	});
});

describe("hono E2E (mutating tools, 差分緑検証)", () => {
	it("rename_symbol: getPattern を往復リネームすると元に戻る & 型/テスト緑", async (ctx) => {
		requirePrepared(ctx);
		const tsconfigPath = tsconfigPathOf(HONO);
		const tmpName = "getPattern_e2e_tmp";

		const forward = locateSymbolPosition(HONO, URL_FILE, "getPattern");
		const r1 = await harness.callTool("rename_symbol_by_tsmorph", {
			tsconfigPath,
			targetFilePath: forward.absFilePath,
			position: forward.position,
			symbolName: "getPattern",
			newName: tmpName,
			dryRun: false,
		});
		expect(r1.isError).toBeFalsy();

		expectNoRegression();

		// 往復で元に戻す
		const back = locateSymbolPosition(HONO, URL_FILE, tmpName);
		const r2 = await harness.callTool("rename_symbol_by_tsmorph", {
			tsconfigPath,
			targetFilePath: back.absFilePath,
			position: back.position,
			symbolName: tmpName,
			newName: "getPattern",
			dryRun: false,
		});
		expect(r2.isError).toBeFalsy();
		expect(isWorkingTreeClean(HONO)).toBe(true);
	});

	it("move_symbol_to_file: getPattern を別ファイルに移動しても型/テスト緑", async (ctx) => {
		requirePrepared(ctx);
		const targetFilePath = absPath(HONO, "src/utils/_e2e-get-pattern.ts");

		const result = await harness.callTool("move_symbol_to_file_by_tsmorph", {
			tsconfigPath: tsconfigPathOf(HONO),
			originalFilePath: absPath(HONO, URL_FILE),
			targetFilePath,
			symbolToMove: "getPattern",
			declarationKindString: "VariableStatement",
			dryRun: false,
		});

		expect(result.isError, textOf(result)).toBeFalsy();
		expect(fs.existsSync(targetFilePath)).toBe(true);

		expectNoRegression();
	});

	// 移動元ファイルに移動シンボルへの参照が残る（= 差し戻し import が必要）ケース。
	// splitPath は同ファイルの splitRoutingPath から参照されるため、移動先からの
	// 逆向き import が必要になる。旧実装は fixMissingImports() で
	// "children of the old and new trees were expected to have the same count" を
	// 投げて失敗していた（add-back-imports-to-original-file.ts で修正済み）。
	it("move_symbol_to_file: 移動元に参照が残る splitPath を移動しても型/テスト緑", async (ctx) => {
		requirePrepared(ctx);
		const targetFilePath = absPath(HONO, "src/utils/_e2e-split.ts");

		const result = await harness.callTool("move_symbol_to_file_by_tsmorph", {
			tsconfigPath: tsconfigPathOf(HONO),
			originalFilePath: absPath(HONO, URL_FILE),
			targetFilePath,
			symbolToMove: "splitPath",
			declarationKindString: "VariableStatement",
			dryRun: false,
		});

		expect(result.isError, textOf(result)).toBeFalsy();
		expect(fs.existsSync(targetFilePath)).toBe(true);

		expectNoRegression();
	});

	it("change_signature: tryDecode に末尾引数を追加しても型/テスト緑", async (ctx) => {
		requirePrepared(ctx);
		const { absFilePath, position } = locateSymbolPosition(
			HONO,
			URL_FILE,
			"tryDecode",
		);

		const result = await harness.callTool("change_signature_by_tsmorph", {
			tsconfigPath: tsconfigPathOf(HONO),
			targetFilePath: absFilePath,
			position,
			functionName: "tryDecode",
			changes: [
				{
					kind: "add",
					index: 2,
					name: "_e2eFlag",
					typeText: "boolean",
					argumentForCallers: "false",
				},
			],
			dryRun: false,
		});

		expect(result.isError, textOf(result)).toBeFalsy();
		expectNoRegression();
	});
});
