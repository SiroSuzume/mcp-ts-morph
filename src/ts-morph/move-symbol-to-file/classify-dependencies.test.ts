import { describe, it, expect } from "vitest";
import { type FunctionDeclaration, SyntaxKind } from "ts-morph";
import { createInMemoryProject } from "../_test-utils/create-in-memory-project";
import { getStatement } from "../_test-utils/get-statement";
import { getInternalDependencies } from "./internal-dependencies";
import type { DependencyClassification } from "../types";
import { classifyDependencies } from "./classify-dependencies";

const setupTest = (
	code: string,
	targetSymbolName: string,
	targetKind: SyntaxKind,
) => {
	const project = createInMemoryProject();
	const sourceFile = project.createSourceFile("/src/module.ts", code);
	const targetDeclaration = getStatement(
		sourceFile,
		targetSymbolName,
		targetKind,
	);
	const internalDependencies = getInternalDependencies(targetDeclaration);
	return { sourceFile, targetDeclaration, internalDependencies };
};

describe("classifyDependencies", () => {
	it("exportされておらず、移動対象からのみ参照される依存は moveToNewFile に分類される", () => {
		const { sourceFile, targetDeclaration, internalDependencies } = setupTest(
			`
				function helper() { return 1; }
				export const main = () => helper();
			`,
			"main",
			SyntaxKind.VariableStatement,
		);

		const helperDep = getStatement<FunctionDeclaration>(
			sourceFile,
			"helper",
			SyntaxKind.FunctionDeclaration,
		);

		expect(
			classifyDependencies(targetDeclaration, internalDependencies),
		).toEqual<DependencyClassification[]>([
			{ type: "moveToNewFile", statement: helperDep },
		]);
	});

	it("exportされており、移動対象から参照される依存は importFromOriginal に分類される", () => {
		const { sourceFile, targetDeclaration, internalDependencies } = setupTest(
			`
				export function sharedHelper() { return 2; }
				export const main = () => sharedHelper();
			`,
			"main",
			SyntaxKind.VariableStatement,
		);

		const sharedHelperDep = getStatement<FunctionDeclaration>(
			sourceFile,
			"sharedHelper",
			SyntaxKind.FunctionDeclaration,
		);

		expect(
			classifyDependencies(targetDeclaration, internalDependencies),
		).toEqual<DependencyClassification[]>([
			{
				type: "importFromOriginal",
				statement: sharedHelperDep,
				name: "sharedHelper",
			},
		]);
	});

	it("exportされておらず、移動対象以外からも参照される依存は addExport に分類される", () => {
		const { sourceFile, targetDeclaration, internalDependencies } = setupTest(
			`
				function util() { return 3; }
				export const main = () => util();
				export const another = () => util();
			`,
			"main",
			SyntaxKind.VariableStatement,
		);

		const utilDep = getStatement<FunctionDeclaration>(
			sourceFile,
			"util",
			SyntaxKind.FunctionDeclaration,
		);

		expect(
			classifyDependencies(targetDeclaration, internalDependencies),
		).toEqual<DependencyClassification[]>([
			{ type: "addExport", statement: utilDep, name: "util" },
		]);
	});

	it("内部依存関係がない場合は空配列を返す", () => {
		const { targetDeclaration, internalDependencies } = setupTest(
			"export const main = 123;",
			"main",
			SyntaxKind.VariableStatement,
		);

		expect(internalDependencies).toHaveLength(0);
		expect(
			classifyDependencies(targetDeclaration, internalDependencies),
		).toEqual([]);
	});

	it("複数の依存関係が混在する場合、それぞれ正しく分類される", () => {
		const { sourceFile, targetDeclaration, internalDependencies } = setupTest(
			`
				function privateHelper() { return 'A'; }
				export function sharedExportedHelper() { return 'B'; }
				function sharedNonExportedUtil() { return 'C'; }

				export const main = () => {
					return privateHelper() + sharedExportedHelper() + sharedNonExportedUtil();
				};

				export const another = () => {
					return sharedExportedHelper() + sharedNonExportedUtil();
				};
			`,
			"main",
			SyntaxKind.VariableStatement,
		);

		const privateHelperDep = getStatement<FunctionDeclaration>(
			sourceFile,
			"privateHelper",
			SyntaxKind.FunctionDeclaration,
		);
		const sharedExportedDep = getStatement<FunctionDeclaration>(
			sourceFile,
			"sharedExportedHelper",
			SyntaxKind.FunctionDeclaration,
		);
		const sharedNonExportedDep = getStatement<FunctionDeclaration>(
			sourceFile,
			"sharedNonExportedUtil",
			SyntaxKind.FunctionDeclaration,
		);

		const classified = classifyDependencies(
			targetDeclaration,
			internalDependencies,
		);

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
		expect(classified).toHaveLength(3);
	});
});
