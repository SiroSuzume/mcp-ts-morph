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
	const declarationsForThisOperation = new Set<
		ImportDeclaration | ExportDeclaration
	>();

	try {
		const exportSymbols = sourceFile.getExportSymbols();
		logger.trace(
			{ file: sourceFile.getFilePath(), count: exportSymbols.length },
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
	} catch (error) {
		logger.warn(
			{ file: sourceFile.getFilePath(), err: error },
			"Error processing rename operation symbols",
		);
	}
	return declarationsForThisOperation;
}
