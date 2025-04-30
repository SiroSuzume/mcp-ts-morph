import type {
	SourceFile,
	ImportDeclaration,
	ExportDeclaration,
} from "ts-morph";

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

/**
 * 更新が必要な Import/Export 宣言の情報。
 */
export interface DeclarationToUpdate {
	declaration: ImportDeclaration | ExportDeclaration;
	resolvedPath: string; // モジュール指定子が解決された元の絶対パス
	referencingFilePath: string; // この宣言が含まれるファイルの絶対パス
	originalSpecifierText: string; // 元のモジュール指定子のテキスト
}
