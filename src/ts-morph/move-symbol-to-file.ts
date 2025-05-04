import { type Project, type SyntaxKind, Node } from "ts-morph";
import { findTopLevelDeclarationByName } from "./find-declaration";
import { getInternalDependencies } from "./internal-dependencies";
import { classifyDependencies } from "./classify-dependencies";
import type { DependencyClassification } from "./types";
import { collectNeededExternalImports } from "./utils/collect-external-imports";
import { generateNewSourceFileContent } from "./generate-new-source-file-content";
import { createSourceFileIfNotExists } from "./create-source-file-if-not-exists";
import { updateImportsInReferencingFiles } from "./update-imports-in-referencing-files";
import { removeOriginalSymbol } from "./remove-original-symbol";
import logger from "../utils/logger";

/**
 * 指定されたシンボルを現在のファイルから新しいファイルに移動します。
 * ヘルパー関数は成功時に値を返し、失敗時に例外をスローします。
 *
 * @param project ts-morph プロジェクトインスタンス
 * @param originalFilePath 元のファイルの絶対パス
 * @param newFilePath 新しいファイルの絶対パス
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
		`Starting moveSymbolToFile: Symbol='${symbolToMove}', From='${originalFilePath}', To='${newFilePath}'`,
	);

	// --- ステップ 1: 元ファイルの取得 ---
	const originalSourceFile = project.getSourceFile(originalFilePath);
	if (!originalSourceFile) {
		throw new Error(`Original source file not found: ${originalFilePath}`);
	}
	logger.debug(`Found original source file: ${originalFilePath}`);

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
	logger.debug(`Found declaration for symbol: ${symbolToMove}`);

	// ★★★ デフォルトエクスポートは対象外とするチェック ★★★
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
	logger.debug(`Found ${internalDependencies.length} internal dependencies.`);

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
	logger.debug(
		`Collected ${neededExternalImports.size} needed external imports.`,
	);

	// export を追加する処理
	for (const dep of classifiedDependencies) {
		if (dep.type !== "addExport") {
			continue;
		}
		// export を追加する処理
		if (Node.isExportable(dep.statement)) {
			// isExported() をチェックして、既に追加されていないか確認
			if (!dep.statement.isExported()) {
				dep.statement.setIsExported(true);
				logger.debug(
					`Added export keyword to ${dep.name} in ${originalFilePath}`,
				);
			} else {
				logger.debug(
					`Export keyword for ${dep.name} already exists in ${originalFilePath}. No change needed.`,
				);
			}
		} else {
			// classifyDependencies で警告が出ているはずだが、念のためここでもログ出力
			logger.warn(
				`Attempted to add export to a non-exportable node (${dep.statement.getKindName()}) named ${dep.name} in ${originalFilePath}. Skipping.`,
			);
		}
	}

	// --- ステップ 6: 新しいファイルの内容を生成 ---
	const newFileContent = generateNewSourceFileContent(
		declaration,
		classifiedDependencies,
		originalFilePath,
		newFilePath,
		neededExternalImports,
	);
	logger.debug("Generated new file content.");

	// --- ステップ 7: 新しいソースファイルを作成 (または上書き) ---
	const newSourceFile = createSourceFileIfNotExists(
		project,
		newFilePath,
		newFileContent,
	);
	logger.debug(`Created or updated source file: ${newFilePath}`);

	// --- ステップ 8: 参照元のインポート更新 ---
	await updateImportsInReferencingFiles(
		project,
		originalFilePath,
		newFilePath,
		symbolToMove,
	);
	logger.debug("Updated imports in referencing files.");

	/* ★★★ 操作順序変更: export 追加を先に実行 ★★★ */

	// --- ステップ 10: 移動元で export が追加された依存を処理 ---
	for (const dep of classifiedDependencies) {
		if (dep.type === "addExport") {
			// export を追加する処理
			if (Node.isExportable(dep.statement)) {
				// isExported() をチェックして、既に追加されていないか確認
				if (!dep.statement.isExported()) {
					dep.statement.setIsExported(true);
					logger.debug(
						`Added export keyword to ${dep.name} in ${originalFilePath}`,
					);
				} else {
					logger.debug(
						`Export keyword for ${dep.name} already exists in ${originalFilePath}. No change needed.`,
					);
				}
			} else {
				// classifyDependencies で警告が出ているはずだが、念のためここでもログ出力
				logger.warn(
					`Attempted to add export to a non-exportable node (${dep.statement.getKindName()}) named ${dep.name} in ${originalFilePath}. Skipping.`,
				);
			}
		}
	}

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
	console.log(
		`Declarations to remove: ${allDeclarationsToRemove.map((d) => `"${d.getText().substring(0, 80).replaceAll("\n", " ")}..."`).join(", ")}`,
	);

	removeOriginalSymbol(originalSourceFile, allDeclarationsToRemove);
	console.log("--- Step 9: After removeOriginalSymbol ---");
	console.log(
		`Original file content AFTER removal:\n${originalSourceFile.getText()}`,
	);

	logger.debug("Removed original symbol and dependencies from source file.");

	// ★★★ 新しいステップ: 移動元ファイルのインポート修正 ★★★
	// 移動したシンボルが、移動元のファイル内でまだ参照されている場合があるため、
	// ts-morph の fixMissingImports を使って、必要なインポートを自動追加させる
	logger.debug(
		`Attempting to fix missing imports in original file: ${originalFilePath}`,
	);
	originalSourceFile.fixMissingImports();
	logger.debug("Finished attempting to fix missing imports in original file.");
	// ★★★ ここまで ★★★

	logger.info(
		`Successfully moved symbol "${symbolToMove}" from ${originalFilePath} to ${newFilePath}`,
	);
}

// isDescendantOfAny は削除
/*
function isDescendantOfAny(node: Node, ancestors: Node[]): boolean {
  return ancestors.some(ancestor => node.getAncestors().includes(ancestor));
}
*/
