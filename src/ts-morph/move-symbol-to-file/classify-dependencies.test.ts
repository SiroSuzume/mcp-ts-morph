import { describe, it, expect } from "vitest";
import { Project, SyntaxKind } from "ts-morph";
import { findTopLevelDeclarationByName } from "./find-declaration";
import { getInternalDependencies } from "./internal-dependencies";
import type { DependencyClassification } from "../types";
// classifyDependencies はまだ存在しないが、テスト対象として import
import { classifyDependencies } from "./classify-dependencies";

// テスト用ヘルパー: コードからプロジェクトと主要要素を取得
const setupTest = (
	code: string,
	targetSymbolName: string,
	targetKind: SyntaxKind,
) => {
	const project = new Project({ useInMemoryFileSystem: true });
	const sourceFile = project.createSourceFile("/src/module.ts", code);
	const targetDeclaration = findTopLevelDeclarationByName(
		sourceFile,
		targetSymbolName,
		targetKind,
	);
	const internalDependencies = targetDeclaration
		? getInternalDependencies(targetDeclaration)
		: [];

	if (!targetDeclaration) {
		throw new Error(`Target symbol '${targetSymbolName}' not found.`);
	}

	return { project, sourceFile, targetDeclaration, internalDependencies };
};

describe("classifyDependencies", () => {
	it("exportされておらず、移動対象からのみ参照される依存は moveToNewFile に分類される", () => {
		// Arrange
		const code = `
			function helper() { return 1; }
			export const main = () => helper();
		`;
		const { targetDeclaration, internalDependencies } = setupTest(
			code,
			"main",
			SyntaxKind.VariableStatement,
		);

		expect(internalDependencies.length).toBe(1);
		const helperDep = internalDependencies[0];
		expect(helperDep).toBeDefined();
		if (!helperDep) return;
		expect(helperDep.getKind()).toBe(SyntaxKind.FunctionDeclaration);

		// Act
		const classified = classifyDependencies(
			targetDeclaration,
			internalDependencies,
		);

		// Assert
		expect(classified).toEqual<DependencyClassification[]>([
			{ type: "moveToNewFile", statement: helperDep },
		]);
	});

	it("exportされており、移動対象から参照される依存は importFromOriginal に分類される", () => {
		// Arrange
		const code = `
			export function sharedHelper() { return 2; } // export されている
			export const main = () => sharedHelper();
			// 他の参照があってもなくても export されていれば B' 扱い
		`;
		const { targetDeclaration, internalDependencies } = setupTest(
			code,
			"main",
			SyntaxKind.VariableStatement,
		);

		expect(internalDependencies.length).toBe(1);
		const sharedHelperDep = internalDependencies[0];
		expect(sharedHelperDep).toBeDefined();
		if (!sharedHelperDep) return;
		expect(sharedHelperDep.getKind()).toBe(SyntaxKind.FunctionDeclaration);

		// Act
		const classified = classifyDependencies(
			targetDeclaration,
			internalDependencies,
		);

		// Assert
		expect(classified).toEqual<DependencyClassification[]>([
			{
				type: "importFromOriginal",
				statement: sharedHelperDep,
				name: "sharedHelper",
			},
		]);
	});

	it("exportされておらず、移動対象以外からも参照される依存は addExport に分類される", () => {
		// Arrange
		const code = `
			function util() { return 3; } // export されていない
			export const main = () => util();
			export const another = () => util(); // ★移動対象以外からも参照される
		`;
		const { targetDeclaration, internalDependencies } = setupTest(
			code,
			"main", // main を移動対象とする
			SyntaxKind.VariableStatement,
		);

		expect(internalDependencies.length).toBe(1);
		const utilDep = internalDependencies[0];
		expect(utilDep).toBeDefined();
		if (!utilDep) return;
		expect(utilDep.getKind()).toBe(SyntaxKind.FunctionDeclaration);

		// Act
		const classified = classifyDependencies(
			targetDeclaration,
			internalDependencies,
		);

		// Assert
		expect(classified).toEqual<DependencyClassification[]>([
			// exportされていなくても、他から参照されていれば importFromOriginal
			{ type: "addExport", statement: utilDep, name: "util" },
		]);
	});

	it("内部依存関係がない場合は空配列を返す", () => {
		// Arrange
		const code = "export const main = 123;";
		const { targetDeclaration, internalDependencies } = setupTest(
			code,
			"main",
			SyntaxKind.VariableStatement,
		);

		expect(internalDependencies.length).toBe(0);

		// Act
		const classified = classifyDependencies(
			targetDeclaration,
			internalDependencies,
		);

		// Assert
		expect(classified).toEqual([]);
	});

	it("複数の依存関係が混在する場合、それぞれ正しく分類される", () => {
		// Arrange
		const code = `
			function privateHelper() { return 'A'; } // Case A: main からのみ参照
			export function sharedExportedHelper() { return 'B'; } // Case B': export 済み
			function sharedNonExportedUtil() { return 'C'; } // Case B'': main と another から参照

			export const main = () => {
				return privateHelper() + sharedExportedHelper() + sharedNonExportedUtil();
			};

			export const another = () => {
				// sharedExportedHelper も参照
				return sharedExportedHelper() + sharedNonExportedUtil();
			};
		`;
		const { project, sourceFile, targetDeclaration, internalDependencies } =
			setupTest(code, "main", SyntaxKind.VariableStatement);

		// 依存関係のStatementを取得 (名前で検索)
		const privateHelperDep = findTopLevelDeclarationByName(
			sourceFile,
			"privateHelper",
			SyntaxKind.FunctionDeclaration,
		);
		const sharedExportedDep = findTopLevelDeclarationByName(
			sourceFile,
			"sharedExportedHelper",
			SyntaxKind.FunctionDeclaration,
		);
		const sharedNonExportedDep = findTopLevelDeclarationByName(
			sourceFile,
			"sharedNonExportedUtil",
			SyntaxKind.FunctionDeclaration,
		);

		expect(internalDependencies.length).toBe(3);
		expect(privateHelperDep).toBeDefined();
		expect(sharedExportedDep).toBeDefined();
		expect(sharedNonExportedDep).toBeDefined();
		if (!privateHelperDep || !sharedExportedDep || !sharedNonExportedDep)
			return;

		// Act
		const classified = classifyDependencies(
			targetDeclaration,
			internalDependencies,
		);

		// Assert
		// 順序は不定なので、内容が一致するか確認
		expect(classified).toHaveLength(3);
		expect(classified).toEqual(
			expect.arrayContaining<DependencyClassification>([
				{ type: "moveToNewFile", statement: privateHelperDep },
				{
					type: "importFromOriginal",
					statement: sharedExportedDep,
					name: "sharedExportedHelper",
				},
				{
					type: "addExport",
					statement: sharedNonExportedDep,
					name: "sharedNonExportedUtil",
				},
			]),
		);
	});
});
