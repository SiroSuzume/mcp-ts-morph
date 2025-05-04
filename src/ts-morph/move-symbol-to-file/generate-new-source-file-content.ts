import type { Statement } from "ts-morph";
import { Node } from "ts-morph";
import { calculateRelativePath } from "../_utils/calculate-relative-path";
import logger from "../../utils/logger";
import type { DependencyClassification, NeededExternalImports } from "../types";

// --- 型定義 ---
export type ExtendedImportInfo = {
	defaultName?: string;
	namedImports: Set<string>;
	isNamespaceImport: boolean;
	namespaceImportName?: string;
};
export type ImportMap = Map<string, ExtendedImportInfo>;

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

/**
 * インポート情報を Map に集約するヘルパー (非名前空間インポート用)
 */
function aggregateImports(
	importMap: ImportMap,
	relativePath: string,
	importName: string,
	isDefault: boolean,
) {
	if (isDefault) {
		const actualDefaultName = importName;
		if (!importMap.has(relativePath)) {
			importMap.set(relativePath, {
				namedImports: new Set(),
				isNamespaceImport: false,
			});
		}
		const entry = importMap.get(relativePath);
		if (!entry || entry.isNamespaceImport) {
			logger.warn(
				`Skipping default import aggregation for ${relativePath} due to existing namespace import or missing entry.`,
			);
			return;
		}
		entry.defaultName = actualDefaultName;
		logger.debug(
			`Aggregated default import: ${actualDefaultName} for path: ${relativePath}`,
		);
		return;
	}
	const nameToAdd = importName;
	if (!importMap.has(relativePath)) {
		importMap.set(relativePath, {
			namedImports: new Set(),
			isNamespaceImport: false,
		});
	}
	const entry = importMap.get(relativePath);
	if (!entry || entry.isNamespaceImport) {
		logger.warn(
			`Skipping named import aggregation for ${relativePath} due to existing namespace import or missing entry.`,
		);
		return;
	}
	entry.namedImports.add(nameToAdd);
	logger.debug(
		`Aggregated named import: ${nameToAdd} for path: ${relativePath}`,
	);
}

/**
 * 外部インポート情報を処理し、インポートパスを解決して ImportMap に追加する。
 */
function processExternalImports(
	importMap: ImportMap,
	neededExternalImports: NeededExternalImports,
	newFilePath: string,
): void {
	logger.debug("Processing external imports...");
	for (const [
		originalModuleSpecifier,
		{ names, declaration, isNamespaceImport, namespaceImportName },
	] of neededExternalImports.entries()) {
		const moduleSourceFile = declaration?.getModuleSpecifierSourceFile();
		let relativePath: string;

		if (
			moduleSourceFile &&
			!moduleSourceFile.getFilePath().includes("/node_modules/")
		) {
			const absoluteModulePath = moduleSourceFile.getFilePath();
			relativePath = calculateRelativePath(newFilePath, absoluteModulePath);
			logger.debug(
				`Calculated relative path for NON-node_modules import: ${relativePath} (from ${absoluteModulePath})`,
			);
		} else {
			relativePath = originalModuleSpecifier;
			logger.debug(
				`Using original module specifier for node_modules or unresolved import: ${relativePath}`,
			);
		}

		if (isNamespaceImport && namespaceImportName) {
			if (!importMap.has(relativePath)) {
				importMap.set(relativePath, {
					namedImports: new Set(),
					isNamespaceImport: true,
					namespaceImportName: namespaceImportName,
				});
				logger.debug(
					`Added namespace import: ${namespaceImportName} for path: ${relativePath}`,
				);
			} else {
				logger.warn(
					`Namespace import for ${relativePath} conflicts with existing non-namespace imports. Skipping.`,
				);
			}
			continue;
		}

		const defaultImportNode = declaration?.getDefaultImport();
		const actualDefaultName = defaultImportNode?.getText();

		for (const name of names) {
			const isDefaultFlag = name === "default" && !!actualDefaultName;
			if (isDefaultFlag) {
				if (!actualDefaultName) {
					logger.warn(
						`Default import name was expected but not found for ${relativePath}. Skipping default import.`,
					);
					continue;
				}
				aggregateImports(importMap, relativePath, actualDefaultName, true);
			} else {
				aggregateImports(importMap, relativePath, name, false);
			}
		}
	}
}

