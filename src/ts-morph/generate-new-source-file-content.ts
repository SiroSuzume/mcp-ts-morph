import type {
	Statement,
	SourceFile,
	ImportSpecifier,
	Identifier,
	ImportDeclaration,
} from "ts-morph";
import { SyntaxKind, Node } from "ts-morph";
import { calculateRelativePath } from "./calculate-relative-path";
import logger from "../utils/logger";

// --- 新しいヘルパー関数 ---
interface ImportSourceInfo {
	moduleSpecifier: string;
	importedName: string; // Named import (original or alias), or 'default'
	isDefaultImport: boolean;
	originalImportDeclaration: ImportDeclaration; // Needed later for alias/default name lookup
}

/**
 * 指定された識別子が、元のファイル内でインポートされたシンボルに対応するかどうかを調べ、
 * 対応する場合はインポート情報を返す。
 * 識別子の定義を辿り、それが元のファイル内の ImportDeclaration に由来するかを確認する。
 */
function findImportSourceForIdentifier(
	identifier: Identifier,
	originalSourceFile: SourceFile,
): ImportSourceInfo | undefined {
	const symbol = identifier.getSymbol();
	if (!symbol) return undefined;

	const declarations = symbol.getDeclarations();

	// シンボルの宣言ノードを走査
	for (const declarationNode of declarations) {
		let importDeclaration: ImportDeclaration | undefined;
		let importSpecifierNode: ImportSpecifier | undefined;
		let isDefault = false;

		// ケース1: 名前付きインポートの宣言 (`import { foo } from './bar'`) か？
		if (Node.isImportSpecifier(declarationNode)) {
			importSpecifierNode = declarationNode;
			importDeclaration = declarationNode.getImportDeclaration();
			isDefault = false;
		}
		// ケース2: デフォルトインポートの宣言 (`import foo from './bar'`) か？
		// デフォルトインポートは ImportClause の直下にある Identifier として表現される
		else if (Node.isIdentifier(declarationNode)) {
			const importClause = declarationNode.getParentIfKind(
				SyntaxKind.ImportClause,
			);
			if (importClause && importClause.getDefaultImport() === declarationNode) {
				importDeclaration = importClause.getParentIfKind(
					SyntaxKind.ImportDeclaration,
				);
				isDefault = true;
			}
		}

		// 見つけた ImportDeclaration が「元のファイル」のものであることを確認
		// (シンボルが別のファイルで定義され、それがインポートされているケースを除くため)
		if (
			importDeclaration &&
			importDeclaration.getSourceFile() === originalSourceFile
		) {
			const moduleSpecifier = importDeclaration.getModuleSpecifierValue();
			let importedName: string;

			// デフォルトインポートの場合、特別な名前 'default' を使用して区別
			if (isDefault) {
				importedName = "default"; // 特殊なマーカー
			} else if (importSpecifierNode) {
				// 名前付きインポートの場合、エイリアスがあればエイリアス名を、なければ元の名前を使用
				importedName =
					importSpecifierNode.getAliasNode()?.getText() ??
					importSpecifierNode.getName();
			} else {
				// 通常ここには来ないはずだが、安全のためスキップ
				continue;
			}

			return {
				moduleSpecifier,
				importedName, // インポート名（または 'default'）
				isDefaultImport: isDefault,
				originalImportDeclaration: importDeclaration, // 後でエイリアス復元などに使う可能性のため保持
			};
		}
	}

	return undefined; // この識別子は元のファイルでのインポート由来ではなかった
}

/**
 * Statement 配列を受け取り、それらの内部で使用されている識別子のうち、
 * 元のファイル (originalSourceFile) でインポートされていたシンボルの情報を収集する。
 * 結果は、インポート元のモジュールパスをキーとした Map で返す。
 *
 * @param statements - 処理対象のステートメント (移動対象とその内部依存関係)
 * @param originalSourceFile - 移動元のファイル
 * @returns Map<インポート元モジュールパス, { インポート名(or default)の Set, 元の ImportDeclaration }>
 */
function collectNeededImportsForStatements(
	statements: Statement[],
	originalSourceFile: SourceFile,
): Map<string, { names: Set<string>; declaration: ImportDeclaration }> {
	// Map<originalModuleSpecifier, { names: Set<importedName | 'default'>, declaration: ImportDeclaration }>
	const neededImports = new Map<
		string,
		{ names: Set<string>; declaration: ImportDeclaration }
	>();
	const processedIdentifiers = new Set<Identifier>(); // パフォーマンス: 同じ識別子を何度もチェックしない

	for (const stmt of statements) {
		// ステートメント内のすべての Identifier を取得
		const identifiers = stmt.getDescendantsOfKind(SyntaxKind.Identifier);

		for (const id of identifiers) {
			if (processedIdentifiers.has(id)) continue;

			// ヘルパー関数でインポート情報を取得
			const importInfo = findImportSourceForIdentifier(id, originalSourceFile);

			if (importInfo) {
				// インポート情報が見つかった場合、結果マップに集約
				const { moduleSpecifier, importedName, originalImportDeclaration } =
					importInfo;
				if (!neededImports.has(moduleSpecifier)) {
					// 新しいモジュールパスの場合、エントリを作成
					neededImports.set(moduleSpecifier, {
						names: new Set(),
						declaration: originalImportDeclaration,
					});
				}
				// 既存のエントリにインポート名を追加
				neededImports.get(moduleSpecifier)?.names.add(importedName);
			}
			processedIdentifiers.add(id);
		}
	}
	return neededImports;
}

