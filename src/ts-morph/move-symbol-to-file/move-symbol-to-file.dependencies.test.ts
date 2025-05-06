import { describe, it, expect } from "vitest";
import { Project, IndentationText, QuoteKind, SyntaxKind } from "ts-morph";
import { moveSymbolToFile } from "./move-symbol-to-file";

describe("moveSymbolToFile (Dependency Cases)", () => {
	it("同じファイル内の他のシンボルに依存するシンボルを移動し、依存関係も新しいファイルに含める", async () => {
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

		await moveSymbolToFile(
			project,
			oldFilePath,
			newFilePath,
			symbolToMove,
			SyntaxKind.VariableStatement,
		);

		// 1. 新しいファイルの内容確認
		const newSourceFile = project.getSourceFile(newFilePath);
		const expectedNewContent = `const baseValue = 100;

export const dependentFunc = () => {
  return baseValue * 2;
};
`;
		expect(newSourceFile?.getFullText()).toBe(expectedNewContent);

		// 2. 元のファイルの内容確認
		const updatedOldSourceFile = project.getSourceFile(oldFilePath);
		const expectedOldContent = `export const anotherThing = 'keep me';
`;
		expect(updatedOldSourceFile?.getFullText()).toBe(expectedOldContent);

		// 3. 参照元のインポートパス確認
		const updatedReferencingSourceFile =
			project.getSourceFile(referencingFilePath); // 再取得
		const expectedReferencingContent = `import { dependentFunc } from './moved-module';
console.log(dependentFunc());`;
		expect(updatedReferencingSourceFile?.getFullText()).toBe(
			expectedReferencingContent,
		);
	});

	it("他に参照される内部依存シンボルがある場合、そのシンボルは元ファイルに残り、新しいファイルからインポートされる", async () => {
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

		await moveSymbolToFile(
			project,
			oldFilePath,
			newFilePath,
			symbolToMove,
			SyntaxKind.VariableStatement,
		);

		// 1. 新しいファイルの内容確認
		const newSourceFile = project.getSourceFile(newFilePath);
		const expectedNewContent = `import { sharedUtil } from "./shared-logic";

export const featureAFunc = () => {
  return 'Feature A using ' + sharedUtil.value;
};
`;
		expect(newSourceFile?.getFullText()).toBe(expectedNewContent);

		// 2. 元のファイルの内容確認
		const updatedOldSourceFile = project.getSourceFile(oldFilePath);
		const expectedOldContent = `export const sharedUtil = { value: 'shared' }; // export しておく必要がある
export const anotherFunc = () => {
  return 'Another using ' + sharedUtil.value;
};`;
		expect(updatedOldSourceFile?.getFullText()).toBe(expectedOldContent);

		// 3. 参照元のインポートパス確認
		const updatedReferencingSourceFile =
			project.getSourceFile(referencingFilePath); // 再取得
		const expectedReferencingContent = `import { featureAFunc } from './feature-a';
console.log(featureAFunc());`;
		expect(updatedReferencingSourceFile?.getFullText()).toBe(
			expectedReferencingContent,
		);
	});

	it("exportされていない内部依存シンボルが他からも参照される場合、元ファイルにexportが追加され、新しいファイルからインポートされる", async () => {
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
		const nonExportedDependency = "internalCalculator";
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
		await moveSymbolToFile(
			project,
			oldFilePath,
			newFilePath,
			symbolToMove,
			SyntaxKind.VariableStatement,
		);

		// 1. 新しいファイルの内容確認
		const newSourceFile = project.getSourceFile(newFilePath);
		const expectedNewContent = `import { internalCalculator } from "./core-utils";

export const formatDisplayValue = (val: number) => {
  return \`Value: \${internalCalculator(val)}\`;
};
`;
		expect(newSourceFile?.getFullText()).toBe(expectedNewContent);

		// 2. 元のファイルの内容確認
		const updatedOldSourceFile = project.getSourceFile(oldFilePath);
		const expectedOldContent = `export const internalCalculator = (x: number) => x * x; // export なし
export const generateReport = (data: number[]) => {
  const total = data.reduce((sum, x) => sum + internalCalculator(x), 0);
  return \`Report Total: \${total}\`;
};`;
		expect(updatedOldSourceFile?.getFullText()).toBe(expectedOldContent);
	});

	it("移動したシンボルが移動元のファイル内で使われていた場合、移動元にインポート文が追加される", async () => {
		const project = new Project({
			useInMemoryFileSystem: true,
			manipulationSettings: {
				indentationText: IndentationText.TwoSpaces,
				quoteKind: QuoteKind.Double, // プロジェクト規約に合わせておく
			},
			compilerOptions: { baseUrl: "." },
		});

		const oldFilePath = "/src/original.ts";
		const newFilePath = "/src/helper.ts";
		const symbolToMove = "helperFunc"; // 移動対象
		const userSymbol = "mainFunc"; // helperFunc を使う関数

		// 移動元のファイル
		project.createSourceFile(
			oldFilePath,
			`function ${symbolToMove}(): string {
  return 'Helper result';
}

export function ${userSymbol}(): string {
  // helperFunc を使用
  const result = ${symbolToMove}();
  return \`Main using \${result}\`;
}`,
		);

		await moveSymbolToFile(
			project,
			oldFilePath,
			newFilePath,
			symbolToMove,
			SyntaxKind.FunctionDeclaration, // 移動するのは関数宣言
		);

		// 1. 新しいファイルの内容確認
		const newSourceFile = project.getSourceFile(newFilePath);
		const expectedNewContent = `export function helperFunc(): string {\n  return 'Helper result';\n}\n`;
		expect(newSourceFile?.getFullText().trim()).toBe(expectedNewContent.trim());

		// 2. 元のファイルの内容確認
		const updatedOldSourceFile = project.getSourceFile(oldFilePath);
		const expectedOldContent = `import { helperFunc } from "./helper";

export function mainFunc(): string {
  // helperFunc を使用
  const result = helperFunc();
  return \`Main using \${result}\`;
}\n`;
		expect(updatedOldSourceFile?.getFullText().trim()).toBe(
			expectedOldContent.trim(),
		);
	});

	it("名前空間インポート (import * as) に依存するシンボルを移動する", async () => {
		const project = new Project({
			useInMemoryFileSystem: true,
			manipulationSettings: {
				indentationText: IndentationText.TwoSpaces,
				quoteKind: QuoteKind.Double,
			},
			compilerOptions: { baseUrl: ".", esModuleInterop: true }, // esModuleInterop を有効にする必要がある場合がある
		});

		const oldFilePath = "/src/path-utils.ts";
		const newFilePath = "/src/moved-path-utils.ts";
		const symbolToMove = "resolvePath";
		const referencingFilePath = "/src/main.ts";

		// 移動元のファイル
		project.createSourceFile(
			oldFilePath,
			`import * as path from 'node:path'; // 名前空間インポート

export const ${symbolToMove} = (p1: string, p2: string): string => {
  return path.resolve(p1, p2);
};`,
		);

		// 参照元のファイル
		project.createSourceFile(
			referencingFilePath,
			`import { ${symbolToMove} } from './path-utils';
const resolved = ${symbolToMove}('/foo', 'bar');
console.log(resolved);`,
		);

		await moveSymbolToFile(
			project,
			oldFilePath,
			newFilePath,
			symbolToMove,
			SyntaxKind.VariableStatement,
		);

		// 1. 新しいファイルの内容確認 (★ import * as path が含まれるべき)
		const newSourceFile = project.getSourceFile(newFilePath);
		const expectedNewContent = `import * as path from "node:path";

export const resolvePath = (p1: string, p2: string): string => {
  return path.resolve(p1, p2);
};
`;
		expect(newSourceFile?.getFullText()).toBe(expectedNewContent);

		// 2. 元のファイルの内容確認 (空になるはず)
		const updatedOldSourceFile = project.getSourceFile(oldFilePath);
		expect(updatedOldSourceFile?.getFullText().trim()).toBe("");

		// 3. 参照元のインポートパス確認
		const updatedReferencingSourceFile =
			project.getSourceFile(referencingFilePath);
		const expectedReferencingContent = `import { resolvePath } from './moved-path-utils';
const resolved = resolvePath('/foo', 'bar');
console.log(resolved);`;
		expect(updatedReferencingSourceFile?.getFullText()).toBe(
			expectedReferencingContent,
		);
	});

	it("既存のファイルにシンボルを移動し、既存の内容とマージされる（移動元から既にインポートがある場合）", async () => {
		const project = new Project({
			useInMemoryFileSystem: true,
			manipulationSettings: {
				indentationText: IndentationText.TwoSpaces,
				quoteKind: QuoteKind.Double,
			},
			compilerOptions: { baseUrl: "." },
		});

		const oldFilePath = "/src/source.ts";
		const existingFilePath = "/src/destination.ts"; // 移動先の既存ファイル
		const symbolToMove = "moveMe";
		const existingSymbol = "keepMe";
		const alreadyImportedSymbol = "alreadyImported"; // ★ 移動前からインポートされているシンボル
		const referencingFilePath = "/src/user.ts";

		// 移動元のファイル (移動対象 + 既存ファイルがインポートしているシンボル)
		project.createSourceFile(
			oldFilePath,
			`export const ${alreadyImportedSymbol} = 'Imported before move';
export const ${symbolToMove} = () => 'I was moved';`,
		);

		// ★ 移動先の既存ファイル (alreadyImportedSymbol をインポート済み)
		project.createSourceFile(
			existingFilePath,
			`import { ${alreadyImportedSymbol} } from './source';

export const ${existingSymbol} = 'I was already here';

console.log('Existing code using:', ${alreadyImportedSymbol});`,
		);

		// 参照元のファイル (moveMe を使用)
		project.createSourceFile(
			referencingFilePath,
			`import { ${symbolToMove} } from './source';
console.log(${symbolToMove}());`,
		);

		await moveSymbolToFile(
			project,
			oldFilePath,
			existingFilePath,
			symbolToMove,
			SyntaxKind.VariableStatement,
		);

		// 1. 移動先のファイルの内容確認
		const updatedExistingFile = project.getSourceFile(existingFilePath);
		// ★ 既存のインポートは維持され、移動したシンボルが追加される
		const expectedExistingContent = `import { alreadyImported } from './source';

export const keepMe = 'I was already here';

console.log('Existing code using:', alreadyImported);

export const moveMe = () => 'I was moved';`;
		expect(updatedExistingFile?.getFullText()).toBe(expectedExistingContent);

		// 2. 元のファイルの内容確認 (alreadyImportedSymbol のみが残る)
		const updatedOldSourceFile = project.getSourceFile(oldFilePath);
		const expectedOldContent = `export const ${alreadyImportedSymbol} = 'Imported before move';`;
		expect(updatedOldSourceFile?.getFullText()).toBe(expectedOldContent);

		// 3. 参照元のインポートパス確認 (moveMe のインポート先が destination に変わる)
		const updatedReferencingSourceFile =
			project.getSourceFile(referencingFilePath);
		const expectedReferencingContent = `import { moveMe } from './destination';
console.log(moveMe());`;
		expect(updatedReferencingSourceFile?.getFullText()).toBe(
			expectedReferencingContent,
		);
	});
});
