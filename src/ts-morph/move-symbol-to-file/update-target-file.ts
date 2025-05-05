import type { SourceFile, ImportDeclarationStructure } from "ts-morph";
import { StructureKind } from "ts-morph";
import * as path from "node:path";
import logger from "../../utils/logger";
import type { ImportMap } from "./generate-new-source-file-content";

/**
 * 既存の SourceFile に、計算済みのインポート情報と宣言文字列を追加（マージ）する。
 *
 * @param targetSourceFile 変更対象の SourceFile インスタンス
 * @param requiredImportMap 追加またはマージが必要なインポート情報
 * @param declarationStrings 追加する宣言の文字列配列
 */
export function updateTargetFile(
	targetSourceFile: SourceFile,
	requiredImportMap: ImportMap,
	declarationStrings: string[],
): void {
	logger.debug(`Updating existing file: ${targetSourceFile.getFilePath()}`);
	const targetFilePath = targetSourceFile.getFilePath();

	// 1. インポートの追加・マージ
	for (const [moduleSpecifier, importInfo] of requiredImportMap.entries()) {
		logger.debug(`Processing imports for module: ${moduleSpecifier}`);

		try {
			const absoluteImportPath = path.resolve(
				path.dirname(targetFilePath),
				moduleSpecifier,
			);
			if (absoluteImportPath === targetFilePath) {
				logger.debug(`Skipping self-referential import: ${moduleSpecifier}`);
				continue;
			}
		} catch (e) {
			logger.trace(
				`Could not resolve path for ${moduleSpecifier}, assuming not self-referential.`,
			);
		}

		const existingImportDecl = targetSourceFile.getImportDeclaration(
			(decl) => decl.getModuleSpecifierValue() === moduleSpecifier,
		);

		if (existingImportDecl) {
			// --- 既存のインポート宣言がある場合 ---
			logger.debug(`Found existing import for ${moduleSpecifier}. Merging...`);

			// 名前空間インポートの衝突チェック
			const existingNamespaceImport = existingImportDecl.getNamespaceImport();
			if (importInfo.isNamespaceImport && !existingNamespaceImport) {
				logger.warn(
					`Cannot add namespace import for ${moduleSpecifier} because a non-namespace import already exists. Skipping namespace import.`, // 既存の名前付き/デフォルトを優先
				);
				continue; // 名前空間インポートはスキップ
			}
			if (!importInfo.isNamespaceImport && existingNamespaceImport) {
				logger.warn(
					`Cannot add named/default imports for ${moduleSpecifier} because a namespace import already exists. Skipping named/default imports.`, // 既存の名前空間を優先
				);
				continue; // 名前付き/デフォルトインポートはスキップ
			}

			// デフォルトインポートのマージ
			if (importInfo.defaultName && !existingImportDecl.getDefaultImport()) {
				logger.debug(`Adding default import: ${importInfo.defaultName}`);
				existingImportDecl.setDefaultImport(importInfo.defaultName);
			} else if (
				importInfo.defaultName &&
				existingImportDecl.getDefaultImport()?.getText() !==
					importInfo.defaultName
			) {
				// 既に異なるデフォルトインポートが存在する場合の警告
				logger.warn(
					`Existing default import ${existingImportDecl.getDefaultImport()?.getText()} differs from requested ${importInfo.defaultName} for ${moduleSpecifier}. Keeping the existing one.`, // 既存を優先
				);
			}

			// 名前付きインポートのマージ
			const existingNamedImports = new Set(
				existingImportDecl.getNamedImports().map((ni) => ni.getName()),
			);
			const namedImportsToAdd = [...importInfo.namedImports].filter(
				(name) => !existingNamedImports.has(name),
			);

			if (namedImportsToAdd.length > 0) {
				logger.debug(`Adding named imports: ${namedImportsToAdd.join(", ")}`);
				existingImportDecl.addNamedImports(namedImportsToAdd);
			}
		} else {
			// --- 新しいインポート宣言を追加する場合 ---
			logger.debug(
				`No existing import for ${moduleSpecifier}. Adding new declaration.`,
			);
			const importStructure: ImportDeclarationStructure = {
				kind: StructureKind.ImportDeclaration,
				moduleSpecifier: moduleSpecifier,
			};

			if (importInfo.isNamespaceImport && importInfo.namespaceImportName) {
				importStructure.namespaceImport = importInfo.namespaceImportName;
			} else {
				if (importInfo.defaultName) {
					importStructure.defaultImport = importInfo.defaultName;
				}
				if (importInfo.namedImports.size > 0) {
					importStructure.namedImports = [...importInfo.namedImports].sort();
				}
			}
			// デフォルトも名前付きもない場合は副作用インポート import "module"; となる
			targetSourceFile.addImportDeclaration(importStructure);
		}
	}

	// 2. 宣言の追加
	if (declarationStrings.length > 0) {
		logger.debug(`Adding ${declarationStrings.length} declaration statements.`);
		// 既存ファイルの末尾に、空行を挟んで追加
		targetSourceFile.addStatements(`\n${declarationStrings.join("\n\n")}`);
	} else {
		logger.debug("No declaration strings to add.");
	}

	// 3. インポートの整理
	logger.debug("Organizing imports...");
	targetSourceFile.organizeImports();

	logger.debug(`File update complete: ${targetSourceFile.getFilePath()}`);
}
