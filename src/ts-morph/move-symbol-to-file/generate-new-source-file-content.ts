import type { Statement, ImportDeclaration } from "ts-morph";
import { Node } from "ts-morph";
import { calculateRelativePath } from "../_utils/calculate-relative-path";
import logger from "../../utils/logger";
import type { DependencyClassification, NeededExternalImports } from "../types";

// インポート情報を格納する Map の型エイリアス
type ImportMap = Map<
	string,
	{ defaultName?: string; namedImports: Set<string> }
>;

/**
 * Statement を取得し、必要なら export キーワードを追加して文字列を返す。
 * isInternalOnly が true の場合は export キーワードを付けない。
 */
function getPotentiallyExportedStatement(
	stmt: Statement,
	isInternalOnly: boolean,
): string {
	const stmtText = stmt.getText();

	// デフォルトエクスポートの場合はそのまま返す
	if (Node.isExportable(stmt) && stmt.isDefaultExport()) {
		return stmtText;
	}

	// 内部でのみ使用される依存関係の場合は export しない
	if (isInternalOnly) {
		// 元々 export されていた場合は削除する
		if (Node.isExportable(stmt) && stmt.isExported()) {
			return stmtText.replace(/^export\s+/, "");
		}
		return stmtText;
	}

	// それ以外の場合 (移動対象の宣言、または外部からも参照される依存関係) は export を確認・追加
	let isExported = false;
	if (Node.isExportable(stmt)) {
		isExported = stmt.isExported();
	}
	if (!isExported) {
		return `export ${stmtText}`;
	}
	return stmtText;
}

/**
 * インポート情報を Map に集約するヘルパー
 */
function aggregateImports(
	importMap: ImportMap,
	relativePath: string,
	importName: string,
	isDefault: boolean,
	originalDeclaration?: ImportDeclaration,
) {
	let nameToAdd = importName;
	if (isDefault) {
		nameToAdd = originalDeclaration?.getDefaultImport()?.getText() ?? "default";
		if (nameToAdd === "default") {
			logger.warn(
				`Could not resolve default import name for path: ${relativePath}`,
			);
		}
	}

	if (!importMap.has(relativePath)) {
		importMap.set(relativePath, { namedImports: new Set() });
	}
	const entry = importMap.get(relativePath);
	if (!entry) return;

	if (isDefault) {
		entry.defaultName = nameToAdd;
	} else {
		entry.namedImports.add(nameToAdd);
	}
}

/**
 * インポート文を生成するヘルパー
 */
function buildImportStatementString(
	defaultImportName: string | undefined,
	namedImportSpecifiers: string,
	relativePath: string,
): string {
	const defaultPart = defaultImportName ? `${defaultImportName}` : "";
	const namedPart = namedImportSpecifiers ? `{ ${namedImportSpecifiers} }` : "";
	const separator = defaultPart && namedPart ? ", " : "";
	const fromPart = `from "${relativePath}";`;

	if (!defaultPart && !namedPart) {
		logger.warn(
			`Attempted to build import statement with no imports for ${relativePath}`,
		);
		return `import ${fromPart}`;
	}

	return `import ${defaultPart}${separator}${namedPart} ${fromPart}`;
}

/**
 * 外部インポート情報を処理し、インポートパスを解決して ImportMap を作成する。
 */
function prepareExternalImportsMap(
	neededExternalImports: NeededExternalImports,
	newFilePath: string,
): ImportMap {
	logger.debug("Processing external imports...");
	const importMap: ImportMap = new Map();
	for (const [
		originalModuleSpecifier,
		{ names, declaration },
	] of neededExternalImports) {
		const moduleSourceFile = declaration?.getModuleSpecifierSourceFile();
		let relativePath: string;

		// node_modules 内かチェック
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

		for (const name of names) {
			const isDefault = name === "default";
			aggregateImports(importMap, relativePath, name, isDefault, declaration);
		}
	}
	return importMap;
}

/**
 * 内部依存関係を分類し、新しいファイルに含める宣言とインポートする名前を返す。
 */
function classifyInternalDependenciesForNewFile(
	classifiedDependencies: DependencyClassification[],
): {
	dependenciesToInclude: Statement[];
	dependenciesToImportNames: Set<string>;
} {
	logger.debug("Processing internal dependencies...");
	const dependenciesToInclude: Statement[] = [];
	const dependenciesToImportNames = new Set<string>();

	for (const dep of classifiedDependencies) {
		if (dep.type === "moveToNewFile") {
			logger.debug(
				`Dependency to move (no export): ${dep.statement.getText().substring(0, 50)}...`,
			);
			dependenciesToInclude.push(dep.statement);
		} else if (dep.type === "importFromOriginal" || dep.type === "addExport") {
			logger.debug(`Dependency to import from original: ${dep.name}`);
			dependenciesToImportNames.add(dep.name);
		}
	}
	return { dependenciesToInclude, dependenciesToImportNames };
}

/**
 * 集約された ImportMap からインポート文の文字列を生成する。
 */
function buildImportSectionStringFromMap(importMap: ImportMap): string {
	logger.debug("Generating import section...");
	let importSection = "";
	const sortedPaths = [...importMap.keys()].sort();
	for (const path of sortedPaths) {
		const importData = importMap.get(path);
		if (!importData) {
			logger.warn(`Import data not found for path ${path} during generation.`);
			continue;
		}
		const { defaultName, namedImports } = importData;
		const sortedNamedImports = [...namedImports].sort().join(", ");
		importSection += `${buildImportStatementString(defaultName, sortedNamedImports, path)}\n`;
	}
	if (importSection) {
		importSection += "\n"; // インポートと本体の間に空行
	}
	logger.debug(`Generated Import Section:\n${importSection}`);
	return importSection;
}

/**
 * 新しいファイルに含める宣言から宣言セクションの文字列を生成する。
 */
function buildDeclarationSectionString(
	dependenciesToInclude: Statement[],
	targetDeclaration: Statement,
): string {
	logger.debug("Generating declaration section...");
	let declarationSection = "";
	// 移動する内部依存関係 (export なし)
	for (const stmt of dependenciesToInclude) {
		declarationSection += `${getPotentiallyExportedStatement(stmt, true)}\n\n`;
	}
	// 移動対象の宣言 (常に export あり)
	declarationSection += `${getPotentiallyExportedStatement(targetDeclaration, false)}\n`;
	logger.debug(`Generated Declaration Section:\n${declarationSection}`);
	return declarationSection;
}

/**
 * 移動対象の宣言と依存関係から、新しいファイルの内容を生成する。(リファクタリング後)
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

	// 1. 外部インポート情報を処理して ImportMap を準備
	const importMap = prepareExternalImportsMap(
		neededExternalImports,
		newFilePath,
	);

	// 2. 内部依存関係を分類
	const { dependenciesToInclude, dependenciesToImportNames } =
		classifyInternalDependenciesForNewFile(classifiedDependencies);

	// 2a. 内部依存でインポートが必要なものを ImportMap に追加
	if (dependenciesToImportNames.size > 0) {
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

	// 3. インポート文セクションの生成
	const importSection = buildImportSectionStringFromMap(importMap);

	// 4. 宣言セクションの生成
	const declarationSection = buildDeclarationSectionString(
		dependenciesToInclude,
		targetDeclaration,
	);

	// 5. 結合して返す
	const finalContent = `${importSection}${declarationSection}`;
	logger.debug("Final generated content length:", finalContent.length);

	return finalContent;
}
