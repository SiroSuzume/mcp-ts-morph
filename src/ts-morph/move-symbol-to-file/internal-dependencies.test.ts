import { describe, it, expect } from "vitest";
import { type SourceFile, SyntaxKind } from "ts-morph";
import { createInMemoryProject } from "../_test-utils/create-in-memory-project";
import { getStatement } from "../_test-utils/get-statement";
import { getInternalDependencies } from "./internal-dependencies";

const fnDecl = (sourceFile: SourceFile, name: string) =>
	getStatement(sourceFile, name, SyntaxKind.FunctionDeclaration);

const varStmt = (sourceFile: SourceFile, name: string) =>
	getStatement(sourceFile, name, SyntaxKind.VariableStatement);

describe("getInternalDependencies", () => {
	it("関数宣言が依存する内部関数と内部変数を特定できる", () => {
		const project = createInMemoryProject();
		const sourceFile = project.createSourceFile(
			"/src/test.ts",
			`
			const configValue = 10;
			const calculatedValue = configValue * 2;
			function helperFunc(n: number): number { return n + calculatedValue; }
			export function mainFunc(x: number): void { const result = helperFunc(x); console.log(result); }
		`,
		);

		const dependencies = getInternalDependencies(
			fnDecl(sourceFile, "mainFunc"),
		);

		expect(dependencies).toEqual(
			expect.arrayContaining([
				fnDecl(sourceFile, "helperFunc"),
				varStmt(sourceFile, "calculatedValue"),
				varStmt(sourceFile, "configValue"),
			]),
		);
		expect(dependencies).toHaveLength(3);
	});

	it("関数宣言が依存する内部変数を特定できる (間接依存)", () => {
		const project = createInMemoryProject();
		const sourceFile = project.createSourceFile(
			"/src/test.ts",
			`
			const configValue = 10;
			const calculatedValue = configValue * 2;
			function helperFunc(n: number): number { return n + calculatedValue; }
		`,
		);

		const dependencies = getInternalDependencies(
			fnDecl(sourceFile, "helperFunc"),
		);

		expect(dependencies).toEqual(
			expect.arrayContaining([
				varStmt(sourceFile, "calculatedValue"),
				varStmt(sourceFile, "configValue"),
			]),
		);
		expect(dependencies).toHaveLength(2);
	});

	it("変数宣言が依存する内部変数を特定できる", () => {
		const project = createInMemoryProject();
		const sourceFile = project.createSourceFile(
			"/src/test.ts",
			`
			const configValue = 10;
			const calculatedValue = configValue * 2;
			export const derivedConst = calculatedValue + 5;
		`,
		);

		const dependencies = getInternalDependencies(
			varStmt(sourceFile, "derivedConst"),
		);

		expect(dependencies).toEqual(
			expect.arrayContaining([
				varStmt(sourceFile, "calculatedValue"),
				varStmt(sourceFile, "configValue"),
			]),
		);
		expect(dependencies).toHaveLength(2);
	});

	it("変数宣言が依存する内部変数を特定できる (直接依存)", () => {
		const project = createInMemoryProject();
		const sourceFile = project.createSourceFile(
			"/src/test.ts",
			`
			const configValue = 10;
			const calculatedValue = configValue * 2;
		`,
		);

		const configValueStmt = varStmt(sourceFile, "configValue");
		const dependencies = getInternalDependencies(
			varStmt(sourceFile, "calculatedValue"),
		);

		expect(dependencies).toHaveLength(1);
		expect(dependencies[0]).toBe(configValueStmt);
	});

	it("依存関係がない場合は空配列を返す", () => {
		const project = createInMemoryProject();
		const sourceFile = project.createSourceFile(
			"/src/test.ts",
			`
			const configValue = 10;
			function unusedFunc() {}
		`,
		);

		expect(getInternalDependencies(varStmt(sourceFile, "configValue"))).toEqual(
			[],
		);
		expect(getInternalDependencies(fnDecl(sourceFile, "unusedFunc"))).toEqual(
			[],
		);
	});

	it("関数宣言が依存する非エクスポートのアロー関数を特定できる", () => {
		const project = createInMemoryProject();
		const sourceFile = project.createSourceFile(
			"/src/test.ts",
			`
			const arrowHelper = (n: number): number => n * n;
			export function mainFunc(x: number): number { return arrowHelper(x); }
		`,
		);

		const dependencies = getInternalDependencies(
			fnDecl(sourceFile, "mainFunc"),
		);

		expect(dependencies).toEqual([varStmt(sourceFile, "arrowHelper")]);
	});

	it("複数の間接的な内部依存関係を再帰的に特定できる", () => {
		const project = createInMemoryProject();
		const sourceFile = project.createSourceFile(
			"/src/test.ts",
			`
			const d = 4;
			const c = () => d;
			const b = () => c();
			export const a = () => b(); // a -> b -> c -> d
			const e = () => d; // d は a 以外からも参照されるが、ここでは a の依存のみ見る
		`,
		);

		const dependencies = getInternalDependencies(varStmt(sourceFile, "a"));

		expect(dependencies).toEqual(
			expect.arrayContaining([
				varStmt(sourceFile, "b"),
				varStmt(sourceFile, "c"),
				varStmt(sourceFile, "d"),
			]),
		);
		expect(dependencies).toHaveLength(3);
	});
});
