import { describe, it, expect } from "vitest";
import { Project, SyntaxKind } from "ts-morph";
import { findTopLevelDeclarationByName } from "./find-declaration";
import { generateNewSourceFileContent } from "./generate-new-source-file-content";
import type { DependencyClassification, NeededExternalImports } from "./types";

// テストプロジェクト設定用ヘルパー
const setupProjectWithCode = (code: string, filePath = "/src/original.ts") => {
	const project = new Project({ useInMemoryFileSystem: true });
	const originalSourceFile = project.createSourceFile(filePath, code);
	return { project, originalSourceFile };
};

describe("generateNewSourceFileContent", () => {
	it("依存関係のない VariableDeclaration から新しいファイルの内容を生成できる", () => {
		// Arrange
		const code = "const myVar = 123;";
		const { originalSourceFile } = setupProjectWithCode(code);
		const targetSymbolName = "myVar";

		const declarationStatement = findTopLevelDeclarationByName(
			originalSourceFile,
			targetSymbolName,
			SyntaxKind.VariableStatement,
		);
		expect(declarationStatement).toBeDefined();
		if (!declarationStatement) return;

		// ★ 手動で分類済み依存関係と外部インポート情報を作成
		const classifiedDependencies: DependencyClassification[] = [];
		const neededExternalImports: NeededExternalImports = new Map();

		// Act
		const newFileContent = generateNewSourceFileContent(
			declarationStatement,
			classifiedDependencies,
			originalSourceFile.getFilePath(),
			"/src/newLocation.ts",
			neededExternalImports,
		);

		// Assert
		const expectedContent = "export const myVar = 123;\n";
		expect(newFileContent.trim()).toBe(expectedContent.trim());
	});

	it("内部依存関係 (moveToNewFile) を持つ VariableDeclaration から新しいファイル内容を生成できる", () => {
		// Arrange
		const code = `
			function helperFunc(n: number): number {
				return n * 2;
			}
			const myVar = helperFunc(10);
		`;
		const { originalSourceFile } = setupProjectWithCode(code);
		const targetSymbolName = "myVar";
		const dependencyName = "helperFunc";

		const declarationStatement = findTopLevelDeclarationByName(
			originalSourceFile,
			targetSymbolName,
			SyntaxKind.VariableStatement,
		);
		const dependencyStatement = findTopLevelDeclarationByName(
			originalSourceFile,
			dependencyName,
			SyntaxKind.FunctionDeclaration,
		);

		expect(declarationStatement).toBeDefined();
		expect(dependencyStatement).toBeDefined();
		if (!declarationStatement || !dependencyStatement) return;

		// ★ 手動で分類済み依存関係と外部インポート情報を作成
		const classifiedDependencies: DependencyClassification[] = [
			{ type: "moveToNewFile", statement: dependencyStatement },
		];
		const neededExternalImports: NeededExternalImports = new Map();

		// Act
		const newFileContent = generateNewSourceFileContent(
			declarationStatement,
			classifiedDependencies,
			originalSourceFile.getFilePath(),
			"/src/newLocation.ts",
			neededExternalImports,
		);

		// Assert
		const expectedContent = `
			/* export なし */ function helperFunc(n: number): number {
				return n * 2;
			}

			export const myVar = helperFunc(10);
		`;
		const normalize = (str: string) => str.replace(/\s+/g, " ").trim();
		expect(normalize(newFileContent)).toBe(
			normalize(expectedContent.replace("/* export なし */ ", "")),
		);
		expect(newFileContent).not.toContain("export function helperFunc");
		expect(newFileContent).toContain("function helperFunc");
	});

	it("外部依存関係 (import) を持つ VariableDeclaration から新しいファイル内容を生成できる", () => {
		// Arrange
		const externalCode =
			"export function externalFunc(n: number): number { return n + 1; }";
		const originalCode = `
			import { externalFunc } from './external';
			const myVar = externalFunc(99);
		`;
		const { project, originalSourceFile } = setupProjectWithCode(
			originalCode,
			"/src/moduleA/main.ts",
		);
		project.createSourceFile("/src/moduleA/external.ts", externalCode);
		const targetSymbolName = "myVar";
		const newFilePath = "/src/moduleB/newFile.ts";

		const declarationStatement = findTopLevelDeclarationByName(
			originalSourceFile,
			targetSymbolName,
			SyntaxKind.VariableStatement,
		);
		expect(declarationStatement).toBeDefined();
		if (!declarationStatement) return;

		// ★ 手動で分類済み依存関係と外部インポート情報を作成
		const classifiedDependencies: DependencyClassification[] = [];
		const neededExternalImports: NeededExternalImports = new Map();
		// 外部インポート情報を手動でセットアップ
		const importDecl = originalSourceFile.getImportDeclaration("./external");
		expect(importDecl).toBeDefined();
		if (importDecl) {
			neededExternalImports.set("../moduleA/external", {
				names: new Set(["externalFunc"]),
				declaration: importDecl,
			});
		}

		// Act
		const newFileContent = generateNewSourceFileContent(
			declarationStatement,
			classifiedDependencies,
			originalSourceFile.getFilePath(),
			newFilePath,
			neededExternalImports,
		);

		// Assert
		const expectedContent = `
import { externalFunc } from "../moduleA/external";
export const myVar = externalFunc(99);
		`.trim();
		const normalize = (str: string) => str.replace(/\s+/g, " ").trim();
		expect(normalize(newFileContent)).toBe(normalize(expectedContent));
	});

	// TODO: 内部依存関係 (importFromOriginal) のテスト
	// TODO: 内部依存と外部依存が混在するテスト
});
