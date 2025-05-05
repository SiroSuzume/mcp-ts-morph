import type { Statement } from "ts-morph";
import { Node } from "ts-morph";
import logger from "../../../utils/logger";
import type {
	DependencyClassification,
	NeededExternalImports,
} from "../../types";
import {
	buildImportSectionStringFromMap,
	calculateRequiredImportMap,
} from "./build-new-file-import-section";

// --- 型定義 ---
// --- 内部ヘルパー関数 ---

/**
 * Statement を取得し、必要なら export キーワードを追加して文字列を返す。
 * isInternalOnly が true の場合は export キーワードを付けない。
 */
function getPotentiallyExportedStatement(
	stmt: Statement,
	isInternalOnly: boolean,
): string {
	const stmtText = stmt.getText();
	if (Node.isExportable(stmt) && stmt.isDefaultExport()) {
		return stmtText;
	}
	if (isInternalOnly) {
		if (Node.isExportable(stmt) && stmt.isExported()) {
			return stmtText.replace(/^export\s+/, "");
		}
		return stmtText;
	}
	if (Node.isExportable(stmt) && !stmt.isExported()) {
		return `export ${stmtText}`;
	}
	return stmtText;
}

// --- エクスポートされるヘルパー関数 ---

/**
 * 移動対象の宣言と、それに付随する内部依存 (`moveToNewFile` タイプ) の
 * 宣言文字列 (適切な export キーワード付き) の配列を生成する。
 */
export function prepareDeclarationStrings(
	targetDeclaration: Statement,
	classifiedDependencies: DependencyClassification[],
): string[] {
	logger.debug("Generating declaration section strings...");
	const declarationStrings: string[] = [];

	for (const dep of classifiedDependencies) {
		if (dep.type === "moveToNewFile") {
			declarationStrings.push(
				getPotentiallyExportedStatement(dep.statement, true),
			);
		}
	}

	declarationStrings.push(
		getPotentiallyExportedStatement(targetDeclaration, false),
	);

	logger.debug(`Generated ${declarationStrings.length} declaration strings.`);
	return declarationStrings;
}

// --- メイン関数 (新規ファイル作成用) ---

/**
 * 移動対象の宣言と依存関係から、新しいファイルの完全な内容を生成する。
 *
 * @param targetDeclaration 移動対象のシンボルの Statement
 * @param classifiedDependencies 分類済みの内部依存関係の配列
 * @param originalFilePath 元のファイルの絶対パス
 * @param newFilePath 新しいファイルの絶対パス
 * @param neededExternalImports 事前に収集された外部インポート情報
 * @returns 新しいファイルのソースコード文字列
 */
export function generateNewSourceFileContent(
	targetDeclaration: Statement,
	classifiedDependencies: DependencyClassification[],
	originalFilePath: string,
	newFilePath: string,
	neededExternalImports: NeededExternalImports,
): string {
	logger.debug("Generating new source file content...");

	const importMap = calculateRequiredImportMap(
		neededExternalImports,
		classifiedDependencies,
		newFilePath,
		originalFilePath,
	);

	const importSection = buildImportSectionStringFromMap(importMap);

	const declarationStrings = prepareDeclarationStrings(
		targetDeclaration,
		classifiedDependencies,
	);
	const declarationSection = `${declarationStrings.join("\n\n")}\n`;

	const finalContent = `${importSection}${declarationSection}`;
	logger.debug("Final generated content length:", finalContent.length);

	return finalContent;
}
