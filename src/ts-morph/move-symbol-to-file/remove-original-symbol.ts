import type { SourceFile, Statement } from "ts-morph";
import { SyntaxKind } from "ts-morph";
import logger from "../../utils/logger";

/**
 * 指定された宣言ノード (Statement) をソースファイルから削除します。
 * 削除対象が複数指定された場合、それらすべてを削除します。
 *
 * @param sourceFile - 対象のソースファイル。
 * @param declarationsToRemove - 削除する宣言ノードの配列。
 */
export function removeOriginalSymbol(
	sourceFile: SourceFile,
	declarationsToRemove: Statement[],
): void {
	if (declarationsToRemove.length === 0) {
		logger.warn("No declarations provided to removeOriginalSymbol.");
		return;
	}

	for (const declaration of declarationsToRemove) {
		const symbolIdentifier =
			declaration.getFirstDescendantByKind(SyntaxKind.Identifier)?.getText() ??
			"(unknown)";

		if (declaration.getParent() !== sourceFile) {
			logger.warn(
				{ symbol: symbolIdentifier, filePath: sourceFile.getFilePath() },
				"Attempted to remove a declaration that is not a direct child of the source file. Skipping.",
			);
			continue;
		}

		logger.trace({ symbol: symbolIdentifier }, "Removing declaration");
		declaration.remove();
	}
}
