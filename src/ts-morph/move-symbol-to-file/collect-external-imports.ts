import type {
	Statement,
	SourceFile,
	ImportSpecifier,
	Identifier,
	ImportDeclaration,
} from "ts-morph";
import { SyntaxKind, Node } from "ts-morph";
import type { NeededExternalImports } from "../types";
import logger from "../../utils/logger";

interface ImportSourceInfo {
	moduleSpecifier: string;
	importedName?: string; // Named import (original or alias), or 'default'. Undefined for namespace.
	isDefaultImport: boolean;
	isNamespaceImport: boolean;
	namespaceImportName?: string;
	originalImportDeclaration: ImportDeclaration;
}

// --- getImportDetailsFromDeclarationNode の戻り値型を拡張 ---
type ImportDetailsResult =
	| {
			importDeclaration: ImportDeclaration;
			importSpecifierNode?: ImportSpecifier;
			isDefault: boolean;
			isNamespaceImport: false;
			namespaceImportName?: undefined; // 非名前空間インポートの場合は不要
	  }
	| {
			importDeclaration: ImportDeclaration;
			importSpecifierNode?: undefined; // 名前空間インポートの場合は specifier はない
			isDefault: false;
			isNamespaceImport: true;
			namespaceImportName: string;
	  };

/**
 * 宣言ノードがインポート関連か調べ、詳細情報を返すヘルパー関数
 */
function getImportDetailsFromDeclarationNode(
	declarationNode: Node,
	originalSourceFile: SourceFile,
): ImportDetailsResult | undefined {
	// 戻り値の型を更新
	let importDeclaration: ImportDeclaration | undefined;
	let importSpecifierNode: ImportSpecifier | undefined;
	let isDefault = false;
	let isNamespaceImport = false;
	let namespaceImportName: string | undefined;

	if (Node.isImportSpecifier(declarationNode)) {
		importSpecifierNode = declarationNode;
		importDeclaration = declarationNode.getImportDeclaration();
		isDefault = false;
	} else if (
		Node.isImportClause(declarationNode) &&
		declarationNode.getDefaultImport()
	) {
		importDeclaration = declarationNode.getParentIfKind(
			SyntaxKind.ImportDeclaration,
		);
		isDefault = true;
	} else if (Node.isNamespaceImport(declarationNode)) {
		isNamespaceImport = true;
		const importClause = declarationNode.getParentIfKind(
			SyntaxKind.ImportClause,
		);
		if (!importClause) {
			logger.error(
				"NamespaceImport detected, but its parent is not an ImportClause. AST structure might be unexpected.",
			);
			return undefined;
		}
		importDeclaration = importClause.getParentIfKind(
			SyntaxKind.ImportDeclaration,
		);
		namespaceImportName = declarationNode.getName();
	} else {
		// インポート関連の宣言ノードではない
		return undefined;
	}

	// インポート宣言が見つからない、または元のファイルのものでない場合は対象外
	if (
		!importDeclaration ||
		importDeclaration.getSourceFile() !== originalSourceFile
	) {
		return undefined;
	}

	return {
		importDeclaration,
		importSpecifierNode,
		isDefault,
		isNamespaceImport,
		namespaceImportName,
	} as ImportDetailsResult; // 型アサーションで戻り値の型を保証
}

/**
 * 指定された識別子が、元のファイル内でインポートされたシンボルに対応するかどうかを調べ、
 * 対応する場合はインポート情報を返す。
 */
