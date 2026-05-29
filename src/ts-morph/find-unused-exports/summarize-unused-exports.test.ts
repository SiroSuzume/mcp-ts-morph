import { describe, expect, it } from "vitest";
import type { UnusedExport } from "./find-unused-exports";
import { summarizeUnusedExports } from "./summarize-unused-exports";

function entry(partial: Partial<UnusedExport>): UnusedExport {
	return {
		filePath: "/src/a.ts",
		line: 1,
		column: 1,
		name: "x",
		kind: "VariableDeclaration",
		isDefaultExport: false,
		textOccurrences: 0,
		sameFileReferenceCount: 0,
		...partial,
	};
}

describe("summarizeUnusedExports", () => {
	it("空配列はすべて 0 / 空集計", () => {
		const s = summarizeUnusedExports([]);
		expect(s).toEqual({
			total: 0,
			deletable: 0,
			unexportOnly: 0,
			defaultExports: 0,
			byKind: [],
			byDirectory: [],
		});
	});

	it("total と削除安全性 (deletable / unexportOnly) を数える", () => {
		const s = summarizeUnusedExports([
			entry({ sameFileReferenceCount: 0 }),
			entry({ sameFileReferenceCount: 0 }),
			entry({ sameFileReferenceCount: 3 }),
		]);
		expect(s.total).toBe(3);
		expect(s.deletable).toBe(2);
		expect(s.unexportOnly).toBe(1);
	});

	it("default export 数を数える", () => {
		const s = summarizeUnusedExports([
			entry({ isDefaultExport: true }),
			entry({ isDefaultExport: false }),
		]);
		expect(s.defaultExports).toBe(1);
	});

	it("kind 別を件数降順で返す", () => {
		const s = summarizeUnusedExports([
			entry({ kind: "TypeAliasDeclaration" }),
			entry({ kind: "TypeAliasDeclaration" }),
			entry({ kind: "VariableDeclaration" }),
		]);
		expect(s.byKind).toEqual([
			{ kind: "TypeAliasDeclaration", count: 2 },
			{ kind: "VariableDeclaration", count: 1 },
		]);
	});

	it("ディレクトリ別を件数降順で返す (ファイル名を除いた dir 単位)", () => {
		const s = summarizeUnusedExports([
			entry({ filePath: "/src/feat/a.ts" }),
			entry({ filePath: "/src/feat/b.ts" }),
			entry({ filePath: "/src/util/c.ts" }),
		]);
		expect(s.byDirectory).toEqual([
			{ directory: "/src/feat", count: 2 },
			{ directory: "/src/util", count: 1 },
		]);
	});
});
