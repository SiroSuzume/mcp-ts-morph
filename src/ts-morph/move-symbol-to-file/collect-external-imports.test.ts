import { describe, it, expect } from "vitest";
import { Project, SyntaxKind, type Statement } from "ts-morph";
import { findTopLevelDeclarationByName } from "./find-declaration";
import { collectNeededExternalImports } from "./collect-external-imports";

// テスト用ヘルパー
const setupTest = (
	code: string,
	targetSymbolNames: string[],
	targetKind: SyntaxKind = SyntaxKind.VariableStatement,
) => {
	const project = new Project({ useInMemoryFileSystem: true });
	const sourceFile = project.createSourceFile("/src/module.ts", code);
	const targetStatements: Statement[] = [];
	for (const name of targetSymbolNames) {
		const stmt = findTopLevelDeclarationByName(sourceFile, name, targetKind);
		if (stmt) {
			targetStatements.push(stmt);
		} else {
			throw new Error(`Target symbol '${name}' not found.`);
		}
	}
	return { project, sourceFile, targetStatements };
};

describe("collectNeededExternalImports", () => {
	it("名前付きインポートを使用するステートメントからインポート情報を収集できる", () => {
		const code = `
			import { utilA, utilB } from './utils';
			export const func1 = () => utilA();
			export const func2 = () => utilB() + 1;
		`;
		const { sourceFile, targetStatements } = setupTest(code, [
			"func1",
			"func2",
		]);

		const neededImports = collectNeededExternalImports(
			targetStatements,
			sourceFile,
		);

		expect(neededImports.size).toBe(1);
		const utilsImport = neededImports.get("./utils");
		expect(utilsImport).toBeDefined();
		expect(utilsImport?.names).toEqual(new Set(["utilA", "utilB"]));
		// declaration のチェックはここでは省略（実装で確認）
	});

	it("デフォルトインポートを使用するステートメントからインポート情報を収集できる", () => {
		const code = `
			import myDefaultUtil from '../defaultUtils';
			export const processor = () => myDefaultUtil.process();
		`;
		const { sourceFile, targetStatements } = setupTest(code, ["processor"]);

		const neededImports = collectNeededExternalImports(
			targetStatements,
			sourceFile,
		);

		expect(neededImports.size).toBe(1);
		const defaultImport = neededImports.get("../defaultUtils");
		expect(defaultImport).toBeDefined();
		// デフォルトインポートは特別な名前 'default' で収集されることを期待
		expect(defaultImport?.names).toEqual(new Set(["default"]));
	});

	it("エイリアス付きインポートを使用するステートメントからインポート情報を収集できる", () => {
		const code = `
			import { originalName as aliasName } from '@/lib/core';
			export const taskRunner = () => aliasName.run();
		`;
		const { sourceFile, targetStatements } = setupTest(code, ["taskRunner"]);

		const neededImports = collectNeededExternalImports(
			targetStatements,
			sourceFile,
		);

		expect(neededImports.size).toBe(1);
		const coreImport = neededImports.get("@/lib/core");
		expect(coreImport).toBeDefined();
		// エイリアス名で収集されることを期待
		expect(coreImport?.names).toEqual(new Set(["aliasName"]));
	});

	it("外部インポートを使用しないステートメントからは何も収集されない", () => {
		const code = `
			const localVar = 10;
			export const simpleFunc = () => localVar * 2;
		`;
		const { sourceFile, targetStatements } = setupTest(code, ["simpleFunc"]);

		const neededImports = collectNeededExternalImports(
			targetStatements,
			sourceFile,
		);

		expect(neededImports.size).toBe(0);
	});

	it("複数のインポート（名前付き、デフォルト、エイリアス）が混在する場合も正しく収集できる", () => {
		const code = `
			import defaultUtil from './default';
			import { utilA } from './utils';
			import { oldFunc as newFunc } from '@/legacy';

			export const complexTask = () => {
				const resA = utilA();
				const resB = defaultUtil(resA);
				return newFunc(resB);
			};
		`;
		const { sourceFile, targetStatements } = setupTest(code, ["complexTask"]);

		const neededImports = collectNeededExternalImports(
			targetStatements,
			sourceFile,
		);

		expect(neededImports.size).toBe(3);

		// デフォルトインポートの確認
		const defaultImport = neededImports.get("./default");
		expect(defaultImport?.names).toEqual(new Set(["default"]));

		// 名前付きインポートの確認
		const utilsImport = neededImports.get("./utils");
		expect(utilsImport?.names).toEqual(new Set(["utilA"]));

		// エイリアス付きインポートの確認
		const legacyImport = neededImports.get("@/legacy");
		expect(legacyImport?.names).toEqual(new Set(["newFunc"])); // エイリアス名
	});

	it("名前空間インポート (import * as) を使用するステートメントからインポート情報を収集できる", () => {
		const code = `
			import * as path from 'node:path';
			export const resolvePath = (dir: string, file: string) => {
				return path.resolve(dir, file);
			};
		`;
		const { sourceFile, targetStatements } = setupTest(code, ["resolvePath"]);

		const neededImports = collectNeededExternalImports(
			targetStatements,
			sourceFile,
		);

		expect(neededImports.size).toBe(1);
		const pathImport = neededImports.get("node:path");
		expect(pathImport).toBeDefined();
		// 名前空間インポートは namespaceImportName プロパティで名前を収集することを期待
		expect(pathImport?.isNamespaceImport).toBe(true);
		expect(pathImport?.namespaceImportName).toBe("path");
		expect(pathImport?.names).toEqual(new Set()); // names セットは空のはず
	});
});
