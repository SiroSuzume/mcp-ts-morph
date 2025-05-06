import { Project, Node } from "ts-morph";
import { describe, it, expect } from "vitest";
import { getIdentifierNodeFromDeclaration } from "./get-identifier-node-from-declaration";

describe("getIdentifierNodeFromDeclaration", () => {
	const project = new Project({ useInMemoryFileSystem: true });

	const testCases = [
		// 1. 基本的な宣言
		{
			code: "const foo = 1;",
			expected: "foo",
			description: "変数宣言 (const)",
		},
		{ code: "let bar = 2;", expected: "bar", description: "変数宣言 (let)" },
		{ code: "var baz = 3;", expected: "baz", description: "変数宣言 (var)" },
		{
			code: "function func() {}",
			expected: "func",
			description: "関数宣言 (名前付き)",
		},
		{
			code: "class MyClass {}",
			expected: "MyClass",
			description: "クラス宣言 (名前付き)",
		},
		{
			code: "interface MyInterface {}",
			expected: "MyInterface",
			description: "インターフェース宣言",
		},
		{
			code: "type MyType = string;",
			expected: "MyType",
			description: "型エイリアス宣言",
		},
		{
			code: "enum MyEnum { A, B }",
			expected: "MyEnum",
			description: "列挙型宣言",
		},

		// 2. デフォルトエクスポート (名前付き識別子)
		{
			code: "const myVar = 1; export default myVar;",
			expected: "myVar",
			description: "デフォルトエクスポート (変数)",
		},
		{
			code: "function namedFunc() {}; export default namedFunc;",
			expected: "namedFunc",
			description: "デフォルトエクスポート (名前付き関数)",
		},
		{
			code: "class NamedClass {}; export default NamedClass;",
			expected: "NamedClass",
			description: "デフォルトエクスポート (名前付きクラス)",
		},

		// 3. デフォルトエクスポート (匿名または未処理) - 関数は undefined を返すのが期待される動作
		{
			code: "export default () => {};",
			expected: undefined,
			description: "デフォルトエクスポート (アロー関数)",
		},
		{
			code: "export default 123;",
			expected: undefined,
			description: "デフォルトエクスポート (リテラル)",
		},

		// 4. 分割代入 (パターンから識別子を返すべきではない)
		{
			code: "const { a } = { a: 1 };",
			expected: undefined,
			description: "変数宣言 (オブジェクト分割代入)",
		},
		{
			code: "const [ b ] = [ 1 ];",
			expected: undefined,
			description: "変数宣言 (配列分割代入)",
		},

		// 5. ExportSpecifier (フォールバックで処理される可能性あり、主に対象とするのは主要な宣言)
		// { code: 'const x = 1; export { x as y };', expected: 'y', description: 'エクスポート指定子 (エイリアス)' } // ExportSpecifierノードを直接取得するにはより複雑なセットアップが必要
	];

	it.each(testCases)(
		"$description の場合に $expected を返すこと",
		({ code, expected }) => {
			const sourceFile = project.createSourceFile("temp.ts", code, {
				overwrite: true,
			});
			let declarationNode: Node | undefined;

			if (code.includes("export default")) {
				// ExportAssignmentノードをより確実に見つける
				declarationNode = sourceFile
					.getStatements()
					.find(Node.isExportAssignment);
			} else if (
				code.startsWith("const") ||
				code.startsWith("let") ||
				code.startsWith("var")
			) {
				declarationNode = sourceFile
					.getVariableStatements()[0]
					?.getDeclarations()[0];
			} else if (code.startsWith("function")) {
				declarationNode = sourceFile.getFunctions()[0];
			} else if (code.startsWith("class")) {
				declarationNode = sourceFile.getClasses()[0];
			} else if (code.startsWith("interface")) {
				declarationNode = sourceFile.getInterfaces()[0];
			} else if (code.startsWith("type")) {
				declarationNode = sourceFile.getTypeAliases()[0];
			} else if (code.startsWith("enum")) {
				declarationNode = sourceFile.getEnums()[0];
			}

			expect(
				declarationNode,
				`テストコード: ${code} で宣言ノードが見つかりませんでした`,
			).toBeDefined();

			if (!declarationNode) return;

			const identifierNode = getIdentifierNodeFromDeclaration(declarationNode);

			if (expected === undefined) {
				expect(identifierNode).toBeUndefined();
			} else {
				expect(identifierNode).toBeDefined();
				expect(identifierNode?.getText()).toBe(expected);
			}
		},
	);
});
