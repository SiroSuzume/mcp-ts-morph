import { describe, it, expect } from "vitest";
import { Project, IndentationText, QuoteKind } from "ts-morph";
import { findDeclarationsReferencingFile } from "./find-declarations-to-update";

// --- Setup Helper Function ---
const setupTestProject = () => {
	const project = new Project({
		manipulationSettings: {
			indentationText: IndentationText.TwoSpaces,
			quoteKind: QuoteKind.Single,
		},
		useInMemoryFileSystem: true,
		compilerOptions: {
			baseUrl: ".",
			paths: {
				"@/*": ["src/*"],
				"@utils/*": ["src/utils/*"],
			},
			// typeRoots: [], // Avoids errors on potentially missing node types if not installed
		},
	});

	// Target file
	const targetFilePath = "/src/target.ts";
	const targetFile = project.createSourceFile(
		targetFilePath,
		`export const targetSymbol = 'target';
export type TargetType = number;`,
	);

	// File importing with relative path
	const importerRelPath = "/src/importer-relative.ts";
	project.createSourceFile(
		importerRelPath,
		`import { targetSymbol } from './target';
import type { TargetType } from './target';
console.log(targetSymbol);`,
	);

	// File importing with alias path
	const importerAliasPath = "/src/importer-alias.ts";
	project.createSourceFile(
		importerAliasPath,
		`import { targetSymbol } from '@/target';
console.log(targetSymbol);`,
	);

	// Barrel file re-exporting from target
	const barrelFilePath = "/src/index.ts";
	project.createSourceFile(
		barrelFilePath,
		`export { targetSymbol } from './target'; // 値を再エクスポート
export type { TargetType } from './target'; // 型を再エクスポート`,
	);

	// File importing from barrel file
	const importerBarrelPath = "/src/importer-barrel.ts";
	project.createSourceFile(
		importerBarrelPath,
		`import { targetSymbol } from './index'; // バレルファイルからインポート
console.log(targetSymbol);`,
	);

	// File with no reference
	const noRefFilePath = "/src/no-ref.ts";
	project.createSourceFile(noRefFilePath, "const unrelated = 1;");

	return {
		project,
		targetFile,
		targetFilePath,
		importerRelPath,
		importerAliasPath,
		barrelFilePath,
		importerBarrelPath,
		noRefFilePath,
	};
};

