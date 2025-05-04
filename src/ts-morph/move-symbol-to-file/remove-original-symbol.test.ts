import { describe, it, expect } from "vitest";
import { Project, SyntaxKind } from "ts-morph";
import type { Statement } from "ts-morph";
import { removeOriginalSymbol } from "./remove-original-symbol";
import { findTopLevelDeclarationByName } from "./find-declaration";

describe("removeOriginalSymbol", () => {
	// 各宣言タイプに対応するテストデータ
	const testCases = [
		{
			description: "const 変数",
			symbolName: "symbolToRemove",
			syntaxKind: SyntaxKind.VariableStatement,
			declarationSnippet: "export const symbolToRemove = 123;",
			assertionSnippet: "export const symbolToRemove",
		},
		{
			description: "function",
			symbolName: "funcToRemove",
			syntaxKind: SyntaxKind.FunctionDeclaration,
			declarationSnippet:
				"export function funcToRemove() { return 'removed'; }",
			assertionSnippet: "export function funcToRemove()",
		},
		{
			description: "class",
			symbolName: "ClassToRemove",
			syntaxKind: SyntaxKind.ClassDeclaration,
			declarationSnippet: "export class ClassToRemove {}",
			assertionSnippet: "export class ClassToRemove",
		},
		{
			description: "type エイリアス",
			symbolName: "TypeToRemove",
			syntaxKind: SyntaxKind.TypeAliasDeclaration,
			declarationSnippet: "export type TypeToRemove = { id: string };",
			assertionSnippet: "export type TypeToRemove",
		},
		{
			description: "interface",
			symbolName: "InterfaceToRemove",
			syntaxKind: SyntaxKind.InterfaceDeclaration,
			declarationSnippet:
				"export interface InterfaceToRemove { name: string; }",
			assertionSnippet: "export interface InterfaceToRemove",
		},
		{
			description: "enum",
			symbolName: "EnumToRemove",
			syntaxKind: SyntaxKind.EnumDeclaration,
			declarationSnippet: "export enum EnumToRemove { A, B }",
			assertionSnippet: "export enum EnumToRemove",
		},
	];

	it.each(testCases)(
		"指定されたトップレベルの $description 宣言を削除する",
		({
			description,
			symbolName,
			syntaxKind,
			declarationSnippet,
			assertionSnippet,
		}) => {
			// Arrange
			const project = new Project({ useInMemoryFileSystem: true });
			const otherSymbolSnippet = "export const anotherSymbol = 456;";
			const sourceFileContent = `\n${declarationSnippet}\n${otherSymbolSnippet}\n`;
			const sourceFile = project.createSourceFile(
				`/${symbolName}.ts`,
				sourceFileContent,
			);

			const declarationToRemove = findTopLevelDeclarationByName(
				sourceFile,
				symbolName,
				syntaxKind,
			);

			if (!declarationToRemove) {
				throw new Error(
					`Test setup failed: ${description} declaration (${symbolName}) not found.`,
				);
			}

			// Act
			removeOriginalSymbol(sourceFile, [declarationToRemove]);

			// Assert
			const updatedContent = sourceFile.getFullText();
			expect(updatedContent).not.toContain(assertionSnippet);
			expect(updatedContent).toContain(otherSymbolSnippet);
		},
	);

	it("最後の宣言を削除した結果、ファイルが空になる", () => {
		// Arrange
		const project = new Project({ useInMemoryFileSystem: true });
		const symbolName = "onlySymbol";
		const sourceFile = project.createSourceFile(
			"/empty.ts",
			`export const ${symbolName} = 1;`,
		);
		const declarationToRemove = findTopLevelDeclarationByName(
			sourceFile,
			symbolName,
			SyntaxKind.VariableStatement,
		);
		if (!declarationToRemove)
			throw new Error("Test setup failed: Declaration not found.");

		// Act
		removeOriginalSymbol(sourceFile, [declarationToRemove]);

		// Assert
		expect(sourceFile.getFullText().trim()).toBe(""); // 空文字列（または空白のみ）になることを期待
	});

	it("削除対象の宣言が見つからない場合 (null/undefined が渡された場合)、エラーなく完了し、ファイルは変更されない", () => {
		// Arrange
		const project = new Project({ useInMemoryFileSystem: true });
		const originalContent = "export const existing = 1;";
		const sourceFile = project.createSourceFile(
			"/no-change.ts",
			originalContent,
		);
		const declarationsToRemove: Statement[] = [];

		// Act & Assert
		expect(sourceFile.getFullText()).toBe(originalContent);
	});

	it("複数の宣言を一度に削除する", () => {
		// Arrange
		const project = new Project({ useInMemoryFileSystem: true });
		const content = `
export const varToRemove = 1;
export function funcToRemove() {}
export const keepMe = 2;
export class ClassToRemove {}
`;
		const sourceFile = project.createSourceFile("/multiple.ts", content);

		const varToRemove = findTopLevelDeclarationByName(
			sourceFile,
			"varToRemove",
			SyntaxKind.VariableStatement,
		);
		const funcToRemove = findTopLevelDeclarationByName(
			sourceFile,
			"funcToRemove",
			SyntaxKind.FunctionDeclaration,
		);
		const classToRemove = findTopLevelDeclarationByName(
			sourceFile,
			"ClassToRemove",
			SyntaxKind.ClassDeclaration,
		);

		if (!varToRemove || !funcToRemove || !classToRemove) {
			throw new Error("Test setup failed: Declarations not found.");
		}

		const declarationsToRemove = [varToRemove, funcToRemove, classToRemove];

		// Act
		removeOriginalSymbol(sourceFile, declarationsToRemove);

		// Assert
		const updatedContent = sourceFile.getFullText();
		expect(updatedContent).not.toContain("export const varToRemove");
		expect(updatedContent).not.toContain("export function funcToRemove");
		expect(updatedContent).not.toContain("export class ClassToRemove");
		expect(updatedContent).toContain("export const keepMe = 2;"); // 残るべき宣言
	});
});
