import * as path from "node:path";

const DEFAULT_EXTENSIONS_TO_REMOVE = [
	".ts",
	".tsx",
	".js",
	".jsx",
	".json",
	".mjs",
	".cjs",
];

/**
 * モジュール指定子用の相対パスを計算する
 * fromPath: 参照元ファイルの絶対パス
 * toPath: 参照先ファイルの絶対パス
 * @param options.simplifyIndex /index で終わるパスを簡略化するかどうか (デフォルト: true)
 * @param options.removeExtensions 削除する拡張子のリスト、trueの場合はデフォルトリスト、falseの場合は削除しない (デフォルト: DEFAULT_EXTENSIONS_TO_REMOVE)
 * @returns POSIX 形式の相対パス (./ や ../ で始まる)
 */
export function calculateRelativePath(
	fromPath: string,
	toPath: string,
	options: {
		simplifyIndex?: boolean;
		removeExtensions?: boolean | string[];
	} = {},
): string {
	const defaultOptions = {
		simplifyIndex: true,
		removeExtensions: DEFAULT_EXTENSIONS_TO_REMOVE as string[] | boolean,
	};
	const mergedOptions = { ...defaultOptions, ...options };

	const fromDir = path.dirname(fromPath);
	const relative = path.relative(fromDir, toPath);

	// POSIX 形式に変換し、./ で始まるように調整
	let formatted = relative.replace(/\\/g, "/");
	if (!formatted.startsWith(".") && !formatted.startsWith("/")) {
		formatted = `./${formatted}`;
	}

	const originalExt = path.extname(formatted);
	let extensionRemoved = false;

	// Remove extension if specified
	if (mergedOptions.removeExtensions) {
		const extensionsToRemove =
			mergedOptions.removeExtensions === true
				? DEFAULT_EXTENSIONS_TO_REMOVE // Use default list if 'true'
				: (mergedOptions.removeExtensions as string[]);
		if (extensionsToRemove.includes(originalExt)) {
			formatted = formatted.slice(0, -originalExt.length);
			extensionRemoved = true;
		}
	}

	// Simplify index only if extension was removed (or never existed)
	// and simplifyIndex option is true
	if (mergedOptions.simplifyIndex && extensionRemoved) {
		const indexMatch = formatted.match(/^(\.\.?(\/\.\.)*)\/index$/);
		if (indexMatch) {
			// './index' -> '.'
			// '../index' -> '..'
			// '../../index' -> '../..'
			// etc.
			return indexMatch[1] === "." ? "." : indexMatch[1];
		}
	}

	return formatted;
}
