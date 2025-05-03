import type { Statement, ImportDeclaration } from "ts-morph";
import { Node } from "ts-morph";
import { calculateRelativePath } from "./calculate-relative-path";
import logger from "../utils/logger";
import type { DependencyClassification, NeededExternalImports } from "./types";

/**
 * Statement を取得し、必要なら export キーワードを追加して文字列を返す。
 * isInternalOnly が true の場合は export を付けない。
 */
function getPotentiallyExportedStatement(
	stmt: Statement,
	isInternalOnly: boolean, // 追加: export しない場合は true
): string {
	const stmtText = stmt.getText();

	// デフォルトエクスポートの場合はそのまま返す
	if (Node.isExportable(stmt) && stmt.isDefaultExport()) {
		return stmtText;
	}

	// 内部でのみ使用される依存関係の場合は export しない
	if (isInternalOnly) {
		// 元々 export されていた場合は削除する (例: `export const foo = 1;` -> `const foo = 1;`)
		if (Node.isExportable(stmt) && stmt.isExported()) {
			// 非常に単純な方法: "export " を削除する。より堅牢な方法が必要になる可能性あり。
			// 例: `export default` や `export { name }` など複雑なケースに対応できない。
			// ただし、getInternalDependencies は通常、単純な宣言を返すはず。
			return stmtText.replace(/^export\s+/, "");
		}
		return stmtText; // 元々 export されてなければそのまま
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
	importMap: Map<string, { defaultName?: string; namedImports: Set<string> }>,
	relativePath: string,
	importName: string,
	isDefault: boolean,
	originalDeclaration?: ImportDeclaration, // default名解決用
) {
	let nameToAdd = importName;
	if (isDefault) {
		// 元の default import 名を探す
		nameToAdd = originalDeclaration?.getDefaultImport()?.getText() ?? "default"; // 見つからなければ 'default'?
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
	neededExternalImports: NeededExternalImports, // ★ 事前計算された外部インポート
): string {
	logger.debug("Generating new source file content...");
	logger.debug(
		`Target Declaration: ${targetDeclaration.getText().substring(0, 50)}...`,
	);
	logger.debug("Classified Dependencies:", classifiedDependencies);
	logger.debug("Original File Path:", originalFilePath);
	logger.debug("New File Path:", newFilePath);
	logger.debug("Needed External Imports:", neededExternalImports);

	const importMap = new Map<
		string,
		{ defaultName?: string; namedImports: Set<string> }
	>();
	let declarationSection = "";

	// 1. 外部インポートの処理
	logger.debug("Processing external imports...");
	for (const [
		originalModuleSpecifier,
		{ names, declaration },
	] of neededExternalImports) {
		const moduleSourceFile = declaration?.getModuleSpecifierSourceFile();
		let relativePath: string;
		if (moduleSourceFile) {
			const absoluteModulePath = moduleSourceFile.getFilePath();
			relativePath = calculateRelativePath(newFilePath, absoluteModulePath);
			logger.debug(
				`Calculated relative path for external import: ${relativePath} (from ${absoluteModulePath})`,
			);
		} else {
			relativePath = originalModuleSpecifier;
			logger.debug(
				`Using original module specifier for external import: ${relativePath}`,
			);
		}

		for (const name of names) {
			const isDefault = name === "default";
			aggregateImports(importMap, relativePath, name, isDefault, declaration);
		}
	}

	// 2. 内部依存関係の処理 (classifiedDependencies をループ)
	logger.debug("Processing internal dependencies...");
	const internalDependenciesToInclude: Statement[] = [];
	const internalDependenciesToImportNames = new Set<string>();

	for (const dep of classifiedDependencies) {
		if (dep.type === "moveToNewFile") {
			logger.debug(
				`Dependency to move (no export): ${dep.statement.getText().substring(0, 50)}...`,
			);
			internalDependenciesToInclude.push(dep.statement);
		} else if (dep.type === "importFromOriginal") {
			logger.debug(`Dependency to import from original: ${dep.name}`);
			internalDependenciesToImportNames.add(dep.name);
		} else if (dep.type === "addExport") {
			logger.debug(
				`Dependency to import from original (needs export): ${dep.name}`,
			);
			internalDependenciesToImportNames.add(dep.name);
		}
	}

	// 2a. Case B 依存をインポートマップに追加
	if (internalDependenciesToImportNames.size > 0) {
		const internalImportPath = calculateRelativePath(
			newFilePath,
			originalFilePath,
		);
		logger.debug(
			`Calculated relative path for internal import: ${internalImportPath}`,
		);
		for (const name of internalDependenciesToImportNames) {
			aggregateImports(importMap, internalImportPath, name, false);
		}
	}

	// 3. インポート文セクションの生成
	logger.debug("Generating import section...");
	let importSection = "";
	const sortedPaths = [...importMap.keys()].sort();
	for (const path of sortedPaths) {
		const importData = importMap.get(path);
		if (!importData) {
			logger.warn(`Import data not found for path ${path} during generation.`);
			continue; // Should not happen if map populated correctly
		}
		const { defaultName, namedImports } = importData;
		const sortedNamedImports = [...namedImports].sort().join(", ");
		importSection += `${buildImportStatementString(defaultName, sortedNamedImports, path)}\n`;
	}
	if (importSection) {
		importSection += "\n"; // インポートと本体の間に空行
	}
	logger.debug(`Generated Import Section:\n${importSection}`);

	// 4. 宣言セクションの生成
	logger.debug("Generating declaration section...");
	// 4a. Case A 依存関係 (export なし)
	for (const stmt of internalDependenciesToInclude) {
		declarationSection += `${getPotentiallyExportedStatement(stmt, true)}\n\n`;
	}
	// 4b. 移動対象の宣言 (常に export あり)
	declarationSection += `${getPotentiallyExportedStatement(targetDeclaration, false)}\n`;

	logger.debug(`Generated Declaration Section:\n${declarationSection}`);

	// 5. 結合して返す
	const finalContent = `${importSection}${declarationSection}`;
	logger.debug("Final generated content length:", finalContent.length);

	return finalContent;
}
