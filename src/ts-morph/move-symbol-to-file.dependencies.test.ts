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

		// 移動元のファイル
		const oldSourceFile = project.createSourceFile(
			oldFilePath,
			`const ${dependencySymbol} = 100;
export const ${symbolToMove} = () => {
  return ${dependencySymbol} * 2;
};
export const anotherThing = 'keep me'; // 移動しない他のシンボル
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
		expect(newSourceFile).toBeDefined();
		const newContent = newSourceFile?.getFullText() ?? "";
		// 移動対象のシンボルが含まれる
		expect(newContent).toContain(`export const ${symbolToMove} = () => {`);
		// ★ 内部依存関係のシンボルも含まれる (ただし export はされない)
		expect(newContent).toContain(`const ${dependencySymbol} = 100;`);
		expect(newContent).not.toContain(`export const ${dependencySymbol} = 100;`);

		// 2. 元のファイルの内容確認
		const oldContent = oldSourceFile.getFullText();
		// 移動対象のシンボルは削除される
		expect(oldContent).not.toContain(`export const ${symbolToMove}`);
		// 依存されていたシンボルも、他に参照がなければ削除される (Case A)
		expect(oldContent).not.toContain(`const ${dependencySymbol} = 100;`);
		// 移動しない他のシンボルは残る
		expect(oldContent).toContain(`export const anotherThing = 'keep me';`);

		// 3. 参照元のインポートパス確認 (シングルクォート期待)
		const referencingContent = referencingSourceFile.getFullText();
		expect(referencingContent).toContain(
			`import { ${symbolToMove} } from './moved-module';`,
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
		const referencingFilePath = "/src/consumer.ts";
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
		expect(newSourceFile).toBeDefined();
		const newContent = newSourceFile?.getFullText() ?? "";
		// 移動対象のシンボルが含まれる
		expect(newContent).toContain(`export const ${symbolToMove} = () => {`);
		// ★ 共有依存関係の import 文が含まれる
		expect(newContent).toContain(
			`import { ${sharedDependency} } from "./shared-logic";`,
		);
		// 共有依存関係の宣言自体は含まれない
		expect(newContent).not.toContain(`export const ${sharedDependency} = {`);

		// 2. 元のファイルの内容確認
		const oldContent = oldSourceFile.getFullText();
		// 移動対象のシンボルは削除される
		expect(oldContent).not.toContain(`export const ${symbolToMove}`);
		// ★ 共有依存関係は元のファイルに残る
		expect(oldContent).toContain(
			`export const ${sharedDependency} = { value: 'shared' };`,
		);
		// 共有依存関係を使う他の関数も残る
		expect(oldContent).toContain(`export const ${anotherUser} = () => {`);

		// 3. 参照元のインポートパス確認 (シングルクォート期待)
		const referencingSourceFile = project.getSourceFile(referencingFilePath);
		const referencingContent = referencingSourceFile?.getFullText() ?? "";
		expect(referencingContent).toContain(
			`import { ${symbolToMove} } from './feature-a';`,
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
  return \`Value: \\\${${nonExportedDependency}(val)}\`;
};

export const ${anotherUser} = (data: number[]) => {
  const total = data.reduce((sum, x) => sum + ${nonExportedDependency}(x), 0);
  return \`Report Total: \\\${total}\`;
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
		expect(newSourceFile).toBeDefined();
		const newContent = newSourceFile?.getFullText() ?? "";
		expect(newContent).toContain(
			`export const ${symbolToMove} = (val: number) => {`,
		);
		// ★ export されていなかった依存関係の import 文が含まれる
		expect(newContent).toContain(
			`import { ${nonExportedDependency} } from "./core-utils";`,
		);
		expect(newContent).not.toContain(`const ${nonExportedDependency} = (`);

		// 2. 元のファイルの内容確認
		const oldContent = oldSourceFile.getFullText();
		// 移動対象のシンボルは削除される
		expect(oldContent).not.toContain(`export const ${symbolToMove}`);
		// ★ exportされていなかった依存関係に export が追加されて残っている
		expect(oldContent).toContain(
			`export const ${nonExportedDependency} = (x: number) => x * x;`,
		);
		// 依存関係を使う他の関数も残る
		expect(oldContent).toContain(
			`export const ${anotherUser} = (data: number[]) => {`,
		);
	});

	// TODO: 他の依存関係パターン（外部依存と内部依存の組み合わせなど）を追加
});
