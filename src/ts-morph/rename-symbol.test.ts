import { Project, SyntaxKind, type Identifier } from "ts-morph";
import { describe, it, expect } from "vitest";
import { findIdentifierNode, validateSymbol } from "./rename-symbol";

// --- Test Setup ---

const TEST_FILE_PATH = "/test.ts";

const setupProject = () => {
	const project = new Project({ useInMemoryFileSystem: true });

	const getIdentifier = (
		content: string,
		position: { line: number; column: number },
	): Identifier => {
		project.createSourceFile(TEST_FILE_PATH, content, {
			overwrite: true,
		});
		return findIdentifierNode(project, TEST_FILE_PATH, position);
	};
	return { project, getIdentifier };
};

describe("findIdentifierNode", () => {
	it("指定された位置の関数識別子を見つけられること", () => {
		const { getIdentifier } = setupProject();
		const fileContent = "function myFunction() {}";
		const identifier = getIdentifier(fileContent, { line: 1, column: 10 });
		expect(identifier.getText()).toBe("myFunction");
		expect(identifier.getParent()?.getKind()).toBe(
			SyntaxKind.FunctionDeclaration,
		);
	});

	it("指定された位置の変数識別子を見つけられること", () => {
		const { getIdentifier } = setupProject();
		const fileContent = "const myVariable = 1;";
		const identifier = getIdentifier(fileContent, { line: 1, column: 7 });
		expect(identifier.getText()).toBe("myVariable");
		expect(identifier.getParent()?.getKind()).toBe(
			SyntaxKind.VariableDeclaration,
		);
	});

	it("指定位置が識別子のテキスト内であっても識別子を見つけられること", () => {
		const { getIdentifier } = setupProject();
		const fileContent = "function myFunction() {}";
		const identifier = getIdentifier(fileContent, { line: 1, column: 12 });
		expect(identifier.getText()).toBe("myFunction");
	});

	it("ファイルが存在しない場合にエラーをスローすること", () => {
		const { project } = setupProject();
		expect(() =>
			findIdentifierNode(project, "/nonexistent.ts", { line: 1, column: 1 }),
		).toThrowError(new Error("ファイルが見つかりません: /nonexistent.ts"));
	});

	it("指定位置にノードが見つからない場合（範囲外）にエラーをスローすること", () => {
		const { project } = setupProject();
		const fileContent = "const x = 1;";
		project.createSourceFile(TEST_FILE_PATH, fileContent);
		expect(() =>
			findIdentifierNode(project, TEST_FILE_PATH, { line: 5, column: 1 }),
		).toThrowError(new Error("指定位置 (5:1) はファイルの範囲外か無効です"));
	});

	it("指定位置のノードが識別子でない場合（例：キーワード）にエラーをスローすること", () => {
		const { project } = setupProject();
		const fileContent = "function myFunction() {}";
		project.createSourceFile(TEST_FILE_PATH, fileContent);
		expect(() =>
			findIdentifierNode(project, TEST_FILE_PATH, { line: 1, column: 3 }),
		).toThrowError(new Error("指定位置 (1:3) は Identifier ではありません"));
	});
});

describe("validateSymbol", () => {
	it("シンボル名が一致する場合、エラーは発生しないこと", () => {
		const { getIdentifier } = setupProject();
		const identifier = getIdentifier("function myFunc() {}", {
			line: 1,
			column: 10,
		});
		expect(() => validateSymbol(identifier, "myFunc")).not.toThrow();
	});
	it("シンボル名が一致しない場合にエラーをスローすること", () => {
		const { getIdentifier } = setupProject();
		const identifier = getIdentifier("function myFunc() {}", {
			line: 1,
			column: 10,
		});
		expect(() => validateSymbol(identifier, "wrongName")).toThrowError(
			new Error("シンボル名が一致しません (期待: wrongName, 実際: myFunc)"),
		);
	});
});
