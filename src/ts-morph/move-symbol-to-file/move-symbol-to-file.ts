import type { Project, SourceFile, Statement, SyntaxKind } from "ts-morph";
import { Node } from "ts-morph";
import logger from "../../utils/logger";
import type { DependencyClassification, NeededExternalImports } from "../types";
import { classifyDependencies } from "./classify-dependencies";
import { collectNeededExternalImports } from "./collect-external-imports";
import { createSourceFileIfNotExists } from "./create-source-file-if-not-exists";
import { ensureExportsInOriginalFile } from "./ensure-exports-in-original-file";
import { findTopLevelDeclarationByName } from "./find-declaration";
import { generateNewSourceFileContent } from "./generate-new-source-file-content";
import { getInternalDependencies } from "./internal-dependencies";
import { removeOriginalSymbol } from "./remove-original-symbol";
import { updateImportsInReferencingFiles } from "./update-imports-in-referencing-files";
import { updateTargetFile } from "./update-target-file";

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
	// --- ステップ 1: 元ファイルの取得 ---
	const originalSourceFile = project.getSourceFile(originalFilePath);
	if (!originalSourceFile) {
		throw new Error(`Original source file not found: ${originalFilePath}`);
	}
	logger.debug(`元のファイルを発見: ${originalFilePath}`);

	// --- ステップ 2: 移動対象シンボルの特定 ---
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

	// デフォルトエクスポートは対象外とするチェック
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

	// --- ステップ 3: 内部依存関係の取得 ---
	const internalDependencies = getInternalDependencies(declaration);
	logger.debug(`${internalDependencies.length}個の内部依存関係を発見。`);

	// --- ステップ 4: 依存関係の分類 ---
	const classifiedDependencies = classifyDependencies(
		declaration,
		internalDependencies,
	);

	// --- ステップ 5: 外部依存関係の収集 ---
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
 * 新しいファイルの内容を生成し、ファイルを作成または上書きする。
 */
function generateAndCreateNewFile(
	project: Project,
	declaration: Statement,
	classifiedDependencies: DependencyClassification[],
	originalFilePath: string,
	newFilePath: string,
	neededExternalImports: NeededExternalImports,
): void {
	// --- ステップ 6: 新しいファイルの内容を生成 ---
	const newFileContent = generateNewSourceFileContent(
		declaration,
		classifiedDependencies,
		originalFilePath,
		newFilePath,
		neededExternalImports,
	);
	logger.debug("新しいファイルの内容を生成。");

	// --- ステップ 7: 新しいソースファイルを作成 (または上書き) ---
	createSourceFileIfNotExists(project, newFilePath, newFileContent);
	logger.debug(`ソースファイルを作成または更新: ${newFilePath}`);
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
	// --- ステップ 8: 参照元のインポート更新 ---
	await updateImportsInReferencingFiles(
		project,
		originalFilePath,
		newFilePath,
		symbolToMove,
	);
	logger.debug("参照元ファイルのインポートを更新。 ");

	// --- ステップ 9: 元のファイルからシンボルと依存関係を削除 ---
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
	logger.debug(
		`削除する宣言: ${allDeclarationsToRemove.map((d) => `"${d.getText().substring(0, 80).replaceAll("\n", " ")}..."`).join(", ")}`,
	);

	removeOriginalSymbol(originalSourceFile, allDeclarationsToRemove);
	logger.debug(`削除後の元のファイルの内容:\n${originalSourceFile.getText()}`);

	logger.debug("元のファイルからシンボルと依存関係を削除。 ");

	// --- ステップ 10: 移動元ファイルのインポート修正 (fixMissingImports) ---
	logger.debug(
		`元のファイルの不足しているインポートを修正試行: ${originalFilePath}`,
	);
	originalSourceFile.fixMissingImports();
	logger.debug("元のファイルの不足しているインポートの修正試行を完了。 ");

	// --- ステップ 10.5: 元ファイルの未使用インポートを整理 ---
	logger.debug(`元のファイルのインポートを整理試行: ${originalFilePath}`);
	originalSourceFile.organizeImports();
	logger.debug("元のファイルのインポート整理試行を完了。");
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
	logger.debug(`新しいファイルへのシンボル追加/作成を開始: ${newFilePath}`);

	const dependenciesToMove = classifiedDependencies.filter(
		(
			dep,
		): dep is Extract<DependencyClassification, { type: "moveToNewFile" }> =>
			dep.type === "moveToNewFile",
	);
	const dependencyStatementsToMove = dependenciesToMove.map((dep) =>
		dep.statement.getText(),
	);
	const declarationStatementText = declaration.getText();

	// --- ステップ 7: 新しいソースファイルを取得または作成 ---
	const originalTargetSourceFile = project.getSourceFile(newFilePath);

	if (originalTargetSourceFile) {
		updateTargetFile(
			originalTargetSourceFile,
			newFilePath,
			neededExternalImports,
			dependencyStatementsToMove,
			declarationStatementText,
		);
	} else {
		logger.debug(`ファイルが存在しないため新規作成: ${newFilePath}`);
		const newFileContent = generateNewSourceFileContent(
			declaration,
			classifiedDependencies,
			originalFilePath,
			newFilePath,
			neededExternalImports,
		);
		logger.debug("新しいファイルの内容を生成。");
		const newSourceFile = project.createSourceFile(newFilePath, newFileContent);
		logger.debug(`ソースファイルを新規作成: ${newFilePath}`);
		newSourceFile.organizeImports();
		logger.debug(`インポートを整理: ${newFilePath}`);
	}
}

/**
 * 指定されたシンボルを現在のファイルから別ファイル（なければ新規作詞）に移動します。
 * ヘルパー関数は成功時に値を返し、失敗時に例外をスローします。
 *
 * @param project ts-morph プロジェクトインスタンス
 * @param originalFilePath 元のファイルの絶対パス
 * @param targetFilePath 移動先ファイルの絶対パス
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

	// --- ステップ 6 & 7: 新しいファイルの生成と作成/追加 ---
	generateAndAppendToNewFile(
		project,
		declaration,
		classifiedDependencies,
		originalFilePath,
		newFilePath,
		neededExternalImports,
	);

	// --- ステップ 8, 9, 10: 参照更新と元のファイル整理 ---
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