function findImportSourceForIdentifier(
	identifier: Identifier,
	originalSourceFile: SourceFile,
): ImportSourceInfo | undefined {
	const symbol = identifier.getSymbol();
	if (!symbol) {
		return undefined;
	}

	const declarations = symbol.getDeclarations();

	for (const declarationNode of declarations) {
		const importDetails = getImportDetailsFromDeclarationNode(
			declarationNode,
			originalSourceFile,
		);

		if (!importDetails) continue;

		// ImportDeclaration は必須
		if (!importDetails.importDeclaration) continue;

		const { importDeclaration } = importDetails;
		const moduleSpecifier = importDeclaration.getModuleSpecifierValue();

		// 名前空間インポートの場合
		if (importDetails.isNamespaceImport) {
			return {
				moduleSpecifier,
				isDefaultImport: false,
				isNamespaceImport: true,
				namespaceImportName: importDetails.namespaceImportName,
				originalImportDeclaration: importDeclaration,
			};
		}

		// 名前付き または デフォルトインポートの場合
		let importedName: string | undefined;
		if (importDetails.isDefault) {
			importedName = "default";
		} else if (importDetails.importSpecifierNode) {
			const specifier = importDetails.importSpecifierNode;
			importedName = specifier.getAliasNode()?.getText() ?? specifier.getName();
		} else {
			logger.warn(
				`Unexpected state: Non-namespace and non-default import without specifier for ${identifier.getText()}`,
			);
			continue;
		}

		return {
			moduleSpecifier,
			importedName,
			isDefaultImport: importDetails.isDefault,
			isNamespaceImport: false,
			originalImportDeclaration: importDeclaration,
		};
	}

	return undefined;
}

// --- 新しいヘルパー関数: neededImports マップを更新 ---
function updateNeededImportsMap(
	neededImports: NeededExternalImports,
	importInfo: ImportSourceInfo,
): void {
	const { moduleSpecifier, originalImportDeclaration } = importInfo;

	// まだ記録されていないモジュールパスなら、新しいエントリを作成
	if (!neededImports.has(moduleSpecifier)) {
		neededImports.set(moduleSpecifier, {
			names: new Set(), // インポートする名前 (default含む) を格納する Set
			declaration: originalImportDeclaration, // 元の ImportDeclaration ノード
			// isNamespaceImport, namespaceImportName は後で設定
		});
	}

	// 該当モジュールに必要なインポート情報を追加
	const existingEntry = neededImports.get(moduleSpecifier);
	if (existingEntry) {
		if (importInfo.isNamespaceImport) {
			// 名前空間インポートの場合
			existingEntry.isNamespaceImport = true;
			existingEntry.namespaceImportName = importInfo.namespaceImportName;
		} else if (importInfo.importedName) {
			// 名前付き or デフォルトインポートの場合 (importedName が存在するはず)
			existingEntry.names.add(importInfo.importedName);
		}
	}
}

/**
 * Statement 配列を受け取り、それらの内部で使用されている識別子のうち、
 * 元のファイル (originalSourceFile) でインポートされていたシンボルの情報を収集する。
 * 結果は、インポート元のモジュールパスをキーとした Map で返す。
 *
 * @param statements - 処理対象のステートメント (移動対象とその内部依存関係のうち moveToNewFile のもの)
 * @param originalSourceFile - 移動元のファイル
 * @returns Map<インポート元モジュールパス, { インポート名(or default)の Set, 元の ImportDeclaration }> (NeededExternalImports)
 */
export function collectNeededExternalImports(
	statements: Statement[],
	originalSourceFile: SourceFile,
): NeededExternalImports {
	const neededImports: NeededExternalImports = new Map();
	// 一度処理した Identifier を記録し、重複処理を防ぐ Set
	const processedIdentifiers = new Set<Identifier>();

	// 移動対象のステートメント（とその moveToNewFile 依存）を一つずつ処理
	for (const stmt of statements) {
		// ステートメント内のすべての Identifier (変数名、関数名など) を取得
		const identifiers = stmt.getDescendantsOfKind(SyntaxKind.Identifier);

		// 各 Identifier をチェック
		for (const id of identifiers) {
			// すでに処理済みの Identifier はスキップ
			if (processedIdentifiers.has(id)) continue;

			// この Identifier が元のファイルで外部からインポートされたものか確認
			const importInfo = findImportSourceForIdentifier(id, originalSourceFile);

			if (importInfo) {
				updateNeededImportsMap(neededImports, importInfo);
			}
			processedIdentifiers.add(id);
		}
	}
	return neededImports;
}
