import { describe, it, expect } from "vitest";
import { Project, IndentationText, QuoteKind, SyntaxKind } from "ts-morph";
import { moveSymbolToFile } from "./move-symbol-to-file";

describe("moveSymbolToFile (Dependency Cases)", () => {
	it("同じファイル内の他のシンボルに依存するシンボルを移動し、依存関係も新しいファイルに含める", async () => {
		// Arrange
		const project = new Project({
			useInMemoryFileSystem: true,
			manipulationSettings: {
				indentationText: IndentationText.TwoSpaces,
				quoteKind: QuoteKind.Double, // プロジェクト規約に合わせておく
			},
			compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } },
		});

		const oldFilePath = "/src/module.ts";
		const newFilePath = "/src/moved-module.ts";
		const symbolToMove = "dependentFunc";
		const dependencySymbol = "baseValue"; // 移動しない内部依存
		const referencingFilePath = "/src/user.ts";
		const anotherThing = "anotherThing"; // 移動しない他のシンボル

		// 移動元のファイル
		const oldSourceFile = project.createSourceFile(
			oldFilePath,
			`const ${dependencySymbol} = 100;
export const ${symbolToMove} = () => {
  return ${dependencySymbol} * 2;
};
export const ${anotherThing} = 'keep me';
`,
		);

		// 参照元のファイル
		const referencingSourceFile = project.createSourceFile(
			referencingFilePath,
			`import { ${symbolToMove} } from './module';
console.log(${symbolToMove}());`,
		);

		// Act
		await moveSymbolToFile(
			project,
			oldFilePath,
			newFilePath,
			symbolToMove,
			SyntaxKind.VariableStatement,
		);

		// Assert
		// 1. 新しいファイルの内容確認
		const newSourceFile = project.getSourceFile(newFilePath);
		const expectedNewContent =
			"const baseValue = 100;\n\nexport const dependentFunc = () => {\n  return baseValue * 2;\n};\n";
		expect(newSourceFile?.getFullText()).toBe(expectedNewContent);

		// 2. 元のファイルの内容確認
		const updatedOldSourceFile = project.getSourceFile(oldFilePath);
		const expectedOldContent = "export const anotherThing = 'keep me';\n";
		expect(updatedOldSourceFile?.getFullText()).toBe(expectedOldContent);

		// 3. 参照元のインポートパス確認
		const updatedReferencingSourceFile =
			project.getSourceFile(referencingFilePath); // 再取得
		const expectedReferencingContent =
			'import { dependentFunc } from "./moved-module";\nconsole.log(dependentFunc());';
		expect(updatedReferencingSourceFile?.getFullText()).toBe(
			expectedReferencingContent,
		);
	});

	it("他に参照される内部依存シンボルがある場合、そのシンボルは元ファイルに残り、新しいファイルからインポートされる", async () => {
		// Arrange
		const project = new Project({
			useInMemoryFileSystem: true,
			manipulationSettings: {
				indentationText: IndentationText.TwoSpaces,
				quoteKind: QuoteKind.Double,
			},
			compilerOptions: { baseUrl: "." },
		});

		const oldFilePath = "/src/shared-logic.ts";
		const newFilePath = "/src/feature-a.ts";
		const symbolToMove = "featureAFunc";
		const sharedDependency = "sharedUtil"; // 他からも参照される内部依存
		const anotherUser = "anotherFunc"; // sharedUtil を使う他の関数
		const referencingFilePath = "/src/consumer.ts";

		// 移動元のファイル
		const oldSourceFile = project.createSourceFile(
			oldFilePath,
			`export const ${sharedDependency} = { value: 'shared' }; // export しておく必要がある

export const ${symbolToMove} = () => {
  return 'Feature A using ' + ${sharedDependency}.value;
};

export const ${anotherUser} = () => {
  return 'Another using ' + ${sharedDependency}.value;
};`,
		);

		// featureAFunc を使うファイル (参照更新の確認用)
		project.createSourceFile(
			referencingFilePath,
			`import { ${symbolToMove} } from './shared-logic';
console.log(${symbolToMove}());`,
		);

		// Act
		await moveSymbolToFile(
			project,
			oldFilePath,
			newFilePath,
			symbolToMove,
			SyntaxKind.VariableStatement,
		);

		// Assert
		// 1. 新しいファイルの内容確認
		const newSourceFile = project.getSourceFile(newFilePath);
		const expectedNewContent = `import { sharedUtil } from \"./shared-logic\";\n\nexport const featureAFunc = () => {\n  return 'Feature A using ' + sharedUtil.value;\n};\n`;
		expect(newSourceFile?.getFullText()).toBe(expectedNewContent);

		// 2. 元のファイルの内容確認
		const updatedOldSourceFile = project.getSourceFile(oldFilePath);
		const expectedOldContent =
			"export const sharedUtil = { value: 'shared' };\n\nexport const anotherFunc = () => {\n  return 'Another using ' + sharedUtil.value;\n};\n";
		expect(updatedOldSourceFile?.getFullText()).toBe(expectedOldContent);

		// 3. 参照元のインポートパス確認
		const updatedReferencingSourceFile =
			project.getSourceFile(referencingFilePath); // 再取得
		const expectedReferencingContent =
			'import { featureAFunc } from "./feature-a";\nconsole.log(featureAFunc());';
		expect(updatedReferencingSourceFile?.getFullText()).toBe(
			expectedReferencingContent,
		);
	});

	it("exportされていない内部依存シンボルが他からも参照される場合、元ファイルにexportが追加され、新しいファイルからインポートされる", async () => {
		// Arrange
		const project = new Project({
			useInMemoryFileSystem: true,
			manipulationSettings: {
				indentationText: IndentationText.TwoSpaces,
				quoteKind: QuoteKind.Double,
			},
			compilerOptions: { baseUrl: "." },
		});

		const oldFilePath = "/src/core-utils.ts";
		const newFilePath = "/src/ui-helper.ts";
		const symbolToMove = "formatDisplayValue";
		const nonExportedDependency = "internalCalculator"; // ★ export されていない内部依存
		const anotherUser = "generateReport"; // internalCalculator を使う他の関数

		// 移動元のファイル
		const oldSourceFile = project.createSourceFile(
			oldFilePath,
			`const ${nonExportedDependency} = (x: number) => x * x; // export なし

export const ${symbolToMove} = (val: number) => {
  return \`Value: \${${nonExportedDependency}(val)}\`;
};

export const ${anotherUser} = (data: number[]) => {
  const total = data.reduce((sum, x) => sum + ${nonExportedDependency}(x), 0);
  return \`Report Total: \${total}\`;
};`,
		);
		// Act
		await moveSymbolToFile(
			project,
			oldFilePath,
			newFilePath,
			symbolToMove,
			SyntaxKind.VariableStatement,
		);

		// Assert
		// 1. 新しいファイルの内容確認
		const newSourceFile = project.getSourceFile(newFilePath);
		const expectedNewContent = `import { internalCalculator } from \"./core-utils\";\n\nexport const formatDisplayValue = (val: number) => {\n  return \`Value: \${internalCalculator(val)}\`;\n};\n`;
		expect(newSourceFile?.getFullText()).toBe(expectedNewContent);

		// 2. 元のファイルの内容確認
		const updatedOldSourceFile = project.getSourceFile(oldFilePath);
		const expectedOldContent = `export const internalCalculator = (x: number) => x * x; // export なし -> export 追加される

export const generateReport = (data: number[]) => {
  const total = data.reduce((sum, x) => sum + internalCalculator(x), 0);
  return \`Report Total: \${total}\`;
};
`;
		expect(updatedOldSourceFile?.getFullText()).toBe(expectedOldContent);

		// ★★★ 参照元ファイルの確認ブロックを削除 ★★★
		/*
		// 3. 参照元のインポートパス確認
		const updatedReferencingSourceFile = project.getSourceFile(referencingFilePath); // 再取得
		const expectedReferencingContent = 'import { featureAFunc } from "./feature-a";\nconsole.log(featureAFunc());';
		expect(updatedReferencingSourceFile?.getFullText()).toBe(
			expectedReferencingContent,
		);
		*/
	});

	// TODO: 他の依存関係パターン（外部依存と内部依存の組み合わせなど）を追加
});
