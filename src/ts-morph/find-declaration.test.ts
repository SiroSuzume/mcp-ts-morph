import { describe, it, expect } from "vitest";
import {
	type ClassDeclaration,
	type FunctionDeclaration,
	type InterfaceDeclaration,
	Project,
	SyntaxKind,
	type TypeAliasDeclaration,
	type SourceFile,
	type VariableStatement,
	type Statement,
} from "ts-morph";
import { findTopLevelDeclarationByName } from "./find-declaration"; // これから作る
import { getIdentifierFromDeclaration } from "./find-declaration";
// import { getTopLevelDeclarationsFromFile } from './move-symbol'; // 不要

// --- Test Setup Helper ---
const setupProject = () => {
	const project = new Project({
		useInMemoryFileSystem: true,
		compilerOptions: { target: 99, module: 99 },
	});
	project.createDirectory("/src");
	return project;
};

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

// --- Test Suite ---
describe("findTopLevelDeclarationByName", () => {
	const setupSourceFile = (content: string): SourceFile => {
		const project = setupProject();
		const filePath = "/src/test-find.ts";
		return project.createSourceFile(filePath, content);
	};

	const sourceFile = setupSourceFile(commonTestSource); // 事前に SourceFile を作成

	it.each<TestCase>(testCases)(
		"%s (name: %s, kind: %s)",
		(description, nameToFind, kindToFind, expectedResult) => {
			// Act
			const foundDeclaration = findTopLevelDeclarationByName(
				sourceFile,
				nameToFind,
				kindToFind,
			);

			// Assert
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
	// Helper to create a project and get the first statement
	const getFirstStatement = (code: string): Statement | undefined => {
		const project = new Project({ useInMemoryFileSystem: true });
		const sourceFile = project.createSourceFile("test.ts", code);
		return sourceFile.getStatements()[0];
	};

	it("FunctionDeclaration の識別子を返すこと", () => {
		const statement = getFirstStatement("function myFunction() {}");
		const identifier = getIdentifierFromDeclaration(statement);
		expect(identifier?.getText()).toBe("myFunction");
	});

	it("ClassDeclaration の識別子を返すこと", () => {
		const statement = getFirstStatement("class MyClass {}");
		const identifier = getIdentifierFromDeclaration(statement);
		expect(identifier?.getText()).toBe("MyClass");
	});

	it("InterfaceDeclaration の識別子を返すこと", () => {
		const statement = getFirstStatement("interface MyInterface {}");
		const identifier = getIdentifierFromDeclaration(statement);
		expect(identifier?.getText()).toBe("MyInterface");
	});

	it("TypeAliasDeclaration の識別子を返すこと", () => {
		const statement = getFirstStatement("type MyType = string;");
		const identifier = getIdentifierFromDeclaration(statement);
		expect(identifier?.getText()).toBe("MyType");
	});

	it("EnumDeclaration の識別子を返すこと", () => {
		const statement = getFirstStatement("enum MyEnum { A, B }");
		const identifier = getIdentifierFromDeclaration(statement);
		expect(identifier?.getText()).toBe("MyEnum");
	});

	it("VariableStatement (const) の識別子を返すこと", () => {
		const statement = getFirstStatement("const myVar = 10;");
		const identifier = getIdentifierFromDeclaration(statement);
		expect(identifier?.getText()).toBe("myVar");
	});

	it("VariableStatement (複数宣言) の最初の識別子を返すこと", () => {
		const statement = getFirstStatement("let var1 = 1, var2 = 2;");
		const identifier = getIdentifierFromDeclaration(statement);
		expect(identifier?.getText()).toBe("var1"); // 最初の宣言の識別子を返す仕様
	});

	it("エクスポートされた FunctionDeclaration の識別子を返すこと", () => {
		const statement = getFirstStatement("export function myFunction() {}");
		const identifier = getIdentifierFromDeclaration(statement);
		expect(identifier?.getText()).toBe("myFunction");
	});

	it("デフォルトエクスポートされた名前付き FunctionDeclaration の識別子を返すこと", () => {
		const statement = getFirstStatement(
			"export default function myFunction() {}",
		);
		const identifier = getIdentifierFromDeclaration(statement);
		expect(identifier?.getText()).toBe("myFunction");
	});

	it("デフォルトエクスポートされた匿名 FunctionDeclaration では undefined を返すこと", () => {
		const statement = getFirstStatement("export default function() {}");
		const identifier = getIdentifierFromDeclaration(statement);
		expect(identifier).toBeUndefined(); // 匿名なので名前がない
	});

	it("ExportAssignment (識別子) の識別子を返すこと", () => {
		const code = "const foo = 1;\nexport default foo;";
		const project = new Project({ useInMemoryFileSystem: true });
		const sourceFile = project.createSourceFile("test.ts", code);
		const statement = sourceFile.getStatements()[1]; // ExportAssignment を取得
		const identifier = getIdentifierFromDeclaration(statement);
		expect(identifier?.getText()).toBe("foo");
	});

	it("ExportAssignment (非識別子) では undefined を返すこと", () => {
		const statement = getFirstStatement("export default { a: 1 };");
		const identifier = getIdentifierFromDeclaration(statement);
		expect(identifier).toBeUndefined();
	});

	it("サポート外の Statement (ImportDeclarationなど) では undefined を返すこと", () => {
		const statement = getFirstStatement("import { x } from './other';");
		const identifier = getIdentifierFromDeclaration(statement);
		expect(identifier).toBeUndefined();
	});

	it("undefined が入力された場合は undefined を返すこと", () => {
		const identifier = getIdentifierFromDeclaration(undefined);
		expect(identifier).toBeUndefined();
	});
});
