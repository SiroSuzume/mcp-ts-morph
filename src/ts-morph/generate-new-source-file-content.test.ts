import { describe, it, expect } from "vitest";
import { Project, SyntaxKind } from "ts-morph";
import { findTopLevelDeclarationByName } from "./find-declaration";
import { getInternalDependencies } from "./internal-dependencies";
import { generateNewSourceFileContent } from "./generate-new-source-file-content";

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

		// 移動対象の宣言と依存関係を取得 (既存のヘルパーを使用)
		const declarationStatement = findTopLevelDeclarationByName(
			originalSourceFile,
			targetSymbolName,
			SyntaxKind.VariableStatement,
		);
		const dependencies = declarationStatement
			? getInternalDependencies(declarationStatement)
			: [];

		expect(declarationStatement).toBeDefined();
		if (!declarationStatement) return;
		expect(dependencies).toEqual([]); // 依存がないことを確認

		// Act
		const newFileContent = generateNewSourceFileContent(
			declarationStatement,
			dependencies,
			originalSourceFile.getFilePath(), // 元ファイルのパス
			"/src/newLocation.ts", // 新しいファイルのパス (相対パス計算用)
		);

		// Assert
		// 期待される内容: エクスポートされた宣言と必要なインポート (今回はなし)
		const expectedContent = "export const myVar = 123;\n"; // 末尾に改行
		expect(newFileContent.trim()).toBe(expectedContent.trim());
	});

	it("内部依存関係 (関数) を持つ VariableDeclaration から新しいファイル内容を生成できる", () => {
		// Arrange
		const code = `
			function helperFunc(n: number): number {
				return n * 2;
			}
			const myVar = helperFunc(10);
		`;
		const { originalSourceFile } = setupProjectWithCode(code);
		const targetSymbolName = "myVar";

		const declarationStatement = findTopLevelDeclarationByName(
			originalSourceFile,
			targetSymbolName,
			SyntaxKind.VariableStatement,
		);
		const dependencies = declarationStatement
			? getInternalDependencies(declarationStatement)
			: [];

		expect(declarationStatement).toBeDefined();
		if (!declarationStatement) return;
		expect(dependencies.length).toBe(1);
		expect(dependencies[0]?.getKind()).toBe(SyntaxKind.FunctionDeclaration);

		// Act
		const newFileContent = generateNewSourceFileContent(
			declarationStatement,
			dependencies,
			originalSourceFile.getFilePath(),
			"/src/newLocation.ts",
		);

		// Assert
		const expectedContent = `
			export function helperFunc(n: number): number {
				return n * 2;
			}

			export const myVar = helperFunc(10);
		`;
		// 前後の空白や改行を正規化して比較
		const normalize = (str: string) => str.replace(/\s+/g, " ").trim();
		expect(normalize(newFileContent)).toBe(normalize(expectedContent));
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
		const newFilePath = "/src/moduleB/newFile.ts"; // 異なるディレクトリに移動

		const declarationStatement = findTopLevelDeclarationByName(
			originalSourceFile,
			targetSymbolName,
			SyntaxKind.VariableStatement,
		);
		// 外部依存は getInternalDependencies では取得されないはず
		const dependencies = declarationStatement
			? getInternalDependencies(declarationStatement)
			: [];

		expect(declarationStatement).toBeDefined();
		if (!declarationStatement) return;
		expect(dependencies).toEqual([]);

		// Act
		const newFileContent = generateNewSourceFileContent(
			declarationStatement,
			dependencies, // 内部依存はなし
			originalSourceFile.getFilePath(),
			newFilePath,
		);

		// Assert
		// 期待: 適切な import 文 (相対パス修正済み) と export された宣言
		const expectedContent = `
			import { externalFunc } from "../moduleA/external";

			export const myVar = externalFunc(99);
		`;
		const normalize = (str: string) => str.replace(/\s+/g, " ").trim();
		expect(normalize(newFileContent)).toBe(normalize(expectedContent));
	});

	// TODO: 他のテストケースを追加
	// - FunctionDeclaration
	// - ClassDeclaration
	// - etc.
	// - 内部依存関係がある場合
	// - 外部依存関係 (import) がある場合
	// - Export されている場合 / されていない場合
});
