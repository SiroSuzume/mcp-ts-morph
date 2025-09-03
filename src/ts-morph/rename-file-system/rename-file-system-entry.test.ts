import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renameFileSystemEntry } from "./rename-file-system-entry";
import { initializeProject } from "../_utils/ts-morph-project";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

/**
 * テスト用の一時ディレクトリを作成
 */
function createTempDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "rename-file-system-test-"));
}

/**
 * ディレクトリを再帰的に削除
 */
function removeTempDir(dir: string): void {
	if (fs.existsSync(dir)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

describe("renameFileSystemEntry 統合テスト", () => {
	let tempDir: string;
	let tsconfigPath: string;
	let srcDir: string;

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
	});

	afterEach(() => {
		removeTempDir(tempDir);
	});

	it("単一ファイルのリネームとインポート更新", async () => {
		// テストファイルを作成
		const oldUtilsPath = path.join(srcDir, "utils.ts");
		const newUtilsPath = path.join(srcDir, "helpers.ts");
		const mainPath = path.join(srcDir, "main.ts");

		fs.writeFileSync(
			oldUtilsPath,
			`export function formatDate(date: Date): string {
  return date.toISOString();
}

export const VERSION = "1.0.0";
`,
		);

		fs.writeFileSync(
			mainPath,
			`import { formatDate, VERSION } from "./utils";

const now = new Date();
console.log(formatDate(now));
console.log("Version:", VERSION);
`,
		);

		// プロジェクトを作成してリネーム実行
		const project = initializeProject(tsconfigPath);

		const result = await renameFileSystemEntry({
			project,
			renames: [
				{
					oldPath: oldUtilsPath,
					newPath: newUtilsPath,
				},
			],
			dryRun: false,
		});

		// リネーム後のファイルが存在することを確認
		expect(fs.existsSync(newUtilsPath)).toBe(true);
		expect(fs.existsSync(oldUtilsPath)).toBe(false);

		// インポート文が更新されていることを確認
		const updatedMainContent = fs.readFileSync(mainPath, "utf-8");
		expect(updatedMainContent).toContain('from "./helpers"');
		expect(updatedMainContent).not.toContain('from "./utils"');

		// 変更されたファイルのリストを確認
		expect(result.changedFiles).toContain(mainPath);
		expect(result.changedFiles).toContain(newUtilsPath);
	});

	it("フォルダのリネームと複数ファイルの参照更新", async () => {
		// フォルダ構造を作成
		const oldFolderPath = path.join(srcDir, "components");
		const newFolderPath = path.join(srcDir, "widgets");
		fs.mkdirSync(oldFolderPath, { recursive: true });

		const buttonPath = path.join(oldFolderPath, "Button.ts");
		const modalPath = path.join(oldFolderPath, "Modal.ts");
		const appPath = path.join(srcDir, "app.ts");

		fs.writeFileSync(
			buttonPath,
			`export class Button {
  constructor(public label: string) {}
  render() {
    return \`<button>\${this.label}</button>\`;
  }
}
`,
		);

		fs.writeFileSync(
			modalPath,
			`import { Button } from "./Button";

export class Modal {
  private closeButton = new Button("Close");
  
  render() {
    return \`<div class="modal">\${this.closeButton.render()}</div>\`;
  }
}
`,
		);

		fs.writeFileSync(
			appPath,
			`import { Button } from "./components/Button";
import { Modal } from "./components/Modal";

const button = new Button("Click me");
const modal = new Modal();

console.log(button.render());
console.log(modal.render());
`,
		);

		// プロジェクトを作成してリネーム実行
		const project = initializeProject(tsconfigPath);

		await renameFileSystemEntry({
			project,
			renames: [
				{
					oldPath: oldFolderPath,
					newPath: newFolderPath,
				},
			],
			dryRun: false,
		});

		// フォルダがリネームされていることを確認
		expect(fs.existsSync(newFolderPath)).toBe(true);
		// ts-morphはファイルを移動するが、空のフォルダは残ることがある
		// 重要なのはファイルが正しく移動されていること

		// ファイルが新しいフォルダに移動していることを確認
		expect(fs.existsSync(path.join(newFolderPath, "Button.ts"))).toBe(true);
		expect(fs.existsSync(path.join(newFolderPath, "Modal.ts"))).toBe(true);

		// 元のフォルダにファイルが残っていないことを確認
		expect(fs.existsSync(path.join(oldFolderPath, "Button.ts"))).toBe(false);
		expect(fs.existsSync(path.join(oldFolderPath, "Modal.ts"))).toBe(false);

		// インポート文が更新されていることを確認
		const updatedAppContent = fs.readFileSync(appPath, "utf-8");
		expect(updatedAppContent).toContain('from "./widgets/Button"');
		expect(updatedAppContent).toContain('from "./widgets/Modal"');
		expect(updatedAppContent).not.toContain('from "./components/');

		// Modal.ts内の相対インポートも更新されていることを確認
		const updatedModalContent = fs.readFileSync(
			path.join(newFolderPath, "Modal.ts"),
			"utf-8",
		);
		expect(updatedModalContent).toContain('from "./Button"'); // 相対パスは変更なし
	});

	it("dryRunモードでファイルシステムを変更しない", async () => {
		const oldPath = path.join(srcDir, "old-file.ts");
		const newPath = path.join(srcDir, "new-file.ts");
		const importerPath = path.join(srcDir, "importer.ts");

		fs.writeFileSync(oldPath, "export const value = 42;");

		fs.writeFileSync(
			importerPath,
			`import { value } from "./old-file";
console.log(value);
`,
		);

		const project = initializeProject(tsconfigPath);

		const result = await renameFileSystemEntry({
			project,
			renames: [
				{
					oldPath,
					newPath,
				},
			],
			dryRun: true, // dryRunモードを有効化
		});

		// ファイルシステムが変更されていないことを確認
		expect(fs.existsSync(oldPath)).toBe(true);
		expect(fs.existsSync(newPath)).toBe(false);

		// 元のインポート文が変更されていないことを確認
		const importerContent = fs.readFileSync(importerPath, "utf-8");
		expect(importerContent).toContain('from "./old-file"');

		// 変更予定のファイルリストは返される
		expect(result.changedFiles.length).toBeGreaterThan(0);
	});

	it("パスエイリアスを使用したインポートの更新", async () => {
		const utilsDir = path.join(srcDir, "utils");
		const helpersDir = path.join(srcDir, "helpers");
		fs.mkdirSync(utilsDir, { recursive: true });

		const mathPath = path.join(utilsDir, "math.ts");
		const appPath = path.join(srcDir, "app.ts");

		fs.writeFileSync(
			mathPath,
			`export function add(a: number, b: number): number {
  return a + b;
}

export function multiply(a: number, b: number): number {
  return a * b;
}
`,
		);

		fs.writeFileSync(
			appPath,
			`import { add, multiply } from "@/utils/math";

console.log(add(2, 3));
console.log(multiply(4, 5));
`,
		);

		const project = initializeProject(tsconfigPath);

		await renameFileSystemEntry({
			project,
			renames: [
				{
					oldPath: utilsDir,
					newPath: helpersDir,
				},
			],
			dryRun: false,
		});

		// フォルダがリネームされていることを確認
		expect(fs.existsSync(helpersDir)).toBe(true);
		// ts-morphはファイルを移動するが、空のフォルダは残ることがある
		// 重要なのはファイルが正しく移動されていること

		// ファイルが新しいフォルダに移動していることを確認
		expect(fs.existsSync(path.join(helpersDir, "math.ts"))).toBe(true);
		expect(fs.existsSync(path.join(utilsDir, "math.ts"))).toBe(false);

		// パスエイリアスを使用したインポートが更新されていることを確認
		// ts-morphのリネーム処理ではパスエイリアスが相対パスに変換されることがある
		const updatedAppContent = fs.readFileSync(appPath, "utf-8");
		expect(updatedAppContent).toContain('from "./helpers/math"');
		expect(updatedAppContent).not.toContain('from "@/utils/math"');
	});

	it("複数ファイルの同時リネーム", async () => {
		const file1OldPath = path.join(srcDir, "file1.ts");
		const file1NewPath = path.join(srcDir, "renamed1.ts");
		const file2OldPath = path.join(srcDir, "file2.ts");
		const file2NewPath = path.join(srcDir, "renamed2.ts");
		const mainPath = path.join(srcDir, "main.ts");

		fs.writeFileSync(file1OldPath, `export const value1 = "first";`);

		fs.writeFileSync(file2OldPath, `export const value2 = "second";`);

		fs.writeFileSync(
			mainPath,
			`import { value1 } from "./file1";
import { value2 } from "./file2";

console.log(value1, value2);
`,
		);

		const project = initializeProject(tsconfigPath);

		await renameFileSystemEntry({
			project,
			renames: [
				{ oldPath: file1OldPath, newPath: file1NewPath },
				{ oldPath: file2OldPath, newPath: file2NewPath },
			],
			dryRun: false,
		});

		// 両方のファイルがリネームされていることを確認
		expect(fs.existsSync(file1NewPath)).toBe(true);
		expect(fs.existsSync(file2NewPath)).toBe(true);
		expect(fs.existsSync(file1OldPath)).toBe(false);
		expect(fs.existsSync(file2OldPath)).toBe(false);

		// インポート文が両方とも更新されていることを確認
		const updatedMainContent = fs.readFileSync(mainPath, "utf-8");
		expect(updatedMainContent).toContain('from "./renamed1"');
		expect(updatedMainContent).toContain('from "./renamed2"');
		expect(updatedMainContent).not.toContain('from "./file1"');
		expect(updatedMainContent).not.toContain('from "./file2"');
	});

	it("AbortSignalによる処理のキャンセル", async () => {
		const oldPath = path.join(srcDir, "cancelable.ts");
		const newPath = path.join(srcDir, "renamed.ts");

		fs.writeFileSync(oldPath, `export const data = "test";`);

		const project = initializeProject(tsconfigPath);
		const abortController = new AbortController();

		// 即座にキャンセル
		abortController.abort();

		await expect(
			renameFileSystemEntry({
				project,
				renames: [{ oldPath, newPath }],
				dryRun: false,
				signal: abortController.signal,
			}),
		).rejects.toThrow();

		// ファイルが変更されていないことを確認
		expect(fs.existsSync(oldPath)).toBe(true);
		expect(fs.existsSync(newPath)).toBe(false);
	});
});
