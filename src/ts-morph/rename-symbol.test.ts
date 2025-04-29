import { Project, SyntaxKind, type Identifier } from "ts-morph";
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
	findIdentifierNode,
	validateSymbol,
	executeRename,
} from "./rename-symbol";

// --- Test Setup ---

let project: Project;
const TEST_FILE_PATH = "/test.ts";

// Helper to get identifier for testing
function getIdentifier(
	content: string,
	position: { line: number; column: number },
): Identifier {
	if (!project) {
		project = new Project({ useInMemoryFileSystem: true });
	}
	const sourceFile = project.createSourceFile(TEST_FILE_PATH, content, {
		overwrite: true,
	});
	return findIdentifierNode(project, TEST_FILE_PATH, position);
}

describe("findIdentifierNode", () => {
	beforeEach(() => {
		project = new Project({ useInMemoryFileSystem: true });
	});

	it("指定された位置の関数識別子を見つけられること", () => {
		const fileContent = "function myFunction() {}";
		const identifier = getIdentifier(fileContent, { line: 1, column: 10 });
		expect(identifier.getText()).toBe("myFunction");
		expect(identifier.getParent()?.getKind()).toBe(
			SyntaxKind.FunctionDeclaration,
		);
	});

	it("指定された位置の変数識別子を見つけられること", () => {
		const fileContent = "const myVariable = 1;";
		const identifier = getIdentifier(fileContent, { line: 1, column: 7 });
		expect(identifier.getText()).toBe("myVariable");
		expect(identifier.getParent()?.getKind()).toBe(
			SyntaxKind.VariableDeclaration,
		);
	});

	it("指定位置が識別子のテキスト内であっても識別子を見つけられること", () => {
		const fileContent = "function myFunction() {}";
		const identifier = getIdentifier(fileContent, { line: 1, column: 12 });
		expect(identifier.getText()).toBe("myFunction");
	});

	it("ファイルが存在しない場合にエラーをスローすること", () => {
		expect(() =>
			findIdentifierNode(project, "/nonexistent.ts", { line: 1, column: 1 }),
		).toThrowError(new Error("ファイルが見つかりません: /nonexistent.ts"));
	});

	it("指定位置にノードが見つからない場合（範囲外）にエラーをスローすること", () => {
		const fileContent = "const x = 1;";
		project.createSourceFile(TEST_FILE_PATH, fileContent);
		expect(() =>
			findIdentifierNode(project, TEST_FILE_PATH, { line: 5, column: 1 }),
		).toThrowError(new Error("指定位置 (5:1) はファイルの範囲外か無効です"));
	});

	it("指定位置のノードが識別子でない場合（例：キーワード）にエラーをスローすること", () => {
		const fileContent = "function myFunction() {}";
		project.createSourceFile(TEST_FILE_PATH, fileContent);
		expect(() =>
			findIdentifierNode(project, TEST_FILE_PATH, { line: 1, column: 3 }),
		).toThrowError(new Error("指定位置 (1:3) は Identifier ではありません"));
	});
});

describe("validateSymbol", () => {
	beforeEach(() => {
		project = new Project({ useInMemoryFileSystem: true });
	});

	it("シンボル名と種類（関数）が一致する場合、エラーは発生しないこと", () => {
		const identifier = getIdentifier("function myFunc() {}", {
			line: 1,
			column: 10,
		});
		expect(() =>
			validateSymbol(identifier, "myFunc", "function"),
		).not.toThrow();
	});

	it("シンボル名と種類（変数）が一致する場合、エラーは発生しないこと", () => {
		const identifier = getIdentifier("const myVar = 1;", {
			line: 1,
			column: 7,
		});
		expect(() => validateSymbol(identifier, "myVar", "variable")).not.toThrow();
	});

	it("シンボル名と種類（クラス）が一致する場合、エラーは発生しないこと", () => {
		const identifier = getIdentifier("class MyClass {}", {
			line: 1,
			column: 7,
		});
		expect(() => validateSymbol(identifier, "MyClass", "class")).not.toThrow();
	});

	it("期待されるシンボル種類の大文字・小文字が異なっていても処理できること", () => {
		const identifier = getIdentifier("function myFunc() {}", {
			line: 1,
			column: 10,
		});
		expect(() =>
			validateSymbol(identifier, "myFunc", "Function"),
		).not.toThrow();
	});

	it("シンボル名が一致しない場合にエラーをスローすること", () => {
		const identifier = getIdentifier("function myFunc() {}", {
			line: 1,
			column: 10,
		});
		expect(() =>
			validateSymbol(identifier, "wrongName", "function"),
		).toThrowError(
			new Error("シンボル名が一致しません (期待: wrongName, 実際: myFunc)"),
		);
	});

	it("シンボルの種類が一致しない場合（関数に対して変数を期待）、エラーはスローしないこと", () => {
		const identifier = getIdentifier("function myFunc() {}", {
			line: 1,
			column: 10,
		});
		expect(() =>
			validateSymbol(identifier, "myFunc", "variable"),
		).not.toThrow();
	});

	it("シンボルの種類が一致しない場合（変数に対して関数を期待）、エラーはスローしないこと", () => {
		const identifier = getIdentifier("const myVar = 1;", {
			line: 1,
			column: 7,
		});
		expect(() => validateSymbol(identifier, "myVar", "function")).not.toThrow();
	});
});

describe("executeRename (in-memory)", () => {
	beforeEach(() => {
		project = new Project({ useInMemoryFileSystem: true });
	});

	it("関数識別子を正常にリネームできること", () => {
		const oldName = "oldFunc";
		const newName = "newFunc";
		const identifier = getIdentifier(`function ${oldName}() {}`, {
			line: 1,
			column: 10,
		});
		executeRename(identifier, newName);
		expect(identifier.getText()).toBe(newName);
	});

	it("変数識別子を正常にリネームできること", () => {
		const oldName = "oldVar";
		const newName = "newVar";
		const identifier = getIdentifier(`const ${oldName} = 1;`, {
			line: 1,
			column: 7,
		});
		executeRename(identifier, newName);
		expect(identifier.getText()).toBe(newName);
	});

	it("クラス識別子を正常にリネームできること", () => {
		const oldName = "OldClass";
		const newName = "NewClass";
		const identifier = getIdentifier(`class ${oldName} {}`, {
			line: 1,
			column: 7,
		});
		executeRename(identifier, newName);
		expect(identifier.getText()).toBe(newName);
	});

	it("不正な名前にリネームしようとして ts-morph がエラーを投げた場合、ラップされたエラーがスローされること", () => {
		const oldName = "oldFunc";
		const newName = "invalid-name";
		const identifier = getIdentifier(`function ${oldName}() {}`, {
			line: 1,
			column: 10,
		});

		const mockRename = vi.spyOn(identifier, "rename").mockImplementation(() => {
			throw new Error("ts-morph internal error");
		});

		expect(() => executeRename(identifier, newName)).toThrowError(
			new Error("リネームに失敗しました: ts-morph internal error"),
		);

		mockRename.mockRestore();
	});
});
