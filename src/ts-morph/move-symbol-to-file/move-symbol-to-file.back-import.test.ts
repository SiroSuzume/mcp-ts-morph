import { describe, it, expect } from "vitest";
import { SyntaxKind } from "ts-morph";
import { createInMemoryProjectWithDoubleQuotes } from "../_test-utils/create-in-memory-project";
import { getFileText } from "../_test-utils/get-file-text";
import { moveSymbolToFile } from "./move-symbol-to-file";

describe("moveSymbolToFile back-import (regression)", () => {
	// 移動元に残るシンボルが移動シンボルを参照する場合、移動先からの逆向き
	// import を張る必要がある。旧実装は fixMissingImports() に頼っていたが、
	// 「先頭 JSDoc + type 宣言 + 削除後の fixMissingImports」という組み合わせで
	// ts-morph が "children of the old and new trees were expected to have the
	// same count" を投げて失敗していた。hono の src/utils/url.ts で実際に再現。
	it("移動元に残るコードが移動シンボルを参照する場合、逆向き import を張る", async () => {
		const project = createInMemoryProjectWithDoubleQuotes();
		const oldFilePath = "/src/url.ts";
		const newFilePath = "/src/split-path.ts";

		project.createSourceFile(
			oldFilePath,
			`/**
 * @module
 */

export type Pattern = readonly [string, string, RegExp | true] | '*'
export const splitPath = (path: string): string[] => {
  return path.split("/");
};
export const splitRoutingPath = (routePath: string): string[] => {
  return splitPath(routePath);
};
`,
		);

		await moveSymbolToFile(
			project,
			oldFilePath,
			newFilePath,
			"splitPath",
			SyntaxKind.VariableStatement,
		);

		const oldText = getFileText(project, oldFilePath);
		const newText = getFileText(project, newFilePath);

		// 移動先に splitPath 本体がある
		expect(newText).toContain(
			"export const splitPath = (path: string): string[]",
		);
		// 移動元は宣言を持たず、逆向き import を張っている
		expect(oldText).not.toContain("export const splitPath");
		expect(oldText).toContain('import { splitPath } from "./split-path"');
		// 残った参照側はそのまま
		expect(oldText).toContain("export const splitRoutingPath");
		expect(oldText).toContain("return splitPath(routePath)");
	});

	it("移動元の複数のシンボルが移動シンボルを参照する場合、逆向き import を 1 つにまとめる", async () => {
		const project = createInMemoryProjectWithDoubleQuotes();
		const oldFilePath = "/src/source.ts";
		const newFilePath = "/src/shared.ts";

		project.createSourceFile(
			oldFilePath,
			`export const shared = (x: number): number => x * 2;
export const a = (x: number): number => shared(x) + 1;
export const b = (x: number): number => shared(x) - 1;
`,
		);

		await moveSymbolToFile(
			project,
			oldFilePath,
			newFilePath,
			"shared",
			SyntaxKind.VariableStatement,
		);

		const oldText = getFileText(project, oldFilePath);
		const importCount = (
			oldText.match(/import \{ shared \} from "\.\/shared"/g) ?? []
		).length;
		expect(importCount).toBe(1);
		expect(oldText).toContain("export const a");
		expect(oldText).toContain("export const b");
		expect(getFileText(project, newFilePath)).toContain("export const shared");
	});
});
