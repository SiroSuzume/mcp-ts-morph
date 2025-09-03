import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { findSymbolReferences } from "./find-references";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

/**
 * テスト用の一時ディレクトリを作成
 */
function createTempDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "find-references-test-"));
}

/**
 * ディレクトリを再帰的に削除
 */
function removeTempDir(dir: string): void {
	if (fs.existsSync(dir)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

describe("findSymbolReferences", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = createTempDir();
	});

	afterEach(() => {
		removeTempDir(tempDir);
	});

	it("基本的な変数の参照を見つけることができる", async () => {
		// ファイルシステムにテストプロジェクトを作成
		const tsconfigPath = path.join(tempDir, "tsconfig.json");
		const srcDir = path.join(tempDir, "src");
		fs.mkdirSync(srcDir, { recursive: true });

		// tsconfig.json を作成
		fs.writeFileSync(
			tsconfigPath,
			JSON.stringify(
				{
					compilerOptions: {
						rootDir: "./src",
						outDir: "./dist",
						module: "commonjs",
						target: "es2020",
						strict: true,
					},
					include: ["src/**/*"],
				},
				null,
				2,
			),
		);

		// テストファイルを作成
		const utilsPath = path.join(srcDir, "utils.ts");
		const mainPath = path.join(srcDir, "main.ts");

		fs.writeFileSync(
			utilsPath,
			`export const myVariable = "test value";

export function helperFunction() {
  return myVariable;
}
`,
		);

		fs.writeFileSync(
			mainPath,
			`import { myVariable, helperFunction } from "./utils";

console.log(myVariable);
const result = helperFunction();
`,
		);

		// myVariable の参照を検索（定義位置）
		const result = await findSymbolReferences({
			tsconfigPath,
			targetFilePath: utilsPath,
			position: { line: 1, column: 14 }, // "myVariable" の位置
		});

		// 定義位置の確認
		expect(result.definition).toBeTruthy();
		expect(result.definition?.filePath).toBe(utilsPath);
		expect(result.definition?.line).toBe(1);
		expect(result.definition?.text).toContain("myVariable");

		// 参照箇所の確認（定義箇所は除外される）
		// インポート文での参照も含まれる
		expect(result.references.length).toBeGreaterThanOrEqual(2);

		// utils.ts内での参照
		const utilsRef = result.references.find(
			(ref) => ref.filePath === utilsPath && ref.line === 4,
		);
		expect(utilsRef).toBeTruthy();

		// main.ts内での参照（インポート文とconsole.log）
		const mainRefs = result.references.filter(
			(ref) => ref.filePath === mainPath,
		);
		expect(mainRefs.length).toBeGreaterThanOrEqual(1);

		// console.logでの参照が含まれていることを確認
		const consoleLogRef = mainRefs.find((ref) => ref.line === 3);
		expect(consoleLogRef).toBeTruthy();
	});

	it("関数の参照を見つけることができる", async () => {
		const tsconfigPath = path.join(tempDir, "tsconfig.json");
		const srcDir = path.join(tempDir, "src");
		fs.mkdirSync(srcDir, { recursive: true });

		fs.writeFileSync(
			tsconfigPath,
			JSON.stringify(
				{
					compilerOptions: {
						rootDir: "./src",
						outDir: "./dist",
						module: "commonjs",
						target: "es2020",
						strict: true,
					},
					include: ["src/**/*"],
				},
				null,
				2,
			),
		);

		const functionsPath = path.join(srcDir, "functions.ts");
		const usagePath = path.join(srcDir, "usage.ts");

		fs.writeFileSync(
			functionsPath,
			`export function calculate(a: number, b: number): number {
  return a + b;
}

export function processData() {
  const result = calculate(10, 20);
  return result;
}
`,
		);

		fs.writeFileSync(
			usagePath,
			`import { calculate, processData } from "./functions";

const sum = calculate(5, 3);
console.log(sum);
processData();
`,
		);

		// calculate 関数の参照を検索
		const result = await findSymbolReferences({
			tsconfigPath,
			targetFilePath: functionsPath,
			position: { line: 1, column: 17 }, // "calculate" の位置
		});

		expect(result.definition).toBeTruthy();
		expect(result.definition?.filePath).toBe(functionsPath);

		// 参照箇所（定義を除く）
		// インポート文での参照も含まれる
		expect(result.references.length).toBeGreaterThanOrEqual(2);

		// functions.ts内での参照
		const internalRef = result.references.find(
			(ref) => ref.filePath === functionsPath && ref.line === 6,
		);
		expect(internalRef).toBeTruthy();

		// usage.ts内での参照
		const externalRefs = result.references.filter(
			(ref) => ref.filePath === usagePath,
		);
		expect(externalRefs.length).toBeGreaterThanOrEqual(1);

		// calculate(5, 3)の呼び出しが含まれていることを確認
		const callRef = externalRefs.find((ref) => ref.line === 3);
		expect(callRef).toBeTruthy();
	});

	it("クラスの参照を見つけることができる", async () => {
		const tsconfigPath = path.join(tempDir, "tsconfig.json");
		const srcDir = path.join(tempDir, "src");
		fs.mkdirSync(srcDir, { recursive: true });

		fs.writeFileSync(
			tsconfigPath,
			JSON.stringify(
				{
					compilerOptions: {
						rootDir: "./src",
						outDir: "./dist",
						module: "commonjs",
						target: "es2020",
						strict: true,
					},
					include: ["src/**/*"],
				},
				null,
				2,
			),
		);

		const modelsPath = path.join(srcDir, "models.ts");
		const appPath = path.join(srcDir, "app.ts");

		fs.writeFileSync(
			modelsPath,
			`export class User {
  constructor(public name: string, public age: number) {}
  
  greet(): string {
    return \`Hello, I'm \${this.name}\`;
  }
}

export class Admin extends User {
  constructor(name: string, age: number, public role: string) {
    super(name, age);
  }
}
`,
		);

		fs.writeFileSync(
			appPath,
			`import { User, Admin } from "./models";

const user = new User("John", 30);
const admin = new Admin("Jane", 25, "super-admin");

console.log(user.greet());
`,
		);

		// User クラスの参照を検索
		const result = await findSymbolReferences({
			tsconfigPath,
			targetFilePath: modelsPath,
			position: { line: 1, column: 14 }, // "User" の位置
		});

		expect(result.definition).toBeTruthy();
		expect(result.definition?.filePath).toBe(modelsPath);

		// 参照箇所
		expect(result.references.length).toBeGreaterThanOrEqual(2);

		// Admin クラスでの継承
		const extendsRef = result.references.find(
			(ref) => ref.filePath === modelsPath && ref.text.includes("extends"),
		);
		expect(extendsRef).toBeTruthy();

		// app.tsでのインスタンス化
		const instantiationRef = result.references.find(
			(ref) => ref.filePath === appPath && ref.text.includes("new User"),
		);
		expect(instantiationRef).toBeTruthy();
	});

	it("存在しないシンボルに対してエラーをスローする", async () => {
		const tsconfigPath = path.join(tempDir, "tsconfig.json");
		const srcDir = path.join(tempDir, "src");
		fs.mkdirSync(srcDir, { recursive: true });

		fs.writeFileSync(
			tsconfigPath,
			JSON.stringify(
				{
					compilerOptions: {
						rootDir: "./src",
						outDir: "./dist",
						module: "commonjs",
						target: "es2020",
						strict: true,
					},
					include: ["src/**/*"],
				},
				null,
				2,
			),
		);

		const testPath = path.join(srcDir, "test.ts");
		fs.writeFileSync(
			testPath,
			`const someVariable = "test";
`,
		);

		// 存在しない位置を指定
		await expect(
			findSymbolReferences({
				tsconfigPath,
				targetFilePath: testPath,
				position: { line: 10, column: 1 }, // 存在しない行
			}),
		).rejects.toThrow();
	});

	it("re-exportされたシンボルの参照を見つけることができる", async () => {
		const tsconfigPath = path.join(tempDir, "tsconfig.json");
		const srcDir = path.join(tempDir, "src");
		fs.mkdirSync(srcDir, { recursive: true });

		fs.writeFileSync(
			tsconfigPath,
			JSON.stringify(
				{
					compilerOptions: {
						rootDir: "./src",
						outDir: "./dist",
						module: "commonjs",
						target: "es2020",
						strict: true,
					},
					include: ["src/**/*"],
				},
				null,
				2,
			),
		);

		const utilsPath = path.join(srcDir, "utils.ts");
		const indexPath = path.join(srcDir, "index.ts");
		const appPath = path.join(srcDir, "app.ts");

		// utils.ts - オリジナルの定義
		fs.writeFileSync(
			utilsPath,
			`export function helper() {
  return "helper function";
}

export const CONSTANT = 42;
`,
		);

		// index.ts - re-export
		fs.writeFileSync(
			indexPath,
			`export { helper, CONSTANT } from "./utils";
export { helper as utilHelper } from "./utils"; // 別名でのre-export
`,
		);

		// app.ts - re-export経由での使用
		fs.writeFileSync(
			appPath,
			`import { helper, CONSTANT, utilHelper } from "./index";

console.log(helper());
console.log(CONSTANT);
console.log(utilHelper());
`,
		);

		// helper関数の参照を検索
		const result = await findSymbolReferences({
			tsconfigPath,
			targetFilePath: utilsPath,
			position: { line: 1, column: 17 }, // "helper" の位置
		});

		expect(result.definition).toBeTruthy();
		expect(result.definition?.filePath).toBe(utilsPath);

		// re-export文とインポート文、使用箇所での参照を含む
		expect(result.references.length).toBeGreaterThanOrEqual(3);

		// index.tsでのre-export
		const reExportRefs = result.references.filter(
			(ref) => ref.filePath === indexPath,
		);
		expect(reExportRefs.length).toBeGreaterThanOrEqual(2); // 通常のre-exportと別名でのre-export

		// app.tsでの使用
		const appRefs = result.references.filter((ref) => ref.filePath === appPath);
		expect(appRefs.length).toBeGreaterThanOrEqual(1);
	});

	it("循環参照があるファイル間での参照を見つけることができる", async () => {
		const tsconfigPath = path.join(tempDir, "tsconfig.json");
		const srcDir = path.join(tempDir, "src");
		fs.mkdirSync(srcDir, { recursive: true });

		fs.writeFileSync(
			tsconfigPath,
			JSON.stringify(
				{
					compilerOptions: {
						rootDir: "./src",
						outDir: "./dist",
						module: "commonjs",
						target: "es2020",
						strict: true,
					},
					include: ["src/**/*"],
				},
				null,
				2,
			),
		);

		const moduleAPath = path.join(srcDir, "moduleA.ts");
		const moduleBPath = path.join(srcDir, "moduleB.ts");

		// moduleA.ts - moduleBを参照
		fs.writeFileSync(
			moduleAPath,
			`import { functionB } from "./moduleB";

export function functionA() {
  return "A";
}

export function useB() {
  return functionB();
}
`,
		);

		// moduleB.ts - moduleAを参照（循環参照）
		fs.writeFileSync(
			moduleBPath,
			`import { functionA } from "./moduleA";

export function functionB() {
  return "B";
}

export function useA() {
  return functionA();
}
`,
		);

		// functionAの参照を検索
		const result = await findSymbolReferences({
			tsconfigPath,
			targetFilePath: moduleAPath,
			position: { line: 3, column: 17 }, // "functionA" の位置
		});

		expect(result.definition).toBeTruthy();
		expect(result.definition?.filePath).toBe(moduleAPath);

		// moduleBからの参照を確認
		const moduleBRefs = result.references.filter(
			(ref) => ref.filePath === moduleBPath,
		);
		expect(moduleBRefs.length).toBeGreaterThanOrEqual(1);

		// useA関数内での使用を確認
		const useARef = moduleBRefs.find((ref) => ref.text.includes("functionA()"));
		expect(useARef).toBeTruthy();
	});

	it("インターフェースの参照を見つけることができる", async () => {
		const tsconfigPath = path.join(tempDir, "tsconfig.json");
		const srcDir = path.join(tempDir, "src");
		fs.mkdirSync(srcDir, { recursive: true });

		fs.writeFileSync(
			tsconfigPath,
			JSON.stringify(
				{
					compilerOptions: {
						rootDir: "./src",
						outDir: "./dist",
						module: "commonjs",
						target: "es2020",
						strict: true,
					},
					include: ["src/**/*"],
				},
				null,
				2,
			),
		);

		const typesPath = path.join(srcDir, "types.ts");
		const implementationPath = path.join(srcDir, "implementation.ts");

		fs.writeFileSync(
			typesPath,
			`export interface UserData {
  id: number;
  name: string;
  email: string;
}

export interface AdminData extends UserData {
  role: string;
}
`,
		);

		fs.writeFileSync(
			implementationPath,
			`import { UserData, AdminData } from "./types";

function processUser(user: UserData): void {
  console.log(user.name);
}

const userData: UserData = {
  id: 1,
  name: "John",
  email: "john@example.com"
};

const adminData: AdminData = {
  id: 2,
  name: "Jane",
  email: "jane@example.com",
  role: "admin"
};

processUser(userData);
processUser(adminData);
`,
		);

		// UserData インターフェースの参照を検索
		const result = await findSymbolReferences({
			tsconfigPath,
			targetFilePath: typesPath,
			position: { line: 1, column: 18 }, // "UserData" の位置
		});

		expect(result.definition).toBeTruthy();
		expect(result.definition?.filePath).toBe(typesPath);

		// 参照箇所を確認
		expect(result.references.length).toBeGreaterThanOrEqual(3);

		// types.ts内での継承での参照
		const extendsRef = result.references.find(
			(ref) => ref.filePath === typesPath && ref.text.includes("extends"),
		);
		expect(extendsRef).toBeTruthy();

		// implementation.ts内での型注釈での参照
		const typeAnnotationRefs = result.references.filter(
			(ref) => ref.filePath === implementationPath,
		);
		expect(typeAnnotationRefs.length).toBeGreaterThanOrEqual(2); // 関数パラメータと変数宣言
	});
});
