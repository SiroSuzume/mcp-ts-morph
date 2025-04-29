import { Project } from "ts-morph";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as path from "node:path";
import { removePathAlias } from "./remove-path-alias";

const TEST_TSCONFIG_PATH = "/tsconfig.json";
const TEST_BASE_URL = "/src";
const TEST_PATHS = {
	"@/*": ["*"],
	"@components/*": ["components/*"],
	"@utils/helpers": ["utils/helpers.ts"],
};

let project: Project;

describe("removePathAlias", () => {
	beforeEach(() => {
		project = new Project({
			useInMemoryFileSystem: true,
			compilerOptions: {
				baseUrl: path.relative(path.dirname(TEST_TSCONFIG_PATH), TEST_BASE_URL),
				paths: TEST_PATHS,
			},
		});
		project.createSourceFile(
			TEST_TSCONFIG_PATH,
			JSON.stringify({
				compilerOptions: { baseUrl: "./src", paths: TEST_PATHS },
			}),
		);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("単純なワイルドカードエイリアス (@/*) を相対パスに変換できること", async () => {
		const importerPath = "/src/features/featureA/index.ts";
		const componentPath = "/src/components/Button.ts";
		project.createSourceFile(componentPath, "export const Button = {};");
		const importerContent = `import { Button } from '@/components/Button';`;
		project.createSourceFile(importerPath, importerContent);

		const result = await removePathAlias({
			project,
			targetPath: importerPath,
			baseUrl: TEST_BASE_URL,
			paths: TEST_PATHS,
			dryRun: false,
		});

		const sourceFile = project.getSourceFileOrThrow(importerPath);
		const importDeclaration = sourceFile.getImportDeclarations()[0];
		expect(importDeclaration?.getModuleSpecifierValue()).toBe(
			"../../components/Button",
		);
		expect(result.changedFiles).toEqual([importerPath]);
	});

	it("特定のパスエイリアス (@components/*) を相対パスに変換できること", async () => {
		const importerPath = "/src/index.ts";
		const componentPath = "/src/components/Input/index.ts";
		project.createSourceFile(componentPath, "export const Input = {};");
		const importerContent = `import { Input } from '@components/Input';`;
		project.createSourceFile(importerPath, importerContent);

		const result = await removePathAlias({
			project,
			targetPath: importerPath,
			baseUrl: TEST_BASE_URL,
			paths: TEST_PATHS,
			dryRun: false,
		});

		const sourceFile = project.getSourceFileOrThrow(importerPath);
		expect(
			sourceFile.getImportDeclarations()[0]?.getModuleSpecifierValue(),
		).toBe("./components/Input");
		expect(result.changedFiles).toEqual([importerPath]);
	});

	it("ファイルへの直接エイリアス (@utils/helpers) を相対パスに変換できること", async () => {
		const importerPath = "/src/features/featureB/utils.ts";
		const helperPath = "/src/utils/helpers.ts";
		project.createSourceFile(helperPath, "export const helperFunc = () => {};");
		const importerContent = `import { helperFunc } from '@utils/helpers';`;
		project.createSourceFile(importerPath, importerContent);

		const result = await removePathAlias({
			project,
			targetPath: importerPath,
			baseUrl: TEST_BASE_URL,
			paths: TEST_PATHS,
			dryRun: false,
		});

		const sourceFile = project.getSourceFileOrThrow(importerPath);
		expect(
			sourceFile.getImportDeclarations()[0]?.getModuleSpecifierValue(),
		).toBe("../../utils/helpers");
		expect(result.changedFiles).toEqual([importerPath]);
	});

	it("エイリアスでない通常の相対パスは変更しないこと", async () => {
		const importerPath = "/src/features/featureA/index.ts";
		const servicePath = "/src/features/featureA/service.ts";
		project.createSourceFile(servicePath, "export class Service {}");
		const importerContent = `import { Service } from './service';`;
		const sourceFile = project.createSourceFile(importerPath, importerContent);
		const originalContent = sourceFile.getFullText();

		const result = await removePathAlias({
			project,
			targetPath: importerPath,
			baseUrl: TEST_BASE_URL,
			paths: TEST_PATHS,
			dryRun: false,
		});

		expect(sourceFile.getFullText()).toBe(originalContent);
		expect(result.changedFiles).toEqual([]);
	});

	it("エイリアスでない node_modules パスは変更しないこと", async () => {
		const importerPath = "/src/index.ts";
		const importerContent = `import * as fs from 'fs';`;
		const sourceFile = project.createSourceFile(importerPath, importerContent);
		const originalContent = sourceFile.getFullText();

		const result = await removePathAlias({
			project,
			targetPath: importerPath,
			baseUrl: TEST_BASE_URL,
			paths: TEST_PATHS,
			dryRun: false,
		});

		expect(sourceFile.getFullText()).toBe(originalContent);
		expect(result.changedFiles).toEqual([]);
	});

	it("dryRun モードではファイルを変更せず、変更予定リストを返すこと", async () => {
		const importerPath = "/src/features/featureA/index.ts";
		const componentPath = "/src/components/Button.ts";
		project.createSourceFile(componentPath, "export const Button = {};");
		const importerContent = `import { Button } from '@/components/Button';`;
		const sourceFile = project.createSourceFile(importerPath, importerContent);
		const originalContent = sourceFile.getFullText();

		const result = await removePathAlias({
			project,
			targetPath: importerPath,
			baseUrl: TEST_BASE_URL,
			paths: TEST_PATHS,
			dryRun: true,
		});

		expect(sourceFile.getFullText()).toBe(originalContent);
		expect(result.changedFiles).toEqual([importerPath]);
	});

	it("ディレクトリを対象とした場合に、内部の複数ファイルのエイリアスを変換できること", async () => {
		const dirPath = "/src/features/multi";
		const file1Path = path.join(dirPath, "file1.ts");
		const file2Path = path.join(dirPath, "sub/file2.ts");
		const buttonPath = "/src/components/Button.ts";
		const inputPath = "/src/components/Input.ts";

		project.createSourceFile(buttonPath, "export const Button = {};");
		project.createSourceFile(inputPath, "export const Input = {};");
		project.createSourceFile(
			file1Path,
			"import { Button } from '@/components/Button';",
		);
		project.createSourceFile(
			file2Path,
			"import { Input } from '@components/Input';",
		);

		const result = await removePathAlias({
			project,
			targetPath: dirPath,
			baseUrl: TEST_BASE_URL,
			paths: TEST_PATHS,
			dryRun: false,
		});

		const file1 = project.getSourceFileOrThrow(file1Path);
		const file2 = project.getSourceFileOrThrow(file2Path);

		expect(file1.getImportDeclarations()[0]?.getModuleSpecifierValue()).toBe(
			"../../components/Button",
		);
		expect(file2.getImportDeclarations()[0]?.getModuleSpecifierValue()).toBe(
			"../../../components/Input",
		);
		expect(result.changedFiles.sort()).toEqual([file1Path, file2Path].sort());
	});

	it("解決できないエイリアスパスの場合は警告を出し、パスを変更しないこと", async () => {
		const importerPath = "/src/index.ts";
		const importerContent = `import { Something } from '@unknown/package';`;
		const sourceFile = project.createSourceFile(importerPath, importerContent);
		const originalContent = sourceFile.getFullText();

		const result = await removePathAlias({
			project,
			targetPath: importerPath,
			baseUrl: TEST_BASE_URL,
			paths: TEST_PATHS,
			dryRun: false,
		});

		expect(sourceFile.getFullText()).toBe(originalContent);
		expect(result.changedFiles).toEqual([]);
	});
});
