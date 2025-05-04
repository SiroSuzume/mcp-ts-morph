import type { SourceFile, Statement } from "ts-morph";
import { SyntaxKind } from "ts-morph";
import logger from "../../utils/logger"; // logger をインポート

/**
 * 指定された宣言ノード (Statement) をソースファイルから削除します。
 * 削除対象が複数指定された場合、それらすべてを削除します。
 *
 * @param sourceFile - 対象のソースファイル。
 * @param declarationsToRemove - 削除する宣言ノードの配列。
 */
export function removeOriginalSymbol(
	sourceFile: SourceFile,
	declarationsToRemove: Statement[], // 引数を配列に変更
): void {
	// 削除対象が見つからない場合は何もしない
	if (declarationsToRemove.length === 0) {
		logger.warn("No declarations provided to removeOriginalSymbol.");
		return;
	}

	for (const declaration of declarationsToRemove) {
		const symbolIdentifier = declaration
			.getFirstDescendantByKind(SyntaxKind.Identifier)
			?.getText(); // デバッグ用にシンボル名を取得

		if (declaration.getParent() !== sourceFile) {
			logger.warn(
				{
					symbol: symbolIdentifier ?? "(unknown)",
					filePath: sourceFile.getFilePath(),
				},
				"Attempted to remove a declaration that is not a direct child of the source file. Skipping.",
			);
			// continue; // 直接の子でない場合も削除を試みるべきか？ 一旦コメントアウトして試行
		}

		try {
			logger.trace(
				{ symbol: symbolIdentifier ?? "(unknown)" },
				"Removing declaration",
			);
			// TODO: remove() が常に安全か確認。場合によっては getLeadingTriviaWidth など考慮？
			declaration.remove();
		} catch (err) {
			logger.error(
				{
					err,
					symbol: symbolIdentifier ?? "(unknown)",
					filePath: sourceFile.getFilePath(),
				},
				"Failed to remove declaration",
			);
			// エラーが発生しても処理を続ける
		}
	}
}
