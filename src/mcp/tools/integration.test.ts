import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { registerTsMorphTools } from "./ts-morph-tools";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * テスト用の一時ディレクトリを作成
 */
function createTempDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "mcp-integration-test-"));
}

/**
 * ディレクトリを再帰的に削除
 */
function removeTempDir(dir: string): void {
	if (fs.existsSync(dir)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

/**
 * ツールの結果の型
 */
interface ToolResult {
	content: Array<{
		type: string;
		text: string;
	}>;
	isError?: boolean;
}

/**
 * ツールハンドラーの型
 */
type ToolHandler<T = unknown> = (args: T) => Promise<ToolResult>;

/**
 * MCPサーバーのモック
 */
interface MockServer {
	tool: <T>(
		name: string,
		description: string,
		schema: unknown,
		handler: (args: T) => Promise<unknown>,
	) => void;
	callTool: <T>(name: string, args: T) => Promise<ToolResult>;
}

/**
 * MCPサーバーのモックを作成
 */
function createMockServer(): MockServer {
	const tools = new Map<string, { handler: ToolHandler<unknown> }>();

	return {
		tool: <T>(
			name: string,
			_description: string,
			_schema: unknown, // z.ZodSchema<T>
			handler: (args: T) => Promise<unknown>,
		) => {
			tools.set(name, { handler: handler as ToolHandler<unknown> });
		},
		callTool: async <T>(name: string, args: T) => {
			const tool = tools.get(name);
			if (!tool) {
				throw new Error(`Tool ${name} not found`);
			}
			return await tool.handler(args);
		},
	};
}

describe("MCP Tools 統合テスト", () => {
	let tempDir: string;
	let tsconfigPath: string;
	let srcDir: string;
	let mockServer: MockServer;

	beforeEach(() => {
		tempDir = createTempDir();
		tsconfigPath = path.join(tempDir, "tsconfig.json");
		srcDir = path.join(tempDir, "src");
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
						baseUrl: ".",
						paths: {
							"@/*": ["src/*"],
						},
					},
					include: ["src/**/*"],
				},
				null,
				2,
			),
		);

		// モックサーバーを作成してツールを登録
		mockServer = createMockServer();
		// テスト用モックをMcpServerとしてキャスト
		// 実装を変更せずテスト側で対応
		registerTsMorphTools(mockServer as unknown as McpServer);
	});

	afterEach(() => {
		removeTempDir(tempDir);
	});

	describe("rename_symbol_by_tsmorph", () => {
		it("シンボルのリネームが正しく動作する", async () => {
			const utilsPath = path.join(srcDir, "utils.ts");
			const mainPath = path.join(srcDir, "main.ts");

			fs.writeFileSync(
				utilsPath,
				`export function calculateSum(a: number, b: number): number {
  return a + b;
}

export const VERSION = "1.0.0";
`,
			);

			fs.writeFileSync(
				mainPath,
				`import { calculateSum, VERSION } from "./utils";

const result = calculateSum(10, 20);
console.log(result);
console.log(VERSION);
`,
			);

			// rename_symbol_by_tsmorph ツールを呼び出し
			await mockServer.callTool("rename_symbol_by_tsmorph", {
				tsconfigPath,
				targetFilePath: utilsPath,
				position: { line: 1, column: 17 }, // "calculateSum" の位置
				symbolName: "calculateSum",
				newName: "addNumbers",
				dryRun: false,
			});

			// ファイルが更新されていることを確認
			const updatedUtilsContent = fs.readFileSync(utilsPath, "utf-8");
			const updatedMainContent = fs.readFileSync(mainPath, "utf-8");

			expect(updatedUtilsContent).toContain("function addNumbers");
			expect(updatedMainContent).toContain("import { addNumbers");
			expect(updatedMainContent).toContain("addNumbers(10, 20)");
		});

		it("dryRunモードで変更をプレビューできる", async () => {
			const filePath = path.join(srcDir, "test.ts");

			fs.writeFileSync(
				filePath,
				`const oldName = "test";
console.log(oldName);
`,
			);

			// dryRunモードで実行
			await mockServer.callTool("rename_symbol_by_tsmorph", {
				tsconfigPath,
				targetFilePath: filePath,
				position: { line: 1, column: 7 }, // "oldName" の位置
				symbolName: "oldName",
				newName: "newName",
				dryRun: true,
			});

			// ファイルが変更されていないことを確認
			const content = fs.readFileSync(filePath, "utf-8");
			expect(content).toContain("oldName");
			expect(content).not.toContain("newName");
		});
	});

	describe("find_references_by_tsmorph", () => {
		it("シンボルの参照を見つけることができる", async () => {
			const libPath = path.join(srcDir, "lib.ts");
			const app1Path = path.join(srcDir, "app1.ts");
			const app2Path = path.join(srcDir, "app2.ts");

			fs.writeFileSync(
				libPath,
				`export class Logger {
  log(message: string) {
    console.log(message);
  }
}

export const logger = new Logger();
`,
			);

			fs.writeFileSync(
				app1Path,
				`import { Logger } from "./lib";

const myLogger = new Logger();
myLogger.log("Hello from app1");
`,
			);

			fs.writeFileSync(
				app2Path,
				`import { logger } from "./lib";

logger.log("Hello from app2");
`,
			);

			// find_references_by_tsmorph ツールを呼び出し
			const result = await mockServer.callTool("find_references_by_tsmorph", {
				tsconfigPath,
				targetFilePath: libPath,
				position: { line: 1, column: 14 }, // "Logger" クラスの位置
			});

			expect(result).toBeDefined();
			// 結果の構造を確認（実際の実装に応じて調整）
			expect(result).toHaveProperty("content");
			const content = result.content[0]?.text || "";
			expect(content.toLowerCase()).toContain("reference");
		});
	});

	describe("remove_path_alias_by_tsmorph", () => {
		it("パスエイリアスを相対パスに変換できる", async () => {
			const utilsPath = path.join(srcDir, "utils", "math.ts");
			const appPath = path.join(srcDir, "app.ts");

			fs.mkdirSync(path.dirname(utilsPath), { recursive: true });

			fs.writeFileSync(
				utilsPath,
				`export function multiply(a: number, b: number): number {
  return a * b;
}
`,
			);

			fs.writeFileSync(
				appPath,
				`import { multiply } from "@/utils/math";

console.log(multiply(3, 4));
`,
			);

			// remove_path_alias_by_tsmorph ツールを呼び出し
			await mockServer.callTool("remove_path_alias_by_tsmorph", {
				tsconfigPath,
				targetPath: appPath,
				dryRun: false,
			});

			// パスエイリアスが相対パスに変換されていることを確認
			const updatedContent = fs.readFileSync(appPath, "utf-8");
			expect(updatedContent).toContain('from "./utils/math"');
			expect(updatedContent).not.toContain('from "@/utils/math"');
		});
	});

	describe("rename_filesystem_entry_by_tsmorph", () => {
		it("ファイル名を変更してインポートを更新できる", async () => {
			const oldPath = path.join(srcDir, "old-name.ts");
			const newPath = path.join(srcDir, "new-name.ts");
			const importerPath = path.join(srcDir, "importer.ts");

			fs.writeFileSync(oldPath, "export const data = { value: 42 };");

			fs.writeFileSync(
				importerPath,
				`import { data } from "./old-name";

console.log(data.value);
`,
			);

			// rename_filesystem_entry_by_tsmorph ツールを呼び出し
			await mockServer.callTool("rename_filesystem_entry_by_tsmorph", {
				tsconfigPath,
				renames: [{ oldPath, newPath }],
				dryRun: false,
			});

			// ファイルがリネームされていることを確認
			expect(fs.existsSync(newPath)).toBe(true);
			expect(fs.existsSync(oldPath)).toBe(false);

			// インポートが更新されていることを確認
			const updatedImporterContent = fs.readFileSync(importerPath, "utf-8");
			expect(updatedImporterContent).toContain('from "./new-name"');
		});
	});

	describe("move_symbol_to_file_by_tsmorph", () => {
		it("シンボルを別ファイルに移動できる", async () => {
			const sourcePath = path.join(srcDir, "source.ts");
			const targetPath = path.join(srcDir, "target.ts");
			const consumerPath = path.join(srcDir, "consumer.ts");

			fs.writeFileSync(
				sourcePath,
				`export function funcToMove() {
  return "moved";
}

export function funcToStay() {
  return "stayed";
}
`,
			);

			fs.writeFileSync(
				consumerPath,
				`import { funcToMove, funcToStay } from "./source";

console.log(funcToMove());
console.log(funcToStay());
`,
			);

			// move_symbol_to_file_by_tsmorph ツールを呼び出し
			await mockServer.callTool("move_symbol_to_file_by_tsmorph", {
				tsconfigPath,
				originalFilePath: sourcePath, // sourceFilePathではなくoriginalFilePath
				targetFilePath: targetPath,
				symbolToMove: "funcToMove", // symbolNameではなくsymbolToMove
				declarationKindString: "FunctionDeclaration",
				dryRun: false,
			});

			// ターゲットファイルが作成され、シンボルが移動していることを確認
			expect(fs.existsSync(targetPath)).toBe(true);
			const targetContent = fs.readFileSync(targetPath, "utf-8");
			expect(targetContent).toContain("function funcToMove");

			// ソースファイルからシンボルが削除されていることを確認
			const sourceContent = fs.readFileSync(sourcePath, "utf-8");
			expect(sourceContent).not.toContain("function funcToMove");
			expect(sourceContent).toContain("function funcToStay");

			// コンシューマーのインポートが更新されていることを確認
			const consumerContent = fs.readFileSync(consumerPath, "utf-8");
			expect(consumerContent).toContain('from "./target"');
			expect(consumerContent).toContain('from "./source"');
		});
	});

	describe("change_signature_by_tsmorph", () => {
		it("先頭に必須パラメータを追加し、呼び出し側を更新する", async () => {
			const utilsPath = path.join(srcDir, "utils.ts");
			const consumerPath = path.join(srcDir, "consumer.ts");

			fs.writeFileSync(
				utilsPath,
				`export function greet(name: string): string {
  return "hello " + name;
}
`,
			);
			fs.writeFileSync(
				consumerPath,
				`import { greet } from "./utils";

console.log(greet("world"));
console.log(greet("there"));
`,
			);

			const result = await mockServer.callTool("change_signature_by_tsmorph", {
				tsconfigPath,
				targetFilePath: utilsPath,
				position: { line: 1, column: 17 }, // "greet" の位置
				functionName: "greet",
				changes: [
					{
						kind: "add",
						index: 0,
						name: "lang",
						typeText: "string",
						argumentForCallers: '"en"',
					},
				],
				dryRun: false,
			});

			expect(result).toHaveProperty("isError", false);
			const updatedUtils = fs.readFileSync(utilsPath, "utf-8");
			const updatedConsumer = fs.readFileSync(consumerPath, "utf-8");

			expect(updatedUtils).toContain(
				"function greet(lang: string, name: string)",
			);
			expect(updatedConsumer).toContain('greet("en", "world")');
			expect(updatedConsumer).toContain('greet("en", "there")');
		});

		it("dryRun ではファイルを変更しない", async () => {
			const filePath = path.join(srcDir, "fn.ts");
			fs.writeFileSync(
				filePath,
				`export function foo(a: number) { return a; }
foo(1);
`,
			);

			const result = await mockServer.callTool("change_signature_by_tsmorph", {
				tsconfigPath,
				targetFilePath: filePath,
				position: { line: 1, column: 17 },
				functionName: "foo",
				changes: [{ kind: "remove", index: 0 }],
				dryRun: true,
			});

			expect(result).toHaveProperty("isError", false);
			const content = fs.readFileSync(filePath, "utf-8");
			expect(content).toContain("function foo(a: number)");
			expect(content).toContain("foo(1);");
		});
	});

	describe("get_type_at_position_by_tsmorph", () => {
		it("変数の型情報を取得できる", async () => {
			const filePath = path.join(srcDir, "types.ts");
			fs.writeFileSync(
				filePath,
				`const user = { id: "u1", name: "alice" };
console.log(user);
`,
			);

			const result = await mockServer.callTool(
				"get_type_at_position_by_tsmorph",
				{
					tsconfigPath,
					targetFilePath: filePath,
					position: { line: 2, column: 13 }, // "user" inside console.log
				},
			);

			expect(result).toHaveProperty("isError", false);
			const text = result.content[0]?.text || "";
			expect(text).toContain("Type:");
			expect(text).toContain("id: string");
			expect(text).toContain("name: string");
			expect(text).toContain("Symbol: user (VariableDeclaration)");
			expect(text).toContain(`Declared at: ${filePath}:1:`);
		});

		it("関数のシグネチャを call style で展開する", async () => {
			const filePath = path.join(srcDir, "fn.ts");
			fs.writeFileSync(
				filePath,
				`function greet(name: string): string {
  return "hello " + name;
}
greet("world");
`,
			);

			const result = await mockServer.callTool(
				"get_type_at_position_by_tsmorph",
				{
					tsconfigPath,
					targetFilePath: filePath,
					position: { line: 4, column: 1 },
				},
			);

			expect(result).toHaveProperty("isError", false);
			const text = result.content[0]?.text || "";
			expect(text).toContain("(name: string) => string");
		});

		it("import された symbol の宣言位置は元ファイル", async () => {
			const libPath = path.join(srcDir, "lib.ts");
			const appPath = path.join(srcDir, "app.ts");
			fs.writeFileSync(
				libPath,
				`export function helper(n: number): string { return String(n); }
`,
			);
			fs.writeFileSync(
				appPath,
				`import { helper } from "./lib";
helper(1);
`,
			);

			const result = await mockServer.callTool(
				"get_type_at_position_by_tsmorph",
				{
					tsconfigPath,
					targetFilePath: appPath,
					position: { line: 2, column: 1 },
				},
			);

			expect(result).toHaveProperty("isError", false);
			const text = result.content[0]?.text || "";
			expect(text).toContain("Symbol: helper");
			expect(text).toContain(`Declared at: ${libPath}:1:`);
		});

		it("範囲外の位置でエラー", async () => {
			const filePath = path.join(srcDir, "small.ts");
			fs.writeFileSync(filePath, "const x = 1;\n");

			const result = await mockServer.callTool(
				"get_type_at_position_by_tsmorph",
				{
					tsconfigPath,
					targetFilePath: filePath,
					position: { line: 99, column: 1 },
				},
			);

			expect(result).toHaveProperty("isError", true);
			expect(result.content[0]?.text).toContain("Error");
		});
	});

	describe("find_unused_exports_by_tsmorph", () => {
		it("どこからも import されない export を候補として列挙する", async () => {
			const aPath = path.join(srcDir, "a.ts");
			const bPath = path.join(srcDir, "b.ts");
			fs.writeFileSync(
				aPath,
				`export function used(): void {}
export function unused(): void {}
`,
			);
			fs.writeFileSync(
				bPath,
				`import { used } from "./a";
used();
`,
			);

			const result = await mockServer.callTool(
				"find_unused_exports_by_tsmorph",
				{ tsconfigPath },
			);

			expect(result).toHaveProperty("isError", false);
			const text = result.content[0]?.text || "";
			expect(text).toContain("Unused export candidates");
			expect(text).toContain("unused (FunctionDeclaration)");
			expect(text).not.toContain(" used (");
		});

		it("候補ゼロの場合は明示的に伝える", async () => {
			const aPath = path.join(srcDir, "a.ts");
			const bPath = path.join(srcDir, "b.ts");
			fs.writeFileSync(aPath, "export function used(): void {}\n");
			fs.writeFileSync(bPath, 'import { used } from "./a";\nused();\n');

			const result = await mockServer.callTool(
				"find_unused_exports_by_tsmorph",
				{ tsconfigPath },
			);

			expect(result).toHaveProperty("isError", false);
			const text = result.content[0]?.text || "";
			expect(text).toContain("No unused exports found");
		});

		it("entryPoints の export は対象外", async () => {
			const publicPath = path.join(srcDir, "public.ts");
			const internalPath = path.join(srcDir, "internal.ts");
			fs.writeFileSync(publicPath, "export function publicFn(): void {}\n");
			fs.writeFileSync(internalPath, "export function internalFn(): void {}\n");

			const result = await mockServer.callTool(
				"find_unused_exports_by_tsmorph",
				{ tsconfigPath, entryPoints: [publicPath] },
			);

			expect(result).toHaveProperty("isError", false);
			const text = result.content[0]?.text || "";
			expect(text).toContain("internalFn");
			expect(text).not.toContain("publicFn");
		});
	});

	describe("エラーハンドリング", () => {
		it("存在しないファイルに対してエラーを返す", async () => {
			const nonExistentPath = path.join(srcDir, "non-existent.ts");

			const result = await mockServer.callTool("rename_symbol_by_tsmorph", {
				tsconfigPath,
				targetFilePath: nonExistentPath,
				position: { line: 1, column: 1 },
				symbolName: "test",
				newName: "renamed",
				dryRun: false,
			});

			// MCPツールはエラーを返すが、throwしない
			expect(result).toHaveProperty("isError", true);
			expect(result.content[0]?.text).toContain("Error");
		});

		it("不正なシンボル名でエラーを返す", async () => {
			const testPath = path.join(srcDir, "test.ts");

			fs.writeFileSync(testPath, `const validName = "test";`);

			const result = await mockServer.callTool("rename_symbol_by_tsmorph", {
				tsconfigPath,
				targetFilePath: testPath,
				position: { line: 1, column: 7 },
				symbolName: "wrongName", // 実際のシンボル名と異なる
				newName: "renamed",
				dryRun: false,
			});

			// MCPツールはエラーを返すが、throwしない
			expect(result).toHaveProperty("isError", true);
			expect(result.content[0]?.text).toContain("Error");
		});
	});
});