describe("findDeclarationsReferencingFile", () => {
	it("target.ts を直接参照している全ての宣言 (Import/Export) を見つける", async () => {
		const {
			project,
			targetFile,
			targetFilePath,
			importerRelPath,
			importerAliasPath,
			barrelFilePath,
		} = setupTestProject();
		const results = await findDeclarationsReferencingFile(targetFile);

		// 期待値: 5つの宣言 (相対パスインポートx2, エイリアスパスインポートx1, バレルエクスポートx2)
		expect(results).toHaveLength(5);

		// --- 相対パスインポートの検証 ---
		const relativeImports = results.filter(
			(r) =>
				r.referencingFilePath === importerRelPath &&
				r.declaration.getKindName() === "ImportDeclaration",
		);
		expect(relativeImports).toHaveLength(2);
		const valueRelImport = relativeImports.find((r) =>
			r.declaration.getText().includes("targetSymbol"),
		);
		expect(valueRelImport?.originalSpecifierText).toBe("./target");
		const typeRelImport = relativeImports.find((r) =>
			r.declaration.getText().includes("TargetType"),
		);
		expect(typeRelImport?.originalSpecifierText).toBe("./target");

		// --- エイリアスパスインポートの検証 ---
		const aliasImports = results.filter(
			(r) =>
				r.referencingFilePath === importerAliasPath &&
				r.declaration.getKindName() === "ImportDeclaration",
		);
		expect(aliasImports).toHaveLength(1);
		expect(aliasImports[0].originalSpecifierText).toBe("@/target");
		expect(aliasImports[0].wasPathAlias).toBe(true);

		// --- バレルエクスポートの検証 ---
		const barrelExports = results.filter(
			(r) =>
				r.referencingFilePath === barrelFilePath &&
				r.declaration.getKindName() === "ExportDeclaration",
		);
		expect(barrelExports).toHaveLength(2);
		const valueBarrelExport = barrelExports.find((r) =>
			r.declaration.getText().includes("targetSymbol"),
		);
		expect(valueBarrelExport?.originalSpecifierText).toBe("./target");
		const typeBarrelExport = barrelExports.find((r) =>
			r.declaration.getText().includes("TargetType"),
		);
		expect(typeBarrelExport?.originalSpecifierText).toBe("./target");
	});

	it("エイリアスパスでインポートしている ImportDeclaration を見つけ、wasPathAlias が true になる", async () => {
		const { project, targetFile, targetFilePath, importerAliasPath } =
			setupTestProject();
		const results = await findDeclarationsReferencingFile(targetFile);

		// エイリアスパスによるインポートを特定する
		const aliasImports = results.filter(
			(r) => r.referencingFilePath === importerAliasPath,
		);
		expect(aliasImports).toHaveLength(1);
		const aliasImport = aliasImports[0];

		expect(aliasImport).toBeDefined();
		expect(aliasImport.referencingFilePath).toBe(importerAliasPath);
		expect(aliasImport.resolvedPath).toBe(targetFilePath);
		expect(aliasImport.originalSpecifierText).toBe("@/target");
		expect(aliasImport.declaration.getKindName()).toBe("ImportDeclaration");
		expect(aliasImport.wasPathAlias).toBe(true); // エイリアスが検出されるべき
	});

	it("バレルファイルで再エクスポートしている ExportDeclaration を見つける", async () => {
		const { project, targetFile, targetFilePath, barrelFilePath } =
			setupTestProject();
		const results = await findDeclarationsReferencingFile(targetFile);

		// バレルファイルからのエクスポートを特定する
		const exportDeclarations = results.filter(
			(r) => r.referencingFilePath === barrelFilePath,
		);
		expect(exportDeclarations).toHaveLength(2);

		const valueExport = exportDeclarations.find((r) =>
			r.declaration.getText().includes("targetSymbol"),
		);
		expect(valueExport).toBeDefined();
		expect(valueExport?.referencingFilePath).toBe(barrelFilePath);
		expect(valueExport?.resolvedPath).toBe(targetFilePath);
		expect(valueExport?.originalSpecifierText).toBe("./target");
		expect(valueExport?.declaration.getKindName()).toBe("ExportDeclaration");
		expect(valueExport?.wasPathAlias).toBe(false);

		const typeExport = exportDeclarations.find((r) =>
			r.declaration.getText().includes("TargetType"),
		);
		expect(typeExport).toBeDefined();
		expect(typeExport?.referencingFilePath).toBe(barrelFilePath);
		expect(typeExport?.resolvedPath).toBe(targetFilePath);
		expect(typeExport?.originalSpecifierText).toBe("./target");
		expect(typeExport?.declaration.getKindName()).toBe("ExportDeclaration");
		expect(typeExport?.wasPathAlias).toBe(false);
	});

	// findDeclarationsReferencingFile は getReferencingSourceFiles を使うため、
	// バレルファイルを経由した参照は見つけられない (これは想定される動作)
	it("バレルファイル経由のインポートは見つけられない (getReferencingSourceFiles の仕様)", async () => {
		const { project, targetFile, importerBarrelPath } = setupTestProject();
		const results = await findDeclarationsReferencingFile(targetFile);

		// 結果に importerBarrelPath からのインポートが含まれないことを確認
		const barrelImport = results.find(
			(r) => r.referencingFilePath === importerBarrelPath,
		);
		expect(barrelImport).toBeUndefined();
	});

	it("対象ファイルへの参照がない場合は空の配列を返す", async () => {
		const { project } = setupTestProject();
		// 参照されていないファイルを作成
		const unreferencedFile = project.createSourceFile(
			"/src/unreferenced.ts",
			"export const x = 1;",
		);
		const results = await findDeclarationsReferencingFile(unreferencedFile);
		expect(results).toHaveLength(0);
	});

	it("Import と Export が混在する場合、両方を見つけられる", async () => {
		const { project, targetFile, targetFilePath } = setupTestProject();
		// target からインポートとエクスポートの両方を行う別のファイルを追加
		const mixedRefPath = "/src/mixed-ref.ts";
		project.createSourceFile(
			mixedRefPath,
			`
			import { targetSymbol } from './target';
			export { TargetType } from './target';
			console.log(targetSymbol);
		`,
		);
		const results = await findDeclarationsReferencingFile(targetFile);

		// mixedRefPath からの2つの宣言 + セットアップからの他の宣言を期待
		const mixedRefs = results.filter(
			(r) => r.referencingFilePath === mixedRefPath,
		);
		expect(mixedRefs).toHaveLength(2);

		const importDecl = mixedRefs.find(
			(d) => d.declaration.getKindName() === "ImportDeclaration",
		);
		const exportDecl = mixedRefs.find(
			(d) => d.declaration.getKindName() === "ExportDeclaration",
		);
		expect(importDecl).toBeDefined();
		expect(exportDecl).toBeDefined();
	});
});
