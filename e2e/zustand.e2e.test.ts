import { beforeAll, afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import { ZUSTAND } from "./targets";
import {
	type HealthResult,
	type ToolResult,
	absPath,
	assertNoRegression,
	checkHealth,
	createToolHarness,
	prepareTarget,
	resetTarget,
	tsconfigPathOf,
} from "./scenario";

const harness = createToolHarness();
let baseline: HealthResult | undefined;

beforeAll(() => {
	try {
		prepareTarget(ZUSTAND);
		baseline = checkHealth(ZUSTAND);
	} catch {
		baseline = undefined;
	}
}, 600_000);

afterEach(() => {
	if (baseline) resetTarget(ZUSTAND);
});

function requirePrepared(ctx: {
	skip: (note?: string) => void;
}): asserts baseline is HealthResult {
	if (!baseline) {
		ctx.skip("zustand の準備（clone/install/baseline）に失敗したため skip");
	}
}

function expectNoRegression(): void {
	const reg = assertNoRegression(
		baseline as HealthResult,
		checkHealth(ZUSTAND),
	);
	expect(reg.ok, reg.detail).toBe(true);
}

function textOf(result: ToolResult): string {
	return result.content.map((c) => c.text).join("\n");
}

describe("zustand E2E (alias 系, 差分緑検証)", () => {
	it("remove_path_alias: テストの zustand エイリアス import を相対パス化しても型/テスト緑", async (ctx) => {
		requirePrepared(ctx);
		const targetPath = absPath(ZUSTAND, "tests/basic.test.tsx");

		const before = fs.readFileSync(targetPath, "utf-8");
		expect(before).toMatch(/from 'zustand'/);

		const result = await harness.callTool("remove_path_alias_by_tsmorph", {
			tsconfigPath: tsconfigPathOf(ZUSTAND),
			targetPath,
			dryRun: false,
		});

		expect(result.isError, textOf(result)).toBeFalsy();
		const after = fs.readFileSync(targetPath, "utf-8");
		// エイリアスが相対パスに置換されている
		expect(after).not.toMatch(/from 'zustand'/);
		expect(after).toMatch(/from '\.\.\/src/);

		expectNoRegression();
	});

	it("rename_filesystem_entry: middleware ファイルをリネームして import 更新しても型/テスト緑", async (ctx) => {
		requirePrepared(ctx);
		const oldPath = absPath(ZUSTAND, "src/middleware/combine.ts");
		const newPath = absPath(ZUSTAND, "src/middleware/_e2e-combine.ts");

		const result = await harness.callTool(
			"rename_filesystem_entry_by_tsmorph",
			{
				tsconfigPath: tsconfigPathOf(ZUSTAND),
				renames: [{ oldPath, newPath }],
				dryRun: false,
			},
		);

		expect(result.isError, textOf(result)).toBeFalsy();
		expect(fs.existsSync(newPath)).toBe(true);
		expect(fs.existsSync(oldPath)).toBe(false);

		expectNoRegression();
	});
});
