import { describe, it, expect } from "vitest";
import {
	type ClassDeclaration,
	type FunctionDeclaration,
	type InterfaceDeclaration,
	SyntaxKind,
	type TypeAliasDeclaration,
	type SourceFile,
	type VariableStatement,
	type Statement,
} from "ts-morph";
import { createInMemoryProject } from "../_test-utils/create-in-memory-project";
import {
	findTopLevelDeclarationByName,
	getIdentifierFromDeclaration,
} from "./find-declaration";

// --- Test Data ---
const commonTestSource = `
import DefaultIface from './default-iface'; // 無視されるべき

// 通常の宣言
function funcA() {}
const varA = 1;
class ClassA {}
type TypeA = string;
interface IfaceA {}

// エクスポートされた宣言
export function funcB() {}
export const varB = 2;
export class ClassB {}
export type TypeB = number;
export interface IfaceB<T> {} // ジェネリクス付き

// デフォルトエクスポート
export default function defaultFunc() {}
// export default class DefaultClass {} // 同名は不可なのでコメントアウト
// export default const defaultVar = 3; // デフォルトエクスポート変数（あまり一般的ではない）

// 同じ名前の宣言 (種類違い)
const funcC = "hello";
function funcC() {} // 再宣言 (関数が優先されるはず)

// VariableStatement 内の複数宣言
export const multiVar1 = 1, multiVar2 = 2;
`;

// --- Test Data Structure ---
type ExpectedResult = { kind: SyntaxKind; name: string };
type TestCase = [
	string,
	string,
	SyntaxKind | undefined,
	ExpectedResult | undefined,
];

const testCases: TestCase[] = [
	// description, nameToFind, kindToFind, expectedResult { kind, name } or undefined
	[
		"関数 funcB を種類指定で見つける",
		"funcB",
		SyntaxKind.FunctionDeclaration,
		{ kind: SyntaxKind.FunctionDeclaration, name: "funcB" },
	],
	[
		"変数 varB を種類指定で見つける",
		"varB",
		SyntaxKind.VariableStatement,
		{ kind: SyntaxKind.VariableStatement, name: "varB" },
	],
	[
		"クラス ClassB を種類指定で見つける",
		"ClassB",
		SyntaxKind.ClassDeclaration,
		{ kind: SyntaxKind.ClassDeclaration, name: "ClassB" },
	],
	[
		"型 TypeB を種類指定で見つける",
		"TypeB",
		SyntaxKind.TypeAliasDeclaration,
		{ kind: SyntaxKind.TypeAliasDeclaration, name: "TypeB" },
	],
	[
		"インターフェース IfaceB を種類指定で見つける",
		"IfaceB",
		SyntaxKind.InterfaceDeclaration,
		{ kind: SyntaxKind.InterfaceDeclaration, name: "IfaceB" },
	],
	[
		"関数 funcA を種類指定なしで見つける",
		"funcA",
		undefined,
		{ kind: SyntaxKind.FunctionDeclaration, name: "funcA" },
	],
	[
		"変数 varA を種類指定なしで見つける",
		"varA",
		undefined,
		{ kind: SyntaxKind.VariableStatement, name: "varA" },
	],
	[
		"複数宣言の multiVar1 を種類指定で見つける",
		"multiVar1",
		SyntaxKind.VariableStatement,
		{ kind: SyntaxKind.VariableStatement, name: "multiVar1" },
	],
	[
		"複数宣言の multiVar2 を種類指定で見つける",
		"multiVar2",
		SyntaxKind.VariableStatement,
		{ kind: SyntaxKind.VariableStatement, name: "multiVar2" },
	],
	// ["デフォルト関数を 'default' で見つける", "default", SyntaxKind.FunctionDeclaration, { kind: SyntaxKind.FunctionDeclaration, name: "defaultFunc" }], // デフォルト名での検索は一旦保留
	[
		"デフォルト関数を実際の名前(defaultFunc)で見つける",
		"defaultFunc",
		SyntaxKind.FunctionDeclaration,
		{ kind: SyntaxKind.FunctionDeclaration, name: "defaultFunc" },
	],
	[
		"種類が異なる場合 (関数funcBをクラスとして検索)",
		"funcB",
		SyntaxKind.ClassDeclaration,
		undefined,
	],
	["存在しない名前(nonExistent)の場合", "nonExistent", undefined, undefined],
	// ["同名宣言 funcC (関数が優先されるはず)", "funcC", undefined, { kind: SyntaxKind.FunctionDeclaration, name: "funcC" }], // 同名宣言の挙動は実装次第
];