/**
 * 内部依存関係を処理し、ImportMap に追加する名前を返す。
 */
function processInternalDependencies(
	importMap: ImportMap,
	classifiedDependencies: DependencyClassification[],
	newFilePath: string,
	originalFilePath: string,
): void {
	logger.debug("Processing internal dependencies for import map...");
	const dependenciesToImportNames = new Set<string>();

	for (const dep of classifiedDependencies) {
		if (dep.type === "importFromOriginal" || dep.type === "addExport") {
			logger.debug(`Internal dependency to import from original: ${dep.name}`);
			dependenciesToImportNames.add(dep.name);
		}
	}

	if (dependenciesToImportNames.size === 0) {
		logger.debug("No internal dependencies need importing from original file.");
		return;
	}

	const internalImportPath = calculateRelativePath(
		newFilePath,
		originalFilePath,
	);
	logger.debug(
		`Calculated relative path for internal import: ${internalImportPath}`,
	);
	for (const name of dependenciesToImportNames) {
		aggregateImports(importMap, internalImportPath, name, false);
	}
}

/**
 * インポート文を生成するヘルパー
 */
function buildImportStatementString(
	defaultImportName: string | undefined,
	namedImportSpecifiers: string,
	relativePath: string,
	isNamespaceImport: boolean,
	namespaceImportName?: string,
): string {
	const fromPart = `from "${relativePath}";`;
	if (isNamespaceImport && namespaceImportName) {
		return `import * as ${namespaceImportName} ${fromPart}`;
	}
	if (!defaultImportName && !namedImportSpecifiers) {
		logger.debug(`Building side-effect import for ${relativePath}`);
		return `import ${fromPart}`;
	}
	const defaultPart = defaultImportName ? `${defaultImportName}` : "";
	const namedPart = namedImportSpecifiers ? `{ ${namedImportSpecifiers} }` : "";
	const separator = defaultPart && namedPart ? ", " : "";
	return `import ${defaultPart}${separator}${namedPart} ${fromPart}`;
}

// --- エクスポートされるヘルパー関数 ---

/**
 * 移動に必要なインポート情報を計算し、ImportMap を返す。
 */
export function calculateRequiredImportMap(
	neededExternalImports: NeededExternalImports,
	classifiedDependencies: DependencyClassification[],
	newFilePath: string,
	originalFilePath: string,
): ImportMap {
	const importMap: ImportMap = new Map();
	processExternalImports(importMap, neededExternalImports, newFilePath);
	processInternalDependencies(
		importMap,
		classifiedDependencies,
		newFilePath,
		originalFilePath,
	);
	return importMap;
}

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

/**
 * 集約された ImportMap からインポート文の文字列セクションを生成する。
 * (主に generateNewSourceFileContent で使用)
 */
export function buildImportSectionStringFromMap(importMap: ImportMap): string {
	logger.debug("Generating import section string...");
	let importSection = "";
	const sortedPaths = [...importMap.keys()].sort();
	for (const path of sortedPaths) {
		const importData = importMap.get(path);
		if (!importData) {
			logger.warn(`Import data not found for path ${path} during generation.`);
			continue;
		}
		const {
			defaultName,
			namedImports,
			isNamespaceImport,
			namespaceImportName,
		} = importData;
		const sortedNamedImports = [...namedImports].sort().join(", ");
		const importStatement = buildImportStatementString(
			defaultName,
			sortedNamedImports,
			path,
			isNamespaceImport,
			namespaceImportName,
		);
		if (importStatement) {
			importSection += `${importStatement}\n`;
		}
	}
	if (importSection) {
		importSection += "\n";
	}
	logger.debug(`Generated Import Section String:
${importSection}`);
	return importSection;
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
