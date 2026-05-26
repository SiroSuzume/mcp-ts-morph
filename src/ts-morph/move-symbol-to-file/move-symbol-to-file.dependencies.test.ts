import { describe, it, expect } from "vitest";
import { SyntaxKind } from "ts-morph";
import { createInMemoryProjectWithDoubleQuotes } from "../_test-utils/create-in-memory-project";
import { getFileText } from "../_test-utils/get-file-text";
import { moveSymbolToFile } from "./move-symbol-to-file";

describe("moveSymbolToFile (Dependency Cases)", () => {
	it("同じファイル内の他のシンボルに依存するシンボルを移動し、依存関係も新しいファイルに含める", async () => {
		const project = createInMemoryProjectWithDoubleQuotes();
		const oldFilePath = "/src/module.ts";
		const newFilePath = "/src/moved-module.ts";
		const referencingFilePath = "/src/user.ts";

		project.createSourceFile(
			oldFilePath,
			`const baseValue = 100;
export const dependentFunc = () => {
  return baseValue * 2;
};
export const anotherThing = 'keep me';
`,
		);
		project.createSourceFile(
			referencingFilePath,
			`import { dependentFunc } from './module';
console.log(dependentFunc());`,
		);

		await moveSymbolToFile(
			project,
			oldFilePath,
			newFilePath,
			"dependentFunc",
			SyntaxKind.VariableStatement,
		);

		expect(getFileText(project, newFilePath)).toBe(
			`const baseValue = 100;

export const dependentFunc = () => {
  return baseValue * 2;
};
`,
		);
		expect(getFileText(project, oldFilePath)).toBe(
			`export const anotherThing = 'keep me';
`,
		);
		expect(getFileText(project, referencingFilePath)).toBe(
			`import { dependentFunc } from './moved-module';
console.log(dependentFunc());`,
		);
	});

	it("他に参照される内部依存シンボルがある場合、そのシンボルは元ファイルに残り、新しいファイルからインポートされる", async () => {
		const project = createInMemoryProjectWithDoubleQuotes();
		const oldFilePath = "/src/shared-logic.ts";
		const newFilePath = "/src/feature-a.ts";
		const referencingFilePath = "/src/consumer.ts";

		project.createSourceFile(
			oldFilePath,
			`export const sharedUtil = { value: 'shared' }; // export しておく必要がある

export const featureAFunc = () => {
  return 'Feature A using ' + sharedUtil.value;
};

export const anotherFunc = () => {
  return 'Another using ' + sharedUtil.value;
};`,
		);
		project.createSourceFile(
			referencingFilePath,
			`import { featureAFunc } from './shared-logic';
console.log(featureAFunc());`,
		);

		await moveSymbolToFile(
			project,
			oldFilePath,
			newFilePath,
			"featureAFunc",
			SyntaxKind.VariableStatement,
		);

		expect(getFileText(project, newFilePath)).toBe(
			`import { sharedUtil } from "./shared-logic";

export const featureAFunc = () => {
  return 'Feature A using ' + sharedUtil.value;
};
`,
		);
		expect(getFileText(project, oldFilePath)).toBe(
			`export const sharedUtil = { value: 'shared' }; // export しておく必要がある
export const anotherFunc = () => {
  return 'Another using ' + sharedUtil.value;
};`,
		);
		expect(getFileText(project, referencingFilePath)).toBe(
			`import { featureAFunc } from './feature-a';
console.log(featureAFunc());`,
		);
	});

	it("exportされていない内部依存シンボルが他からも参照される場合、元ファイルにexportが追加され、新しいファイルからインポートされる", async () => {
		const project = createInMemoryProjectWithDoubleQuotes();
		const oldFilePath = "/src/core-utils.ts";
		const newFilePath = "/src/ui-helper.ts";

		project.createSourceFile(
			oldFilePath,
			`const internalCalculator = (x: number) => x * x; // export なし

export const formatDisplayValue = (val: number) => {
  return \`Value: \${internalCalculator(val)}\`;
};

export const generateReport = (data: number[]) => {
  const total = data.reduce((sum, x) => sum + internalCalculator(x), 0);
  return \`Report Total: \${total}\`;
};`,
		);

		await moveSymbolToFile(
			project,
			oldFilePath,
			newFilePath,
			"formatDisplayValue",
			SyntaxKind.VariableStatement,
		);

		expect(getFileText(project, newFilePath)).toBe(
			`import { internalCalculator } from "./core-utils";

export const formatDisplayValue = (val: number) => {
  return \`Value: \${internalCalculator(val)}\`;
};
`,
		);
		expect(getFileText(project, oldFilePath)).toBe(
			`export const internalCalculator = (x: number) => x * x; // export なし
export const generateReport = (data: number[]) => {
  const total = data.reduce((sum, x) => sum + internalCalculator(x), 0);
  return \`Report Total: \${total}\`;
};`,
		);
	});

	it("移動したシンボルが移動元のファイル内で使われていた場合、移動元にインポート文が追加される", async () => {
		const project = createInMemoryProjectWithDoubleQuotes();
		const oldFilePath = "/src/original.ts";
		const newFilePath = "/src/helper.ts";

		project.createSourceFile(
			oldFilePath,
			`function helperFunc(): string {
  return 'Helper result';
}

export function mainFunc(): string {
  // helperFunc を使用
  const result = helperFunc();
  return \`Main using \${result}\`;
}`,
		);

		await moveSymbolToFile(
			project,
			oldFilePath,
			newFilePath,
			"helperFunc",
			SyntaxKind.FunctionDeclaration,
		);

		expect(getFileText(project, newFilePath).trim()).toBe(
			`export function helperFunc(): string {
  return 'Helper result';
}`,
		);
		// import 挿入時に関数本文内のコメントが保持されることを保証する
		expect(getFileText(project, oldFilePath).trim()).toBe(
			`import { helperFunc } from "./helper";

export function mainFunc(): string {
  // helperFunc を使用
  const result = helperFunc();
  return \`Main using \${result}\`;
}`,
		);
	});

	it("名前空間インポート (import * as) に依存するシンボルを移動する", async () => {
		const project = createInMemoryProjectWithDoubleQuotes();
		const oldFilePath = "/src/path-utils.ts";
		const newFilePath = "/src/moved-path-utils.ts";
		const referencingFilePath = "/src/main.ts";

		project.createSourceFile(
			oldFilePath,
			`import * as path from 'node:path';

export const resolvePath = (p1: string, p2: string): string => {
  return path.resolve(p1, p2);
};`,
		);
		project.createSourceFile(
			referencingFilePath,
			`import { resolvePath } from './path-utils';
const resolved = resolvePath('/foo', 'bar');
console.log(resolved);`,
		);

		await moveSymbolToFile(
			project,
			oldFilePath,
			newFilePath,
			"resolvePath",
			SyntaxKind.VariableStatement,
		);

		expect(getFileText(project, newFilePath)).toBe(
			`import * as path from "node:path";

export const resolvePath = (p1: string, p2: string): string => {
  return path.resolve(p1, p2);
};
`,
		);
		expect(getFileText(project, oldFilePath).trim()).toBe("");
		expect(getFileText(project, referencingFilePath)).toBe(
			`import { resolvePath } from './moved-path-utils';
const resolved = resolvePath('/foo', 'bar');
console.log(resolved);`,
		);
	});

	it("既存のファイルにシンボルを移動し、既存の内容とマージされる（移動元から既にインポートがある場合）", async () => {
		const project = createInMemoryProjectWithDoubleQuotes();
		const oldFilePath = "/src/source.ts";
		const existingFilePath = "/src/destination.ts";
		const referencingFilePath = "/src/user.ts";

		project.createSourceFile(
			oldFilePath,
			`export const alreadyImported = 'Imported before move';
export const moveMe = () => 'I was moved';`,
		);
		project.createSourceFile(
			existingFilePath,
			`import { alreadyImported } from './source';

export const keepMe = 'I was already here';

console.log('Existing code using:', alreadyImported);`,
		);
		project.createSourceFile(
			referencingFilePath,
			`import { moveMe } from './source';
console.log(moveMe());`,
		);

		await moveSymbolToFile(
			project,
			oldFilePath,
			existingFilePath,
			"moveMe",
			SyntaxKind.VariableStatement,
		);

		expect(getFileText(project, existingFilePath)).toBe(
			`import { alreadyImported } from './source';

export const keepMe = 'I was already here';

console.log('Existing code using:', alreadyImported);

export const moveMe = () => 'I was moved';`,
		);
		expect(getFileText(project, oldFilePath)).toBe(
			`export const alreadyImported = 'Imported before move';`,
		);
		expect(getFileText(project, referencingFilePath)).toBe(
			`import { moveMe } from './destination';
console.log(moveMe());`,
		);
	});
});
