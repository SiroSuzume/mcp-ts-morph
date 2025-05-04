import { describe, it, expect, vi } from "vitest";
import { Project } from "ts-morph";
import type { DependencyClassification } from "../types";
import { ensureExportsInOriginalFile } from "./ensure-exports-in-original-file";
import logger from "../../utils/logger";

// logger.warn のモック
vi.mock("../../utils/logger");

describe("ensureExportsInOriginalFile", () => {
	const setupProject = () => {
		return new Project({ useInMemoryFileSystem: true });
	};

	it("addExport タイプで未エクスポートの場合、export キーワードを追加する", () => {
		// Arrange
		const project = setupProject();
		const sourceFile = project.createSourceFile(
			"original.ts",
			"const dep1 = 1;\nfunction dep2() {}",
		);
		const dep1Statement = sourceFile.getVariableStatementOrThrow("dep1");
		const dep2Statement = sourceFile.getFunctionOrThrow("dep2");

		const classifiedDependencies: DependencyClassification[] = [
			{
				type: "addExport",
				name: "dep1",
				statement: dep1Statement,
			},
			{
				type: "addExport",
				name: "dep2",
				statement: dep2Statement,
			},
		];

		// Act
		ensureExportsInOriginalFile(classifiedDependencies, "original.ts");

		// Assert
		expect(dep1Statement.isExported()).toBe(true);
		expect(dep2Statement.isExported()).toBe(true);
		expect(sourceFile.getFullText()).toBe(
			"export const dep1 = 1;\nexport function dep2() {}",
		);
	});

	it("addExport タイプで既にエクスポート済みの場合、変更しない", () => {
		// Arrange
		const project = setupProject();
		const sourceFile = project.createSourceFile(
			"original.ts",
			"export const dep1 = 1;\nexport function dep2() {}",
		);
		const dep1Statement = sourceFile.getVariableStatementOrThrow("dep1");
		const dep2Statement = sourceFile.getFunctionOrThrow("dep2");

		const originalText = sourceFile.getFullText();

		const classifiedDependencies: DependencyClassification[] = [
			{
				type: "addExport",
				name: "dep1",
				statement: dep1Statement,
			},
			{
				type: "addExport",
				name: "dep2",
				statement: dep2Statement,
			},
		];

		// Act
		ensureExportsInOriginalFile(classifiedDependencies, "original.ts");

		// Assert
		expect(dep1Statement.isExported()).toBe(true);
		expect(dep2Statement.isExported()).toBe(true);
		expect(sourceFile.getFullText()).toBe(originalText); // 変更がないことを確認
	});

	it("addExport タイプでない依存関係は無視する", () => {
		// Arrange
		const project = setupProject();
		const sourceFile = project.createSourceFile(
			"original.ts",
			"const dep1 = 1;",
		);
		const dep1Statement = sourceFile.getVariableStatementOrThrow("dep1");

		const originalText = sourceFile.getFullText();

		const classifiedDependencies: DependencyClassification[] = [
			{
				type: "moveToNewFile", // addExport ではない
				statement: dep1Statement,
			},
		];

		// Act
		ensureExportsInOriginalFile(classifiedDependencies, "original.ts");

		// Assert
		expect(dep1Statement.isExported()).toBe(false);
		expect(sourceFile.getFullText()).toBe(originalText);
	});

	it("エクスポート不可能なノードに対して警告ログを出力する", () => {
		// Arrange
		const project = setupProject();
		// エクスポートできないステートメント (例: ラベル付きステートメント)
		const sourceFile = project.createSourceFile(
			"original.ts",
			"myLabel: for (let i = 0; i < 1; i++) {}",
		);
		const labeledStatement = sourceFile.getStatements()[0];

		const classifiedDependencies: DependencyClassification[] = [
			{
				type: "addExport",
				name: "myLabel", // 名前は適当
				statement: labeledStatement,
			},
		];

		// Act
		ensureExportsInOriginalFile(classifiedDependencies, "original.ts");

		// Assert
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining(
				"Attempted to add export to a non-exportable node",
			),
		);
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining(labeledStatement.getKindName()),
		);
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining("myLabel"),
		);
	});
});
