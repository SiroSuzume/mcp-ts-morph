import {
	type Project,
	Node,
	type SourceFile,
	type ImportSpecifier,
	type ExportSpecifier,
	type ImportDeclaration,
	type ExportDeclaration,
} from "ts-morph";
import * as path from "node:path";
import { calculateRelativePath } from "../_utils/calculate-relative-path";
import logger from "../../utils/logger";
import { findDeclarationsReferencingFile } from "../_utils/find-declarations-to-update";

// ヘルパー関数用のインターフェース
interface TargetSpecifierInfo {
	specifier: ImportSpecifier | ExportSpecifier | undefined;
	isOnlySpecifier: boolean;
	isTypeOnlyImport: boolean; // インポート宣言の場合のみ意味を持つ
}

/**
 * インポート/エクスポート宣言から指定されたシンボル名に一致する Specifier を検索し、
 * それが付随情報（唯一の Specifier か、Type Only か）と共に返すヘルパー関数。
 */
function findTargetSpecifierInfo(
	declaration: ImportDeclaration | ExportDeclaration,
	symbolName: string,
): TargetSpecifierInfo {
	let specifier: ImportSpecifier | ExportSpecifier | undefined;
	let isOnlySpecifier = false;
	let isTypeOnlyImport = false;

	if (Node.isImportDeclaration(declaration)) {
		isTypeOnlyImport = declaration.isTypeOnly();
		const namedImports = declaration.getNamedImports();
		specifier = namedImports.find(
			(spec) =>
				spec.getNameNode().getText() === symbolName ||
				spec.getAliasNode()?.getText() === symbolName,
		);
		if (specifier && namedImports.length === 1) {
			isOnlySpecifier = true;
		}
	} else if (Node.isExportDeclaration(declaration)) {
		const namedExports = declaration.getNamedExports();
		specifier = namedExports.find(
			(spec) =>
				spec.getNameNode().getText() === symbolName ||
				spec.getAliasNode()?.getText() === symbolName,
		);
		if (
			specifier &&
			namedExports.length === 1 &&
			!declaration.isNamespaceExport()
		) {
			isOnlySpecifier = true;
		}
	}

	return { specifier, isOnlySpecifier, isTypeOnlyImport };
}

/**
 * 宣言を分割し、指定されたシンボルを新しいパスでインポート/エクスポートする宣言を追加します。
 * 元の宣言が空になった場合は削除します。
 */
function splitAndUpdateDeclaration(
	declaration: ImportDeclaration | ExportDeclaration,
	symbolSpecifier: ImportSpecifier | ExportSpecifier,
	sourceFile: SourceFile,
	newRelativePath: string,
	symbolName: string,
	isTypeOnlyImport: boolean,
	referencingFilePath: string,
): void {
	logger.trace(
		{
			file: referencingFilePath,
			symbol: symbolName,
			from: declaration.getModuleSpecifier()?.getLiteralText(),
			to: newRelativePath,
			kind: declaration.getKindName(),
			action: "Split Declaration",
		},
		"Splitting declaration for target symbol",
	);

	symbolSpecifier.remove();

	if (Node.isImportDeclaration(declaration)) {
		sourceFile.addImportDeclaration({
			moduleSpecifier: newRelativePath,
			namedImports: [symbolName],
			isTypeOnly: isTypeOnlyImport,
		});
	} else if (Node.isExportDeclaration(declaration)) {
		sourceFile.addExportDeclaration({
			moduleSpecifier: newRelativePath,
			namedExports: [symbolName],
		});
	}

	if (
		Node.isImportDeclaration(declaration) &&
		declaration.getNamedImports().length === 0
	) {
		declaration.remove();
		logger.trace(
			{ file: referencingFilePath },
			"Removed empty original import declaration after split.",
		);
	} else if (
		Node.isExportDeclaration(declaration) &&
		declaration.getNamedExports().length === 0 &&
		!declaration.isNamespaceExport()
	) {
		declaration.remove();
		logger.trace(
			{ file: referencingFilePath },
			"Removed empty original export declaration after split.",
		);
	}
}

/**
 * 指定されたファイルパス (oldFilePath) を参照しているインポート/エクスポート文のうち、
 * 指定されたシンボル (symbolName) を含むもののパスを、
 * 新しいファイルパス (newFilePath) への参照に更新します。
 * 複数のシンボルを含む場合は宣言を分割します。
 * エラーが発生した場合はそのままスローします。
 *
 * @param project ts-morph プロジェクトインスタンス。
 * @param oldFilePath 移動元のファイルの絶対パス。
 * @param newFilePath 移動先のファイルの絶対パス。
 * @param symbolName 移動したシンボルの名前。
 * @throws Error - ファイルが見つからない場合や AST 操作中にエラーが発生した場合
 */
export async function updateImportsInReferencingFiles(
	project: Project,
	oldFilePath: string,
	newFilePath: string,
	symbolName: string,
): Promise<void> {
	const oldSourceFile = project.getSourceFile(oldFilePath);
	if (!oldSourceFile) {
		throw new Error(`Source file not found at old path: ${oldFilePath}`);
	}

	const declarationsToUpdate =
		await findDeclarationsReferencingFile(oldSourceFile);
	logger.debug(
		{ count: declarationsToUpdate.length, oldFile: oldFilePath },
		"Found declarations potentially referencing the old file path.",
	);

	for (const {
		declaration,
		referencingFilePath,
		originalSpecifierText,
	} of declarationsToUpdate) {
		const moduleSpecifier = declaration.getModuleSpecifier();
		const sourceFile = declaration.getSourceFile();
		if (!moduleSpecifier || !sourceFile) continue;

		const {
			specifier: symbolSpecifier,
			isOnlySpecifier,
			isTypeOnlyImport,
		} = findTargetSpecifierInfo(declaration, symbolName);

		if (!symbolSpecifier) {
			logger.trace(
				{
					file: referencingFilePath,
					symbol: symbolName,
					kind: declaration.getKindName(),
				},
				"Declaration does not reference the target symbol (or is not a named import/export). Skipping.",
			);
			continue;
		}

		const newRelativePath = calculateRelativePath(
			referencingFilePath,
			newFilePath,
			{
				removeExtensions: ![".js", ".jsx", ".json", ".mjs", ".cjs"].includes(
					path.extname(originalSpecifierText),
				),
				simplifyIndex: true,
			},
		);

		const currentSpecifier = moduleSpecifier.getLiteralText();

		if (isOnlySpecifier) {
			if (currentSpecifier !== newRelativePath) {
				logger.trace(
					{
						file: referencingFilePath,
						symbol: symbolName,
						from: currentSpecifier,
						to: newRelativePath,
						kind: declaration.getKindName(),
						action: "Update Path (Only Named Symbol)",
					},
					"Updating module specifier for single named import/export declaration",
				);
				moduleSpecifier.setLiteralValue(newRelativePath);
			}
		} else if (symbolSpecifier) {
			splitAndUpdateDeclaration(
				declaration,
				symbolSpecifier,
				sourceFile,
				newRelativePath,
				symbolName,
				isTypeOnlyImport,
				referencingFilePath,
			);
		}
	}
}
