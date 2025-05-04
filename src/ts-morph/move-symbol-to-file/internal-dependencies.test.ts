import { describe, it, expect } from "vitest";
import {
	type FunctionDeclaration,
	Project,
	SyntaxKind,
	type VariableStatement,
} from "ts-morph";
import { findTopLevelDeclarationByName } from "./find-declaration";
import { getInternalDependencies } from "./internal-dependencies";
// --- Test Setup Helper ---
const setupProject = () => {
	const project = new Project({
		useInMemoryFileSystem: true,
		compilerOptions: { target: 99, module: 99 },
	});
	project.createDirectory("/src");
	return project;
};

// --- Test Suite ---
describe("getInternalDependencies", () => {
	it("関数宣言が依存する内部関数と内部変数を特定できる", () => {
		// Arrange
		const project = setupProject();
		const filePath = "/src/internal-deps-advanced.ts";
		const sourceFile = project.createSourceFile(
			filePath,
			`
			const configValue = 10;
			const calculatedValue = configValue * 2;
			function helperFunc(n: number): number { return n + calculatedValue; }
			export function mainFunc(x: number): void { const result = helperFunc(x); console.log(result); }
		`,
		);
		const mainFuncDecl = findTopLevelDeclarationByName(
			sourceFile,
			"mainFunc",
			SyntaxKind.FunctionDeclaration,
		) as FunctionDeclaration;
		const helperFuncDecl = findTopLevelDeclarationByName(
			sourceFile,
			"helperFunc",
			SyntaxKind.FunctionDeclaration,
		) as FunctionDeclaration;

		expect(mainFuncDecl, "Test setup failed: mainFunc not found").toBeDefined();
		expect(
			helperFuncDecl,
			"Test setup failed: helperFunc not found",
		).toBeDefined();

		// Act
		const dependencies = getInternalDependencies(mainFuncDecl);

		// Assert
		expect(dependencies).toBeInstanceOf(Array);
		expect(dependencies).toHaveLength(1);
		expect(dependencies[0]).toBe(helperFuncDecl);
	});

	it("関数宣言が依存する内部変数を特定できる (間接依存)", () => {
		// Arrange
		const project = setupProject();
		const filePath = "/src/internal-deps-advanced.ts";
		const sourceFile = project.createSourceFile(
			filePath,
			`
			const configValue = 10;
			const calculatedValue = configValue * 2; // <- 依存先
			function helperFunc(n: number): number { return n + calculatedValue; }
		`,
		);
		const helperFuncDecl = findTopLevelDeclarationByName(
			sourceFile,
			"helperFunc",
			SyntaxKind.FunctionDeclaration,
		) as FunctionDeclaration;
		const calculatedValueStmt = findTopLevelDeclarationByName(
			sourceFile,
			"calculatedValue",
			SyntaxKind.VariableStatement,
		) as VariableStatement;

		expect(
			helperFuncDecl,
			"Test setup failed: helperFunc not found",
		).toBeDefined();
		expect(
			calculatedValueStmt,
			"Test setup failed: calculatedValue not found",
		).toBeDefined();

		// Act
		const dependencies = getInternalDependencies(helperFuncDecl);

		// Assert
		expect(dependencies).toBeInstanceOf(Array);
		expect(dependencies).toHaveLength(1);
		expect(dependencies[0]).toBe(calculatedValueStmt);
	});

	it("変数宣言が依存する内部変数を特定できる", () => {
		// Arrange
		const project = setupProject();
		const filePath = "/src/internal-deps-advanced.ts";
		const sourceFile = project.createSourceFile(
			filePath,
			`
			const configValue = 10; // <- 依存先
			const calculatedValue = configValue * 2;
			export const derivedConst = calculatedValue + 5; // <- これを対象
		`,
		);
		const derivedConstStmt = findTopLevelDeclarationByName(
			sourceFile,
			"derivedConst",
			SyntaxKind.VariableStatement,
		) as VariableStatement;
		const calculatedValueStmt = findTopLevelDeclarationByName(
			sourceFile,
			"calculatedValue",
			SyntaxKind.VariableStatement,
		) as VariableStatement;

		expect(
			derivedConstStmt,
			"Test setup failed: derivedConst not found",
		).toBeDefined();
		expect(
			calculatedValueStmt,
			"Test setup failed: calculatedValue not found",
		).toBeDefined();

		// Act
		const dependencies = getInternalDependencies(derivedConstStmt);

		// Assert
		expect(dependencies).toBeInstanceOf(Array);
		expect(dependencies).toHaveLength(1);
		expect(dependencies[0]).toBe(calculatedValueStmt);
	});

	it("変数宣言が依存する内部変数を特定できる (直接依存)", () => {
		// Arrange
		const project = setupProject();
		const filePath = "/src/internal-deps-advanced.ts";
		const sourceFile = project.createSourceFile(
			filePath,
			`
				const configValue = 10; // <- 依存先
				const calculatedValue = configValue * 2; // <- これを対象
			`,
		);
		const calculatedValueStmt = findTopLevelDeclarationByName(
			sourceFile,
			"calculatedValue",
			SyntaxKind.VariableStatement,
		) as VariableStatement;
		const configValueStmt = findTopLevelDeclarationByName(
			sourceFile,
			"configValue",
			SyntaxKind.VariableStatement,
		) as VariableStatement;

		expect(
			calculatedValueStmt,
			"Test setup failed: calculatedValue not found",
		).toBeDefined();
		expect(
			configValueStmt,
			"Test setup failed: configValue not found",
		).toBeDefined();

		// Act
		const dependencies = getInternalDependencies(calculatedValueStmt);

		// Assert
		expect(dependencies).toBeInstanceOf(Array);
		expect(dependencies).toHaveLength(1);
		expect(dependencies[0]).toBe(configValueStmt);
	});

	it("依存関係がない場合は空配列を返す", () => {
		// Arrange
		const project = setupProject();
		const filePath = "/src/internal-deps-advanced.ts";
		const sourceFile = project.createSourceFile(
			filePath,
			`
			const configValue = 10;
			function unusedFunc() {}
		`,
		);
		const configValueStmt = findTopLevelDeclarationByName(
			sourceFile,
			"configValue",
			SyntaxKind.VariableStatement,
		) as VariableStatement;
		const unusedFuncDecl = findTopLevelDeclarationByName(
			sourceFile,
			"unusedFunc",
			SyntaxKind.FunctionDeclaration,
		) as FunctionDeclaration;

		expect(
			configValueStmt,
			"Test setup failed: configValue not found",
		).toBeDefined();
		expect(
			unusedFuncDecl,
			"Test setup failed: unusedFunc not found",
		).toBeDefined();

		// Act
		const configDeps = getInternalDependencies(configValueStmt);
		const unusedDeps = getInternalDependencies(unusedFuncDecl);

		// Assert
		expect(configDeps).toEqual([]);
		expect(unusedDeps).toEqual([]);
	});

	it("関数宣言が依存する非エクスポートのアロー関数を特定できる", () => {
		// Arrange
		const project = setupProject();
		const filePath = "/src/arrow-func-dep.ts";
		const sourceFile = project.createSourceFile(
			filePath,
			`
			const arrowHelper = (n: number): number => n * n; // ★非エクスポートのアロー関数
			export function consumerFunc(x: number): void {
				console.log(arrowHelper(x));
			}
			`,
		);
		const consumerFuncDecl = findTopLevelDeclarationByName(
			sourceFile,
			"consumerFunc",
			SyntaxKind.FunctionDeclaration,
		) as FunctionDeclaration;
		const arrowHelperStmt = findTopLevelDeclarationByName(
			sourceFile,
			"arrowHelper",
			SyntaxKind.VariableStatement, // アロー関数は VariableStatement として取得されるはず
		) as VariableStatement;

		expect(consumerFuncDecl).toBeDefined();
		expect(arrowHelperStmt).toBeDefined();

		// Act
		const dependencies = getInternalDependencies(consumerFuncDecl);

		// Assert
		expect(dependencies).toHaveLength(1);
		expect(dependencies[0]).toBe(arrowHelperStmt); // アロー関数の VariableStatement を検出できるか
	});
});
