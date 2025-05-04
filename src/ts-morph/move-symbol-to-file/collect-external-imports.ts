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
	importedName: string; // Named import (original or alias), or 'default'
	isDefaultImport: boolean;
	originalImportDeclaration: ImportDeclaration;
}

/**
 * 宣言ノードがインポート関連か調べ、詳細情報を返すヘルパー関数
 */
function getImportDetailsFromDeclarationNode(
	declarationNode: Node,
	originalSourceFile: SourceFile,
):
	| {
			importDeclaration?: ImportDeclaration;
			importSpecifierNode?: ImportSpecifier;
			isDefault: boolean;
	  }
	| undefined {
	let importDeclaration: ImportDeclaration | undefined;
	let importSpecifierNode: ImportSpecifier | undefined;
	let isDefault = false;

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

	return { importDeclaration, importSpecifierNode, isDefault };
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
		// ヘルパー関数で詳細を取得
		const importDetails = getImportDetailsFromDeclarationNode(
			declarationNode,
			originalSourceFile,
		);

		// インポート関連の宣言でなければスキップ
		if (!importDetails) continue;

		// インポート宣言が必須 (ヘルパー内でチェック済みだが念のため)
		if (!importDetails.importDeclaration) continue;

		const { importDeclaration, importSpecifierNode, isDefault } = importDetails;

		const moduleSpecifier = importDeclaration.getModuleSpecifierValue();
		let importedName: string;

		if (isDefault) {
			importedName = "default";
		} else if (importSpecifierNode) {
			importedName =
				importSpecifierNode.getAliasNode()?.getText() ??
				importSpecifierNode.getName();
		} else {
			logger.warn(
				`Unexpected state in findImportSourceForIdentifier: no default import and no specifier for ${identifier.getText()}`,
			);
			continue;
		}

		return {
			moduleSpecifier,
			importedName,
			isDefaultImport: isDefault,
			originalImportDeclaration: importDeclaration,
		};
	}

	return undefined;
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

			// 外部インポート由来の Identifier であれば、必要なインポート情報を記録
			if (importInfo) {
				const { moduleSpecifier, importedName, originalImportDeclaration } =
					importInfo;
				// まだ記録されていないモジュールパスなら、新しいエントリを作成
				if (!neededImports.has(moduleSpecifier)) {
					neededImports.set(moduleSpecifier, {
						names: new Set(), // インポートする名前 (default含む) を格納する Set
						declaration: originalImportDeclaration, // 元の ImportDeclaration ノード
					});
				}
				// 該当モジュールに必要なインポート名を追加 (Set なので重複は自動で排除)
				neededImports.get(moduleSpecifier)?.names.add(importedName);
			}
			// 処理済み Identifier として記録
			processedIdentifiers.add(id);
		}
	}
	return neededImports;
}
