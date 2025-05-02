import { describe, it, expect, beforeEach } from "vitest";
import { Project, type SourceFile, SyntaxKind } from "ts-morph";
import { removeNamedImport, addOrUpdateNamedImport } from "./import-utils";
// import { addOrUpdateNamedImport } from './import-utils'; // これからテストする関数

// テストプロジェクト設定用ヘルパー (move-symbol.test.ts からコピー)
const setupProject = () => {
	const project = new Project({
		useInMemoryFileSystem: true,
		compilerOptions: {
			target: 99, // ESNext
			module: 99, // ESNext
			esModuleInterop: true,
			allowSyntheticDefaultImports: true,
		},
	});
	project.createDirectory("/src");
	return project;
};

describe("import-utils", () => {
	let project: Project;
	let sourceFile: SourceFile;

	beforeEach(() => {
		project = setupProject();
	});

	describe("removeNamedImport", () => {
		it("特定のシンボルのみを削除できること", () => {
			// Arrange
			sourceFile = project.createSourceFile(
				"/src/test.ts",
				`
				import { foo, bar, baz } from './moduleA';
				import { other } from './moduleB';

				console.log(foo, bar, baz, other);
			`,
			);
			const moduleSpecifierToRemoveFrom = "./moduleA";
			const symbolToRemove = "bar";

			// Act
			removeNamedImport(
				sourceFile,
				symbolToRemove,
				moduleSpecifierToRemoveFrom,
			);

			// Assert
			const importA = sourceFile.getImportDeclaration(
				moduleSpecifierToRemoveFrom,
			);
			expect(importA).toBeDefined(); // import 文自体は残るはず

			const namedImports = importA
				?.getImportClause()
				?.getNamedBindings()
				?.asKind(SyntaxKind.NamedImports)
				?.getElements();
			expect(namedImports).toBeDefined();
			const remainingSymbols = namedImports?.map((n) => n.getName());
			expect(remainingSymbols).toEqual(["foo", "baz"]); // bar が削除されている
			expect(remainingSymbols).not.toContain(symbolToRemove);

			// 他の import 文に影響がないことも確認
			const importB = sourceFile.getImportDeclaration("./moduleB");
			expect(importB).toBeDefined();
			expect(
				importB
					?.getImportClause()
					?.getNamedBindings()
					?.asKind(SyntaxKind.NamedImports)
					?.getElements().length,
			).toBe(1);

			// ファイル全体のテキストを確認（オプション）
			// console.log(sourceFile.getFullText());
			expect(sourceFile.getFullText()).toContain(
				"import { foo, baz } from './moduleA';",
			);
			expect(sourceFile.getFullText()).not.toContain(
				"import { foo, bar, baz } from './moduleA';",
			);
		});

		it("最後のシンボルだった場合、ImportDeclaration ごと削除されること", () => {
			// Arrange
			sourceFile = project.createSourceFile(
				"/src/test.ts",
				`
				import { single } from './moduleA';
				import { other } from './moduleB';

				console.log(single, other);
			`,
			);
			const moduleSpecifierToRemoveFrom = "./moduleA";
			const symbolToRemove = "single";

			// Act
			removeNamedImport(
				sourceFile,
				symbolToRemove,
				moduleSpecifierToRemoveFrom,
			);

			// Assert
			const importA = sourceFile.getImportDeclaration(
				moduleSpecifierToRemoveFrom,
			);
			expect(importA).toBeUndefined(); // ImportDeclaration が削除されているはず

			// 他の import 文に影響がないことも確認
			const importB = sourceFile.getImportDeclaration("./moduleB");
			expect(importB).toBeDefined();

			// ファイル全体のテキストを確認（オプション）
			// console.log(sourceFile.getFullText());
			expect(sourceFile.getFullText()).not.toContain(
				"import { single } from './moduleA';",
			);
			expect(sourceFile.getFullText()).toContain(
				"import { other } from './moduleB';",
			);
		});

		it("存在しないシンボルを指定してもエラーにならないこと", () => {
			// Arrange
			sourceFile = project.createSourceFile(
				"/src/test.ts",
				`
				import { foo } from './moduleA';
			`,
			);
			const moduleSpecifierToRemoveFrom = "./moduleA";
			const nonExistentSymbol = "bar";

			// Act & Assert
			expect(() => {
				removeNamedImport(
					sourceFile,
					nonExistentSymbol,
					moduleSpecifierToRemoveFrom,
				);
			}).not.toThrow();

			// 状態が変わっていないことを確認
			const importA = sourceFile.getImportDeclaration(
				moduleSpecifierToRemoveFrom,
			);
			expect(importA).toBeDefined();
			expect(
				importA
					?.getImportClause()
					?.getNamedBindings()
					?.asKind(SyntaxKind.NamedImports)
					?.getElements().length,
			).toBe(1);
			expect(sourceFile.getFullText()).toContain(
				"import { foo } from './moduleA';",
			);
		});

		it("対象の import 文が存在しない場合もエラーにならないこと", () => {
			// Arrange
			sourceFile = project.createSourceFile(
				"/src/test.ts",
				`
				import { foo } from './moduleA';
			`,
			);
			const nonExistentModuleSpecifier = "./moduleB";
			const symbolToRemove = "bar";

			// Act & Assert
			expect(() => {
				removeNamedImport(
					sourceFile,
					symbolToRemove,
					nonExistentModuleSpecifier,
				);
			}).not.toThrow();

			// 状態が変わっていないことを確認
			expect(sourceFile.getImportDeclarations().length).toBe(1);
			expect(sourceFile.getFullText()).toContain(
				"import { foo } from './moduleA';",
			);
		});
	});

	describe("addOrUpdateNamedImport", () => {
		it("既存の import 文にシンボルを追加できること", () => {
			// Arrange
			sourceFile = project.createSourceFile(
				"/src/test.ts",
				`
				import { foo } from './moduleA';
				import { bar } from './moduleB'; // こちらは変更しない

				console.log(foo, bar);
			`,
			);
			const moduleSpecifierToAddTo = "./moduleA";
			const symbolToAdd = "baz";

			// Act
			addOrUpdateNamedImport(sourceFile, symbolToAdd, moduleSpecifierToAddTo);

			// Assert
			const importA = sourceFile.getImportDeclaration(moduleSpecifierToAddTo);
			expect(importA).toBeDefined();

			const namedImports = importA
				?.getImportClause()
				?.getNamedBindings()
				?.asKind(SyntaxKind.NamedImports)
				?.getElements();
			expect(namedImports).toBeDefined();
			const symbols = namedImports?.map((n) => n.getName());
			expect(symbols).toEqual(["foo", "baz"]); // baz が追加されている

			// ファイル全体のテキストを確認（オプション）
			expect(sourceFile.getFullText()).toContain(
				"import { foo, baz } from './moduleA';",
			);
		});

		it("新しい import 文としてシンボルを追加できること", () => {
			// Arrange
			sourceFile = project.createSourceFile(
				"/src/test.ts",
				`
				// 既存の import はない
				console.log('hello');
			`,
			);
			const moduleSpecifierToAddTo = "./newModule";
			const symbolToAdd = "newSymbol";

			// Act
			addOrUpdateNamedImport(sourceFile, symbolToAdd, moduleSpecifierToAddTo);

			// Assert
			const newImport = sourceFile.getImportDeclaration(moduleSpecifierToAddTo);
			expect(newImport).toBeDefined();

			const namedImports = newImport
				?.getImportClause()
				?.getNamedBindings()
				?.asKind(SyntaxKind.NamedImports)
				?.getElements();
			expect(namedImports).toBeDefined();
			const symbols = namedImports?.map((n) => n.getName());
			expect(symbols).toEqual([symbolToAdd]);

			// ファイル全体のテキストを確認（オプション）
			expect(sourceFile.getFullText()).toContain(
				`import { ${symbolToAdd} } from "${moduleSpecifierToAddTo}";`,
			);
			// ファイルの先頭付近に追加されることを期待 (厳密な保証は難しい)
			expect(sourceFile.getStatements()[0]?.getKind()).toBe(
				SyntaxKind.ImportDeclaration,
			);
		});

		it("既にインポートされているシンボルを追加しようとしても重複しないこと", () => {
			// Arrange
			sourceFile = project.createSourceFile(
				"/src/test.ts",
				`
				import { foo, bar } from './moduleA';
			`,
			);
			const moduleSpecifierToAddTo = "./moduleA";
			const existingSymbol = "foo";

			const initialText = sourceFile.getFullText();

			// Act
			addOrUpdateNamedImport(
				sourceFile,
				existingSymbol,
				moduleSpecifierToAddTo,
			);

			// Assert
			const importA = sourceFile.getImportDeclaration(moduleSpecifierToAddTo);
			const namedImports = importA
				?.getImportClause()
				?.getNamedBindings()
				?.asKind(SyntaxKind.NamedImports)
				?.getElements();
			const symbols = namedImports?.map((n) => n.getName());
			expect(symbols).toEqual(["foo", "bar"]);

			expect(sourceFile.getFullText()).toBe(initialText);
			// Use single quotes in the assertion string
			expect(sourceFile.getFullText()).toContain(
				"import { foo, bar } from './moduleA';",
			);
		});
	});
});
