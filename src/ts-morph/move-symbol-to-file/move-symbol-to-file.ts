import type { Project, SourceFile, Statement, SyntaxKind } from "ts-morph";
import { Node } from "ts-morph";
import logger from "../../utils/logger";
import type { DependencyClassification, NeededExternalImports } from "../types";
import { classifyDependencies } from "./classify-dependencies";
import { collectNeededExternalImports } from "./collect-external-imports";
import { ensureExportsInOriginalFile } from "./ensure-exports-in-original-file";
import { findTopLevelDeclarationByName } from "./find-declaration";
import {
	generateNewSourceFileContent,
	prepareDeclarationStrings,
} from "./generate-content/generate-new-source-file-content";
import { getInternalDependencies } from "./internal-dependencies";
import {
	addBackImportsToOriginalFile,
	collectSymbolsNeedingBackImport,
} from "./add-back-imports-to-original-file";
import { removeOriginalSymbol } from "./remove-original-symbol";
import { updateImportsInReferencingFiles } from "./update-imports-in-referencing-files";
import { updateTargetFile } from "./update-target-file";
import { calculateRequiredImportMap } from "./generate-content/build-new-file-import-section";

/**
 * シンボル移動に必要な情報を収集する。
 * 元ファイル、移動対象の宣言、分類済み依存関係、外部インポート情報を返す。
 */
async function gatherMovePrerequisites(
	project: Project,
	originalFilePath: string,
	symbolToMove: string,
	declarationKind?: SyntaxKind,
): Promise<{
	originalSourceFile: SourceFile;
	declaration: Statement;
	classifiedDependencies: DependencyClassification[];
	neededExternalImports: NeededExternalImports;
}> {
	const originalSourceFile = project.getSourceFile(originalFilePath);
	if (!originalSourceFile) {
		throw new Error(`Original source file not found: ${originalFilePath}`);
	}
	logger.debug(`元のファイルを発見: ${originalFilePath}`);

	const declaration = findTopLevelDeclarationByName(
		originalSourceFile,
		symbolToMove,
		declarationKind,
	);
	if (!declaration) {
		throw new Error(
			`Symbol "${symbolToMove}" not found in ${originalFilePath}`,
		);
	}
	logger.debug(`シンボルの宣言を発見: ${symbolToMove}`);

	let isDefaultExported = false;
	if (
		Node.isFunctionDeclaration(declaration) ||
		Node.isClassDeclaration(declaration) ||
		Node.isInterfaceDeclaration(declaration) ||
		Node.isEnumDeclaration(declaration)
	) {
		isDefaultExported = declaration.isDefaultExport();
	}
	if (isDefaultExported) {
		throw new Error(
			"Default exports cannot be moved using this function. Please refactor manually or use file moving tools.",
		);
	}

	const internalDependencies = getInternalDependencies(declaration);
	logger.debug(`${internalDependencies.length}個の内部依存関係を発見。`);

	const classifiedDependencies = classifyDependencies(
		declaration,
		internalDependencies,
	);

	const allDepsToMove = [
		declaration,
		...classifiedDependencies.map((dep) => dep.statement),
	];
	const neededExternalImports = collectNeededExternalImports(
		allDepsToMove,
		originalSourceFile,
	);
	logger.debug(`必要な外部インポートを${neededExternalImports.size}個収集。`);

	return {
		originalSourceFile,
		declaration,
		classifiedDependencies,
		neededExternalImports,
	};
}

/**
 * 参照元のインポートパス更新、元のファイルからのシンボル削除、元のファイルのインポート修正を行う。
 */
