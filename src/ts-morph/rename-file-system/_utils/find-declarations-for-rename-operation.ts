import type { ExportDeclaration, ImportDeclaration } from "ts-morph";
import logger from "../../../utils/logger";
import type { RenameOperation } from "../../types";
import { findReferencingDeclarationsForIdentifier } from "./find-referencing-declarations-for-identifier";
import { getIdentifierNodeFromDeclaration } from "./get-identifier-node-from-declaration";

export function findDeclarationsForRenameOperation(
	renameOperation: RenameOperation,
	signal?: AbortSignal,
): Set<ImportDeclaration | ExportDeclaration> {
	const { sourceFile } = renameOperation;
	const targetFilePath = sourceFile.getFilePath();
	const declarationsForThisOperation = new Set<
		ImportDeclaration | ExportDeclaration
	>();

	const exportSymbols = sourceFile.getExportSymbols();
	logger.trace(
		{ file: targetFilePath, count: exportSymbols.length },
		"Found export symbols for rename operation",
	);

	for (const symbol of exportSymbols) {
		signal?.throwIfAborted();
		const symbolDeclarations = symbol.getDeclarations();

		for (const symbolDeclaration of symbolDeclarations) {
			signal?.throwIfAborted();
			const identifierNode =
				getIdentifierNodeFromDeclaration(symbolDeclaration);

			if (!identifierNode) {
				continue;
			}

			const foundDecls = findReferencingDeclarationsForIdentifier(
				identifierNode,
				signal,
			);

			for (const decl of foundDecls) {
				declarationsForThisOperation.add(decl);
			}
		}
	}

	// Namespace import (`import * as X from "..."` / `import type * as X from "..."`)
	// は import 宣言に被参照シンボル名が現れないため symbol → findReferencesAsNodes
	// 経路では取りこぼす。referencing source files から module specifier が
	// 対象ファイルに解決される宣言を直接拾って補完する。
	const referencingFiles = sourceFile.getReferencingSourceFiles();
	for (const referencingFile of referencingFiles) {
		signal?.throwIfAborted();
		const declarations = [
			...referencingFile.getImportDeclarations(),
			...referencingFile.getExportDeclarations(),
		];
		for (const declaration of declarations) {
			signal?.throwIfAborted();
			if (!declaration.getModuleSpecifier()) continue;
			if (
				declaration.getModuleSpecifierSourceFile()?.getFilePath() !==
				targetFilePath
			) {
				continue;
			}
			declarationsForThisOperation.add(declaration);
		}
	}

	return declarationsForThisOperation;
}
