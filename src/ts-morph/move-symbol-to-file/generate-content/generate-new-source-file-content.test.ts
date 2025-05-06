import { describe, it, expect } from "vitest";
import { Project, SyntaxKind, ts } from "ts-morph";
import { findTopLevelDeclarationByName } from "../find-declaration";
import { generateNewSourceFileContent } from "./generate-new-source-file-content";
import type {
	DependencyClassification,
	NeededExternalImports,
} from "../../types";

// テストプロジェクト設定用ヘルパー
const setupProjectWithCode = (
	code: string,
	filePath = "/src/original.ts",
	project?: Project,
) => {
	const proj = project ?? new Project({ useInMemoryFileSystem: true });
	proj.compilerOptions.set({ jsx: ts.JsxEmit.ReactJSX });
	const originalSourceFile = proj.createSourceFile(filePath, code);
	return { project: proj, originalSourceFile };
};

describe("generateNewSourceFileContent", () => {
	it("依存関係のない VariableDeclaration から新しいファイルの内容を生成できる", () => {
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

		const classifiedDependencies: DependencyClassification[] = [];
		const neededExternalImports: NeededExternalImports = new Map();

		const newFileContent = generateNewSourceFileContent(
			declarationStatement,
			classifiedDependencies,
			originalSourceFile.getFilePath(),
			"/src/newLocation.ts",
			neededExternalImports,
		);

		const expectedContent = "export const myVar = 123;\n";
		expect(newFileContent.trim()).toBe(expectedContent.trim());
	});

	it("内部依存関係 (moveToNewFile) を持つ VariableDeclaration から新しいファイル内容を生成できる", () => {
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

		const classifiedDependencies: DependencyClassification[] = [
			{ type: "moveToNewFile", statement: dependencyStatement },
		];
		const neededExternalImports: NeededExternalImports = new Map();

		const newFileContent = generateNewSourceFileContent(
			declarationStatement,
			classifiedDependencies,
			originalSourceFile.getFilePath(),
			"/src/newLocation.ts",
			neededExternalImports,
		);

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

		const classifiedDependencies: DependencyClassification[] = [];
		const neededExternalImports: NeededExternalImports = new Map();
		const importDecl = originalSourceFile.getImportDeclaration("./external");
		expect(importDecl).toBeDefined();
		if (importDecl) {
			const moduleSourceFile = importDecl.getModuleSpecifierSourceFile();
			const key = moduleSourceFile
				? moduleSourceFile.getFilePath()
				: importDecl.getModuleSpecifierValue();
			neededExternalImports.set(key, {
				names: new Set(["externalFunc"]),
				declaration: importDecl,
			});
		}

		const newFileContent = generateNewSourceFileContent(
			declarationStatement,
			classifiedDependencies,
			originalSourceFile.getFilePath(),
			newFilePath,
			neededExternalImports,
		);

		const expectedContent = `
import { externalFunc } from "../moduleA/external";
export const myVar = externalFunc(99);
		`.trim();
		const normalize = (str: string) => str.replace(/\s+/g, " ").trim();
		expect(normalize(newFileContent)).toBe(normalize(expectedContent));
	});

	it("node_modulesからの外部依存を持つシンボルを移動する際、インポートパスが維持される", () => {
		const originalCode = `
import { useState } from 'react';

const CounterComponent = () => {
  const [count, setCount] = useState(0);
  return \`Count: \${count}\`;
};
`;
		const originalFilePath = "/src/components/Counter.tsx";
		const newFilePath = "/src/features/NewCounter.tsx";
		const targetSymbolName = "CounterComponent";

		const { project, originalSourceFile } = setupProjectWithCode(
			originalCode,
			originalFilePath,
		);

		const declarationStatement = findTopLevelDeclarationByName(
			originalSourceFile,
			targetSymbolName,
			SyntaxKind.VariableStatement,
		);
		expect(declarationStatement).toBeDefined();
		if (!declarationStatement) return;

		const neededExternalImports: NeededExternalImports = new Map();
		const reactImportDecl = originalSourceFile.getImportDeclaration("react");
		expect(reactImportDecl).toBeDefined();
		if (reactImportDecl) {
			expect(reactImportDecl.getModuleSpecifierSourceFile()).toBeUndefined();
			const key = reactImportDecl.getModuleSpecifierValue();
			neededExternalImports.set(key, {
				names: new Set(["useState"]),
				declaration: reactImportDecl,
			});
		}

		const classifiedDependencies: DependencyClassification[] = [];

		const newFileContent = generateNewSourceFileContent(
			declarationStatement,
			classifiedDependencies,
			originalFilePath,
			newFilePath,
			neededExternalImports,
		);

		const expectedImportStatement = 'import { useState } from "react";';
		const expectedContent = `
import { useState } from "react";

export const CounterComponent = () => {
  const [count, setCount] = useState(0);
  return \`Count: \${count}\`;
};
  `.trim();
		const normalize = (str: string) => str.replace(/\s+/g, " ").trim();

		expect(newFileContent.trim()).toContain(expectedImportStatement);

		expect(newFileContent).not.toContain("node_modules/react");
		expect(newFileContent).not.toContain("../");

		expect(normalize(newFileContent)).toBe(normalize(expectedContent));
	});

	it("名前空間インポート (import * as) を持つシンボルから新しいファイル内容を生成できる", () => {
		const originalCode = `
import * as path from 'node:path';

const resolveFullPath = (dir: string, file: string): string => {
  return path.resolve(dir, file);
};
`;
		const originalFilePath = "/src/utils/pathHelper.ts";
		const newFilePath = "/src/core/newPathHelper.ts";
		const targetSymbolName = "resolveFullPath";

		const { project, originalSourceFile } = setupProjectWithCode(
			originalCode,
			originalFilePath,
		);

		const declarationStatement = findTopLevelDeclarationByName(
			originalSourceFile,
			targetSymbolName,
			SyntaxKind.VariableStatement,
		);
		expect(declarationStatement).toBeDefined();
		if (!declarationStatement) return;

		const neededExternalImports: NeededExternalImports = new Map();
		const pathImportDecl = originalSourceFile.getImportDeclaration("node:path");
		expect(pathImportDecl).toBeDefined();
		if (pathImportDecl) {
			const key = pathImportDecl.getModuleSpecifierValue();
			neededExternalImports.set(key, {
				names: new Set(),
				declaration: pathImportDecl,
				isNamespaceImport: true,
				namespaceImportName: "path",
			});
		}

		const classifiedDependencies: DependencyClassification[] = [];

		const newFileContent = generateNewSourceFileContent(
			declarationStatement,
			classifiedDependencies,
			originalFilePath,
			newFilePath,
			neededExternalImports,
		);

		const expectedImportStatement = 'import * as path from "node:path";';
		const expectedContent = `
${expectedImportStatement}

export const resolveFullPath = (dir: string, file: string): string => {
  return path.resolve(dir, file);
};
  `.trim();
		const normalize = (str: string) => str.replace(/\s+/g, " ").trim();

		expect(newFileContent.trim()).toContain(expectedImportStatement);
		expect(normalize(newFileContent)).toBe(normalize(expectedContent));
	});

	it("デフォルトインポートに依存するシンボルから新しいファイル内容を生成できる", () => {
		const loggerCode = `
			export default function logger(message: string) {
				console.log(message);
			}
		`;
		const originalCode = `
			import myLogger from './logger';

			function functionThatUsesLogger(msg: string) {
				myLogger(\`LOG: \${msg}\`);
			}
		`;
		const originalFilePath = "/src/module/main.ts";
		const loggerFilePath = "/src/module/logger.ts";
		const newFilePath = "/src/feature/newLoggerUser.ts";
		const targetSymbolName = "functionThatUsesLogger";

		const { project, originalSourceFile } = setupProjectWithCode(
			originalCode,
			originalFilePath,
		);
		project.createSourceFile(loggerFilePath, loggerCode);

		// 移動対象の宣言を取得
		const declarationStatement = findTopLevelDeclarationByName(
			originalSourceFile,
			targetSymbolName,
			SyntaxKind.FunctionDeclaration,
		);
		expect(declarationStatement).toBeDefined();
		if (!declarationStatement) return;

		// 必要な外部インポート情報を手動で設定 (デフォルトインポート)
		const neededExternalImports: NeededExternalImports = new Map();
		const loggerImportDecl =
			originalSourceFile.getImportDeclaration("./logger");
		expect(loggerImportDecl).toBeDefined();
		if (loggerImportDecl) {
			const moduleSourceFile = loggerImportDecl.getModuleSpecifierSourceFile();
			expect(moduleSourceFile).toBeDefined();
			if (moduleSourceFile) {
				const key = moduleSourceFile.getFilePath();
				neededExternalImports.set(key, {
					names: new Set(["default"]),
					declaration: loggerImportDecl,
				});
			}
		}

		const classifiedDependencies: DependencyClassification[] = [];

		const newFileContent = generateNewSourceFileContent(
			declarationStatement,
			classifiedDependencies,
			originalFilePath,
			newFilePath,
			neededExternalImports,
		);

		const expectedImportStatement = 'import myLogger from "../module/logger";';
		const incorrectImport1 = 'import { default } from "../module/logger";';
		const incorrectImport2 =
			'import { default as myLogger } from "../module/logger";';

		expect(newFileContent).not.toContain(incorrectImport1);
		expect(newFileContent).not.toContain(incorrectImport2);

		expect(newFileContent).toContain(expectedImportStatement);

		expect(newFileContent).toContain("export function functionThatUsesLogger");
	});
});