async function updateReferencesAndOriginalFile(
	project: Project,
	originalSourceFile: SourceFile,
	declaration: Statement,
	classifiedDependencies: DependencyClassification[],
	originalFilePath: string,
	newFilePath: string,
	symbolToMove: string,
): Promise<void> {
	await updateImportsInReferencingFiles(
		project,
		originalFilePath,
		newFilePath,
		symbolToMove,
	);
	logger.debug("参照元ファイルのインポートを更新。");

	const dependenciesToRemoveDeclarations = classifiedDependencies
		.filter(
			(
				dep: DependencyClassification,
			): dep is Extract<DependencyClassification, { type: "moveToNewFile" }> =>
				dep.type === "moveToNewFile",
		)
		.map((dep) => dep.statement);
	const allDeclarationsToRemove = [
		declaration,
		...dependenciesToRemoveDeclarations,
	];

	const symbolsNeedingBackImport = collectSymbolsNeedingBackImport(
		allDeclarationsToRemove,
	);

	removeOriginalSymbol(originalSourceFile, allDeclarationsToRemove);
	logger.debug("元のファイルからシンボルと依存関係を削除。");

	addBackImportsToOriginalFile(
		originalSourceFile,
		newFilePath,
		symbolsNeedingBackImport,
	);
	originalSourceFile.organizeImports();
	logger.debug("元のファイルのインポートを整理。");
}

/**
 * 新しいファイルの内容を生成し、ファイルを作成または既存ファイルに追加する。
 */
function generateAndAppendToNewFile(
	project: Project,
	declaration: Statement,
	classifiedDependencies: DependencyClassification[],
	originalFilePath: string,
	newFilePath: string,
	neededExternalImports: NeededExternalImports,
): void {
	logger.debug(
		`Generate/Append symbol to file: ${newFilePath} (from ${originalFilePath})`,
	);

	const requiredImportMap = calculateRequiredImportMap(
		neededExternalImports,
		classifiedDependencies,
		newFilePath,
		originalFilePath,
	);

	const declarationStrings = prepareDeclarationStrings(
		declaration,
		classifiedDependencies,
	);

	const targetSourceFile = project.getSourceFile(newFilePath);

	if (targetSourceFile) {
		logger.debug(`Target file exists. Updating: ${newFilePath}`);
		updateTargetFile(targetSourceFile, requiredImportMap, declarationStrings);
		return;
	}

	logger.debug(`Target file does not exist. Creating: ${newFilePath}`);
	const newFileContent = generateNewSourceFileContent(
		declaration,
		classifiedDependencies,
		originalFilePath,
		newFilePath,
		neededExternalImports,
	);
	const newSourceFile = project.createSourceFile(newFilePath, newFileContent);
	newSourceFile.organizeImports();
}

/**
 * 指定されたシンボルを現在のファイルから別ファイル（なければ新規作成）に移動します。
 * ヘルパー関数は成功時に値を返し、失敗時に例外をスローします。
 *
 * @param project ts-morph プロジェクトインスタンス
 * @param originalFilePath 元のファイルの絶対パス
 * @param newFilePath 移動先ファイルの絶対パス
 * @param symbolToMove 移動するシンボルの名前
 * @param declarationKind 移動するシンボルの種類 (オプション)
 * @returns Promise<void> 処理が完了したら解決される Promise
 * @throws Error - シンボルが見つからない、デフォルトエクスポート、AST 操作エラーなど
 */
export async function moveSymbolToFile(
	project: Project,
	originalFilePath: string,
	newFilePath: string,
	symbolToMove: string,
	declarationKind?: SyntaxKind,
): Promise<void> {
	logger.debug(
		`moveSymbolToFile 開始: Symbol='${symbolToMove}', From='${originalFilePath}', To='${newFilePath}'`,
	);

	const {
		originalSourceFile,
		declaration,
		classifiedDependencies,
		neededExternalImports,
	} = await gatherMovePrerequisites(
		project,
		originalFilePath,
		symbolToMove,
		declarationKind,
	);

	ensureExportsInOriginalFile(classifiedDependencies, originalFilePath);

	generateAndAppendToNewFile(
		project,
		declaration,
		classifiedDependencies,
		originalFilePath,
		newFilePath,
		neededExternalImports,
	);

	await updateReferencesAndOriginalFile(
		project,
		originalSourceFile,
		declaration,
		classifiedDependencies,
		originalFilePath,
		newFilePath,
		symbolToMove,
	);

	logger.info(
		`Successfully moved symbol '${symbolToMove}' from '${originalFilePath}' to '${newFilePath}'.`,
	);
}
