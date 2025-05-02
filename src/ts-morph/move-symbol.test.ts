import { describe, it, expect } from "vitest";
import {
	Project,
	SyntaxKind,
	type ImportDeclaration,
	type FunctionDeclaration,
	type Statement,
	type VariableStatement,
	type ClassDeclaration,
	type TypeAliasDeclaration,
	type InterfaceDeclaration,
} from "ts-morph";
// import { getDependentImportDeclarations } from './move-symbol'; // これから作る関数
import {
	getDependentImportDeclarations,
	getTopLevelDeclarationsFromFile,
} from "./move-symbol"; // 作成する関数を import

// --- Test Setup Helper ---
const setupProject = () => {
	const project = new Project({
		useInMemoryFileSystem: true,
		compilerOptions: {
			// 必要に応じて設定を追加
			target: 99, // ESNext
			module: 99, // ESNext
			esModuleInterop: true, // import fs from 'node:fs' のために必要
			allowSyntheticDefaultImports: true, // 同上
		},
	});
	project.createDirectory("/src");
	project.createDirectory("/src/utils");
	return project;
};

// --- Test Suite ---
describe("move-symbol", () => {
	describe("getDependentImportDeclarations", () => {
		it("指定した関数宣言が直接使用している識別子に関連する import 文のみを特定できること", () => {
			// Arrange
			const project = setupProject();
			const mathPath = "/src/utils/math.ts";
			const loggerPath = "/src/utils/logger.ts";
			const appPath = "/src/app.ts";

			project.createSourceFile(
				mathPath,
				`
				export const add = (a: number, b: number) => a + b;
				export const subtract = (a: number, b: number) => a - b; // これは使われない
			`,
			);
			project.createSourceFile(
				loggerPath,
				`
				export const logInfo = (message: string) => console.log(\`INFO: \${message}\`);
				export const logError = (message: string) => console.error(\`ERROR: \${message}\`); // これは使われない
			`,
			);
			const appSourceFile = project.createSourceFile(
				appPath,
				`
				import { add } from './utils/math'; // <- 依存 (一部)
				import * as logger from './utils/logger'; // <- 依存 (全部)
				import fs from 'node:fs'; // <- 無関係な import
				import { subtract } from './utils/math'; // <- 依存するが関数内では使わない

				export function calculateAndLog(x: number, y: number) {
					const sum = add(x, y); // 'add' を使用
					logger.logInfo(\`Sum: \${sum}\`); // 'logger' を使用
					// 'subtract' は未使用
					// 'fs' は未使用
					return sum;
				}

				// 移動対象外の関数
				export function justSubtract(a: number, b: number) {
					return subtract(a, b); // ここで subtract を使う
				}
			`,
			);

			// 対象の関数ノードを取得 (FunctionDeclaration を想定)
			const targetFunction =
				appSourceFile.getFunctionOrThrow("calculateAndLog");

			// Act
			const dependentImports = getDependentImportDeclarations(targetFunction);

			// Assert
			expect(dependentImports).toBeInstanceOf(Array);
			expect(dependentImports).toHaveLength(2); // 2つの import 文が特定されるはず

			const moduleSpecifiers = dependentImports.map((decl: ImportDeclaration) =>
				decl.getModuleSpecifierValue(),
			);
			expect(moduleSpecifiers).toContain("./utils/math");
			expect(moduleSpecifiers).toContain("./utils/logger");
			expect(moduleSpecifiers).not.toContain("node:fs");

			// './utils/math' からは 'add' のみが使われている import かどうか (より詳細なチェック、オプション)
			const mathImport = dependentImports.find(
				(d: ImportDeclaration) =>
					d.getModuleSpecifierValue() === "./utils/math",
			);
			expect(mathImport).toBeDefined();
			const namedImports = mathImport
				?.getImportClause()
				?.getNamedBindings()
				?.asKind(SyntaxKind.NamedImports)
				?.getElements();
			// 注意: このテストケースでは './utils/math' から add と subtract の両方が import されているため、
			//       getDependentImportDeclarations の実装によっては subtract も含まれる可能性がある。
			//       まずは import 文レベルでの特定を目指す。
			// expect(namedImports?.map(n => n.getName())).toEqual(['add']); // これは現時点では期待しないかも
		});

		// TODO: 他のテストケース (変数宣言、クラス宣言など)
	});

	describe("getTopLevelDeclarationsFromFile", () => {
		it("ファイル直下に定義されたすべての宣言（関数, 変数, クラス, 型, インターフェース）を取得できること", () => {
			// Arrange
			const project = setupProject();
			const filePath = "/src/test-file.ts";
			const sourceFile = project.createSourceFile(
				filePath,
				`
				import { someUtil } from './utils'; // これは対象外

				export const exportedVar = 1;
				export function exportedFunction() { return 'hello'; }
				export class ExportedClass {}
				export type ExportedType = string;
				export interface ExportedInterface {}

				const internalVar = 2;
				function internalFunction() {}

				export default function defaultFunction() {}

				// ネストされたものは対象外
				function outer() {
					const nestedVar = 3;
					function nestedFunction() {}
				}
			`,
			);

			// Act
			const topLevelDeclarations = getTopLevelDeclarationsFromFile(sourceFile);

			// Assert
			expect(topLevelDeclarations).toBeInstanceOf(Array);
			// 期待される宣言の数を確認 (exported 5 + internal 2 + default 1 + outer 1 = 9)
			expect(topLevelDeclarations).toHaveLength(9);

			const declarationNames = topLevelDeclarations
				.map((decl: Statement) => {
					// 型注釈を追加
					// VariableDeclaration の場合は VariableStatement から名前を取得
					if (decl.getKind() === SyntaxKind.VariableStatement) {
						// VariableStatement は複数の宣言を持つ可能性があるが、ここでは最初のものだけ考慮
						return (decl as VariableStatement).getDeclarations()[0]?.getName();
					}
					// FunctionDeclaration, ClassDeclaration, InterfaceDeclaration, TypeAliasDeclaration
					if (
						decl.getKind() === SyntaxKind.FunctionDeclaration ||
						decl.getKind() === SyntaxKind.ClassDeclaration ||
						decl.getKind() === SyntaxKind.InterfaceDeclaration ||
						decl.getKind() === SyntaxKind.TypeAliasDeclaration
					) {
						// Default Export の関数/クラスは getName() が undefined になる
						if (
							(
								decl as FunctionDeclaration | ClassDeclaration
							).isDefaultExport?.()
						) {
							return "default"; // 仮の名前
						}
						return (
							decl as
								| FunctionDeclaration
								| ClassDeclaration
								| InterfaceDeclaration
								| TypeAliasDeclaration
						).getName?.();
					}
					return undefined; // その他の Statement (Import など) は無視
				})
				.filter((name): name is string => name !== undefined); // 型ガードでフィルタリング

			expect(declarationNames).toContain("exportedVar");
			expect(declarationNames).toContain("exportedFunction");
			expect(declarationNames).toContain("ExportedClass");
			expect(declarationNames).toContain("ExportedType");
			expect(declarationNames).toContain("ExportedInterface");
			expect(declarationNames).toContain("internalVar");
			expect(declarationNames).toContain("internalFunction");
			expect(declarationNames).toContain("default"); // default export の関数
			expect(declarationNames).toContain("outer"); // outer 関数もトップレベルなので含まれる

			// 必要であれば、各宣言の種類 (Kind) もチェックする
			const declarationKinds = topLevelDeclarations.map((d: Statement) =>
				d.getKindName(),
			);
			expect(declarationKinds).toContain("VariableStatement");
			expect(declarationKinds).toContain("FunctionDeclaration"); // exported, internal, default
			expect(declarationKinds).toContain("ClassDeclaration");
			expect(declarationKinds).toContain("TypeAliasDeclaration");
			expect(declarationKinds).toContain("InterfaceDeclaration");
			expect(
				declarationKinds.filter((k: string) => k === "FunctionDeclaration"),
			).toHaveLength(4); // 関数宣言は4つのはず (exported, internal, default, outer)
		});

		// TODO: エッジケースのテスト (空ファイル、import/export のみなど)
	});

	// 他の小機能の describe ブロックもここに追加していく
});
