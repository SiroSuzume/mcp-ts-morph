import * as path from "node:path";

/**
 * モジュール指定子用の相対パスを計算する
 * fromPath: 参照元ファイルの絶対パス
 * toPath: 参照先ファイルの絶対パス (リネーム後の新しいパス)
 */
export function calculateRelativePath(
	fromPath: string,
	toPath: string,
): string {
	const relative = path.relative(path.dirname(fromPath), toPath);
	let formatted = relative.startsWith(".") ? relative : `./${relative}`;

	// 拡張子 .ts, .tsx を削除
	formatted = formatted.replace(/\.(ts|tsx)$/, "");

	// index ファイルへの参照を簡略化
	const indexMatch = formatted.match(/^(\.\.?(\/\.\.)*)\/index$/);
	if (indexMatch) {
		// './index' -> '.'
		// '../index' -> '..'
		// '../../index' -> '../..'
		// etc.
		return indexMatch[1] === "." ? "." : indexMatch[1];
	}

	return formatted;
}
