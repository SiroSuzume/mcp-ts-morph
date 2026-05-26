import { describe, it, expect, vi } from "vitest";
import type { ImportDeclaration } from "ts-morph";
import { createInMemoryProject } from "../_test-utils/create-in-memory-project";
import type { DeclarationToUpdate, RenameOperation } from "../types";
import { updateModuleSpecifiers } from "./update-module-specifiers";

vi.mock("../../utils/logger");

const refOp = (
	sourceFile: RenameOperation["sourceFile"],
	oldPath: string,
	newPath: string,
): RenameOperation => ({ sourceFile, oldPath, newPath });

describe("updateModuleSpecifiers", () => {
	it("通常の import 文を新しいパスに書き換える", () => {
		const project = createInMemoryProject();
		const target = project.createSourceFile(
			"/src/old.ts",
			"export const a = 1;",
		);
		const importer = project.createSourceFile(
			"/src/importer.ts",
			'import { a } from "./old";\nconsole.log(a);',
		);
		const importDecl = importer.getImportDeclarations()[0];

		updateModuleSpecifiers(
			[
				{
					declaration: importDecl,
					resolvedPath: "/src/old.ts",
					referencingFilePath: "/src/importer.ts",
					originalSpecifierText: "./old",
				},
			],
			[refOp(target, "/src/old.ts", "/src/new.ts")],
		);

		expect(importDecl.getModuleSpecifierValue()).toBe("./new");
	});

	it("module specifier がない declaration はスキップし、宣言を変更しない", () => {
		const project = createInMemoryProject();
		const sf = project.createSourceFile("/src/a.ts", "export {};");
		const exportDecl = sf.addExportDeclaration({ namedExports: [] });
		const before = exportDecl.getText();

		updateModuleSpecifiers(
			[
				{
					declaration: exportDecl,
					resolvedPath: "/src/old.ts",
					referencingFilePath: "/src/a.ts",
					originalSpecifierText: "",
				},
			],
			[refOp(sf, "/src/old.ts", "/src/new.ts")],
		);

		expect(exportDecl.getModuleSpecifier()).toBeUndefined();
		expect(exportDecl.getText()).toBe(before);
	});

	it("resolvedPath にマッチするリネームがない場合はスキップする", () => {
		const project = createInMemoryProject();
		const target = project.createSourceFile(
			"/src/other.ts",
			"export const a = 1;",
		);
		const importer = project.createSourceFile(
			"/src/importer.ts",
			'import { a } from "./other";\nconsole.log(a);',
		);
		const importDecl = importer.getImportDeclarations()[0];

		updateModuleSpecifiers(
			[
				{
					declaration: importDecl,
					resolvedPath: "/src/unrelated.ts",
					referencingFilePath: "/src/importer.ts",
					originalSpecifierText: "./other",
				},
			],
			[refOp(target, "/src/old.ts", "/src/new.ts")],
		);

		expect(importDecl.getModuleSpecifierValue()).toBe("./other");
	});

	it(".js 拡張子付き specifier は拡張子を保持する", () => {
		const project = createInMemoryProject();
		const target = project.createSourceFile(
			"/src/old.js",
			"export const a = 1;",
		);
		const importer = project.createSourceFile(
			"/src/importer.ts",
			'import { a } from "./old.js";\nconsole.log(a);',
		);
		const importDecl = importer.getImportDeclarations()[0];

		updateModuleSpecifiers(
			[
				{
					declaration: importDecl,
					resolvedPath: "/src/old.js",
					referencingFilePath: "/src/importer.ts",
					originalSpecifierText: "./old.js",
				},
			],
			[refOp(target, "/src/old.js", "/src/new.js")],
		);

		expect(importDecl.getModuleSpecifierValue()).toBe("./new.js");
	});

	it("path alias 経由のインポートでも相対パスにフォールバックする", () => {
		const project = createInMemoryProject();
		const target = project.createSourceFile(
			"/src/old.ts",
			"export const a = 1;",
		);
		const importer = project.createSourceFile(
			"/src/feature/importer.ts",
			'import { a } from "@/old";\nconsole.log(a);',
		);
		const importDecl = importer.getImportDeclarations()[0];

		updateModuleSpecifiers(
			[
				{
					declaration: importDecl,
					resolvedPath: "/src/old.ts",
					referencingFilePath: "/src/feature/importer.ts",
					originalSpecifierText: "@/old",
					wasPathAlias: true,
				},
			],
			[refOp(target, "/src/old.ts", "/src/new.ts")],
		);

		expect(importDecl.getModuleSpecifierValue()).toBe("../new");
	});

	it("setModuleSpecifier が throw した場合はスキップして処理を継続する", () => {
		const project = createInMemoryProject();
		const target = project.createSourceFile(
			"/src/old.ts",
			"export const a = 1;",
		);
		const importer = project.createSourceFile(
			"/src/importer.ts",
			'import { a } from "./old";\nconsole.log(a);',
		);
		const importDecl = importer.getImportDeclarations()[0];

		// 強制的に throw させる
		const original = importDecl.setModuleSpecifier.bind(importDecl);
		(
			importDecl as unknown as { setModuleSpecifier: () => never }
		).setModuleSpecifier = () => {
			throw new Error("intentional");
		};

		try {
			expect(() =>
				updateModuleSpecifiers(
					[
						{
							declaration: importDecl,
							resolvedPath: "/src/old.ts",
							referencingFilePath: "/src/importer.ts",
							originalSpecifierText: "./old",
						},
					],
					[refOp(target, "/src/old.ts", "/src/new.ts")],
				),
			).not.toThrow();
		} finally {
			(
				importDecl as unknown as { setModuleSpecifier: typeof original }
			).setModuleSpecifier = original;
		}
	});

	it("AbortSignal で中断できる", () => {
		const project = createInMemoryProject();
		const target = project.createSourceFile(
			"/src/old.ts",
			"export const a = 1;",
		);
		const controller = new AbortController();
		const abortReason = new Error("test-abort");
		controller.abort(abortReason);

		expect(() =>
			updateModuleSpecifiers(
				[],
				[refOp(target, "/src/old.ts", "/src/new.ts")],
				controller.signal,
			),
		).toThrow(abortReason);
	});
});
