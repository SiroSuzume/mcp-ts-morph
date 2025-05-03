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
 * 指定された識別子が、元のファイル内でインポートされたシンボルに対応するかどうかを調べ、
 * 対応する場合はインポート情報を返す。
 */
function findImportSourceForIdentifier(
	identifier: Identifier,
	originalSourceFile: SourceFile,
): ImportSourceInfo | undefined {
	// console.log(`[Debug] Checking identifier: ${identifier.getText()} at ${identifier.getStartLineNumber()}`);

	const symbol = identifier.getSymbol();
	if (!symbol) {
		// console.log(`[Debug] -> Symbol not found`);
		return undefined;
	}

	const declarations = symbol.getDeclarations();
	// console.log(`[Debug] -> Found ${declarations.length} declaration(s)`);

	for (const declarationNode of declarations) {
		// console.log(`[Debug]   Checking declaration: ${declarationNode.getKindName()} at ${declarationNode.getStartLineNumber()} - Text: ${declarationNode.getText().substring(0, 30)}...`);

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
			// console.log(`[Debug]     -> Default import detected via ImportClause!`);
		}
		/*
		else if (Node.isIdentifier(declarationNode)) {
			// ... (commented out fallback logic)
		}
		*/

		if (
			importDeclaration &&
			importDeclaration.getSourceFile() === originalSourceFile
		) {
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
	}

	// console.log(`[Debug] -> No matching import declaration found`);
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
	const processedIdentifiers = new Set<Identifier>();

	for (const stmt of statements) {
		const identifiers = stmt.getDescendantsOfKind(SyntaxKind.Identifier);

		for (const id of identifiers) {
			if (processedIdentifiers.has(id)) continue;

			const importInfo = findImportSourceForIdentifier(id, originalSourceFile);

			if (importInfo) {
				const { moduleSpecifier, importedName, originalImportDeclaration } =
					importInfo;
				if (!neededImports.has(moduleSpecifier)) {
					neededImports.set(moduleSpecifier, {
						names: new Set(),
						declaration: originalImportDeclaration,
					});
				}
				neededImports.get(moduleSpecifier)?.names.add(importedName);
			}
			processedIdentifiers.add(id);
		}
	}
	return neededImports;
}