/**
 * Statement を取得し、必要なら export キーワードを追加して文字列を返す。
 */
function getPotentiallyExportedStatement(stmt: Statement): string {
	const stmtText = stmt.getText();
	let isExported = false;
	if (Node.isExportable(stmt)) {
		isExported = stmt.isExported();
	}
	if (Node.isExportable(stmt) && stmt.isDefaultExport()) {
		return stmtText;
	}
	if (!isExported) {
		return `export ${stmtText}`;
	}
	return stmtText;
}

/**
 * 移動対象の宣言と依存関係から、新しいファイルの内容を生成する。(リファクタリング後)
 */
export function generateNewSourceFileContent(
	targetDeclaration: Statement,
	internalDependencies: Statement[],
	originalFilePath: string,
	newFilePath: string,
): string {
	const originalSourceFile = targetDeclaration.getSourceFile();
	const statementsToProcess = [...internalDependencies, targetDeclaration];

	// 1. 必要なインポート情報を収集 (移動するコードが必要とする外部シンボルを特定)
	const neededImports = collectNeededImportsForStatements(
		statementsToProcess,
		originalSourceFile,
	);

	// 2. 新しいファイル用のインポート文セクションを生成
	let importSection = "";
	// 結果の順序性を保つため、モジュールパスでソート
	const sortedModules = [...neededImports.keys()].sort();

	for (const originalModuleSpecifier of sortedModules) {
		const importData = neededImports.get(originalModuleSpecifier);
		if (!importData) continue;

		const { names, declaration: originalImportDecl } = importData;

		// インポートパスを新しいファイルの場所からの相対パスに変換
		const moduleSourceFile = originalImportDecl?.getModuleSpecifierSourceFile();
		let relativePath: string;

		if (moduleSourceFile) {
			// モジュールが解決できれば、絶対パスから相対パスを計算
			const absoluteModulePath = moduleSourceFile.getFilePath();
			relativePath = calculateRelativePath(newFilePath, absoluteModulePath);
		} else {
			// モジュールが解決できない場合 (例: node_modules)、元のパスをそのまま使用
			// TODO: node_modules のパス解決改善の可能性検討
			relativePath = originalModuleSpecifier;
			logger.warn(
				`Could not resolve module source file for '${originalModuleSpecifier}'. Path might be incorrect.`,
			);
		}

		// --- インポート文の組み立て ---

		// 1. デフォルトインポート名を取得
		const defaultImportName = names.has("default")
			? originalImportDecl?.getDefaultImport()?.getText()
			: undefined;

		// 2. 名前付きインポート指定子の文字列を生成
		const namedImportSpecifiersString = [...names]
			.filter((name) => name !== "default")
			.sort()
			.join(", ");

		// 3. ヘルパー関数でインポート文文字列を生成
		const importStmt = buildImportStatementString(
			defaultImportName,
			namedImportSpecifiersString,
			relativePath,
		);

		if (importStmt) {
			importSection += importStmt;
		} else {
			// 通常ここには来ないはず (names が空ならループの最初で continue される)
			logger.warn(
				`Skipping import for ${relativePath} as no valid named or default imports were found.`,
			);
		}
	}

	// 3. 宣言部分を生成 (移動対象の宣言と内部依存関係を export 付きで文字列化)
	const declarationSection = statementsToProcess
		.map(getPotentiallyExportedStatement)
		.join("\n\n");

	// 4. インポートセクションと宣言セクションを結合して最終的なファイル内容を作成
	let finalContent = "";
	if (importSection) {
		// インポート文がある場合、末尾の不要な改行を削除し、宣言部との間に空行を追加
		finalContent += `${importSection.trimEnd()}\n\n`;
	}
	finalContent += declarationSection;

	// 最後に全体の末尾に改行が1つだけ付くように調整
	return `${finalContent.trim()}\n`;
}

// --- ヘルパー関数 ---

/**
 * インポート情報を元に `import ... from "...";` 形式の文字列を組み立てる。
 * デフォルトインポートも名前付きインポートもない場合は空文字列を返す。
 *
 * @param defaultImportName デフォルトインポート名 (例: "React")、なければ undefined。
 * @param namedImportSpecifiers 名前付きインポート指定子の結合文字列 (例: "useState, useEffect")、なければ空文字列。
 * @param relativePath インポート元の相対パス (例: "../hooks")。
 * @returns 組み立てられたインポート文の文字列、または空文字列。
 */
function buildImportStatementString(
	defaultImportName: string | undefined,
	namedImportSpecifiers: string,
	relativePath: string,
): string {
	// デフォルトも名前付きもない場合はインポート不要
	if (!defaultImportName && !namedImportSpecifiers) {
		return "";
	}

	let statement = "import ";

	if (defaultImportName) {
		statement += defaultImportName;
		if (namedImportSpecifiers) {
			statement += ", "; // default と named が両方あればカンマ追加
		}
	}

	if (namedImportSpecifiers) {
		statement += `{ ${namedImportSpecifiers} }`;
	}

	statement += ` from "${relativePath}";\n`;

	return statement;
}
