import type { SourceFile } from "ts-morph";

/**
 * ファイル/ディレクトリの古いパスと新しいパスのマッピングを表す型。
 */
export type PathMapping = {
	oldPath: string;
	newPath: string;
};

/**
 * 1つのリネーム操作（ファイル移動とパス情報）を表す型。
 */
export type RenameOperation = {
	sourceFile: SourceFile;
	oldPath: string;
	newPath: string;
};
