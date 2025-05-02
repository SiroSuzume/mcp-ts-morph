import type { SourceFile, Statement } from "ts-morph";
import logger from "../utils/logger"; // logger をインポート

/**
 * 指定されたソースファイルから、指定された宣言ステートメントを削除します。
 *
 * @param sourceFile 変更対象のソースファイル。
 * @param declarationStatement 削除する宣言ステートメント。 null/undefined の場合は何もしません。
 */
export function removeOriginalSymbol(
	sourceFile: SourceFile, // sourceFile は実際には使わないが、将来の拡張のために残す
	declarationStatement: Statement | undefined | null,
): void {
	if (!declarationStatement) {
		logger.debug(
			"Declaration statement to remove is null or undefined. Skipping removal.",
		);
		return;
	}

	try {
		logger.trace(
			{
				statement: declarationStatement.getText().split("\n")[0],
				file: sourceFile.getFilePath(),
			},
			"Removing declaration statement",
		);
		declarationStatement.remove();
	} catch (error) {
		// remove() がエラーを投げる可能性は低いが一応ハンドリング
		logger.error(
			{
				err: error,
				statement: declarationStatement.getText(),
				file: sourceFile.getFilePath(),
			},
			"Error removing declaration statement",
		);
		// エラーを再スローするかどうかは要件による
		// throw error;
	}
}