describe("findTopLevelDeclarationByName", () => {
	const setupSourceFile = (content: string): SourceFile => {
		const project = createInMemoryProject();
		const filePath = "/src/test-find.ts";
		return project.createSourceFile(filePath, content);
	};

	const sourceFile = setupSourceFile(commonTestSource);

	it.each<TestCase>(testCases)(
		"%s (name: %s, kind: %s)",
		(description, nameToFind, kindToFind, expectedResult) => {
			const foundDeclaration = findTopLevelDeclarationByName(
				sourceFile,
				nameToFind,
				kindToFind,
			);

			if (expectedResult) {
				// 見つかることを期待する場合
				expect(foundDeclaration).toBeDefined();
				expect(foundDeclaration?.getKind()).toBe(expectedResult.kind);

				// 名前の一致をチェック
				if (expectedResult.kind === SyntaxKind.VariableStatement) {
					// VariableStatement の場合は、指定された名前の VariableDeclaration が含まれるかチェック
					const varDecls = (
						foundDeclaration as VariableStatement
					)?.getDeclarations();
					const specificVarDecl = varDecls?.find(
						(vd) => vd.getName() === expectedResult.name,
					);
					expect(specificVarDecl).toBeDefined();
				} else {
					// Function, Class, Interface, TypeAlias
					// デフォルトエクスポートでgetName()がundefinedになる場合も考慮 (今は実際の名前で検索)
					// ANY TYPE HERE IS INTENTIONAL FOR NOW - will be fixed if test fails
					expect(
						(
							foundDeclaration as
								| FunctionDeclaration
								| ClassDeclaration
								| InterfaceDeclaration
								| TypeAliasDeclaration
						).getName?.(),
					).toBe(expectedResult.name);
				}
			} else {
				// 見つからないことを期待する場合
				expect(foundDeclaration).toBeUndefined();
			}
		},
	);
	// TODO: デフォルトエクスポートの 'default' 名検索、同名宣言に関するテストを別途追加
});

describe("getIdentifierFromDeclaration", () => {
	const getFirstStatement = (code: string): Statement | undefined => {
		const project = createInMemoryProject();
		const sourceFile = project.createSourceFile("test.ts", code);
		return sourceFile.getStatements()[0];
	};

	type FirstStatementCase = {
		description: string;
		code: string;
		expected: string | undefined;
	};

	it.each<FirstStatementCase>([
		{
			description: "FunctionDeclaration",
			code: "function myFunction() {}",
			expected: "myFunction",
		},
		{
			description: "ClassDeclaration",
			code: "class MyClass {}",
			expected: "MyClass",
		},
		{
			description: "InterfaceDeclaration",
			code: "interface MyInterface {}",
			expected: "MyInterface",
		},
		{
			description: "TypeAliasDeclaration",
			code: "type MyType = string;",
			expected: "MyType",
		},
		{
			description: "EnumDeclaration",
			code: "enum MyEnum { A, B }",
			expected: "MyEnum",
		},
		{
			description: "VariableStatement (const)",
			code: "const myVar = 10;",
			expected: "myVar",
		},
		{
			description: "VariableStatement (複数宣言、最初の識別子)",
			code: "let var1 = 1, var2 = 2;",
			expected: "var1",
		},
		{
			description: "export された FunctionDeclaration",
			code: "export function myFunction() {}",
			expected: "myFunction",
		},
		{
			description: "export default 名前付き FunctionDeclaration",
			code: "export default function myFunction() {}",
			expected: "myFunction",
		},
		{
			description: "export default 匿名 FunctionDeclaration (識別子なし)",
			code: "export default function() {}",
			expected: undefined,
		},
		{
			description: "ExportAssignment (オブジェクトリテラル、識別子なし)",
			code: "export default { a: 1 };",
			expected: undefined,
		},
		{
			description: "サポート外 (ImportDeclaration)",
			code: "import { x } from './other';",
			expected: undefined,
		},
	])("$description の場合は $expected を返す", ({ code, expected }) => {
		const identifier = getIdentifierFromDeclaration(getFirstStatement(code));
		expect(identifier?.getText()).toBe(expected);
	});

	it("ExportAssignment (識別子) の識別子を返す", () => {
		const project = createInMemoryProject();
		const sourceFile = project.createSourceFile(
			"test.ts",
			"const foo = 1;\nexport default foo;",
		);
		const exportAssignment = sourceFile.getStatements()[1];
		expect(getIdentifierFromDeclaration(exportAssignment)?.getText()).toBe(
			"foo",
		);
	});

	it("undefined が入力された場合は undefined を返す", () => {
		expect(getIdentifierFromDeclaration(undefined)).toBeUndefined();
	});
});
