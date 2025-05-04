import type {
	SourceFile,
	ImportDeclaration,
	ExportDeclaration,
	Statement,
} from "ts-morph";

export type PathMapping = {
	oldPath: string;
	newPath: string;
};

/**
 * ファイルまたはフォルダのリネーム操作を表すオブジェクト。
 * @property sourceFile - 対象となる SourceFile インスタンス (ファイルの場合)
 * @property oldPath - リネーム前の絶対パス
 * @property newPath - リネーム後の絶対パス
 */
export type RenameOperation = {
	sourceFile: SourceFile;
	oldPath: string;
	newPath: string;
};

/**
 * ファイルリネーム/移動時に更新が必要なインポート/エクスポート宣言の情報。
 * @property declaration - 対象となる ImportDeclaration または ExportDeclaration ノード
 * @property resolvedPath - 元の import/export が解決していたファイルの絶対パス
 * @property referencingFilePath - この宣言を含むファイルの絶対パス
 * @property originalSpecifierText - 元のモジュール指定子のテキスト (例: './utils', '@/components')
 * @property wasPathAlias - 元の指定子がパスエイリアスだったかどうか (オプショナル)
 */
export interface DeclarationToUpdate {
	declaration: ImportDeclaration | ExportDeclaration;
	resolvedPath: string;
	referencingFilePath: string;
	originalSpecifierText: string;
	wasPathAlias?: boolean;
}

/**
 * シンボル移動時の内部依存関係の分類タイプ。
 * - `moveToNewFile`: 依存関係も新しいファイルに移動する。
 * - `importFromOriginal`: 依存関係は元のファイルに残り、新しいファイルからインポートする。
 * - `importFromOriginal_addedExport`: 依存関係は元のファイルに残り、export を追加して新しいファイルからインポートする。
 */
export type DependencyClassificationType =
	| "moveToNewFile"
	| "importFromOriginal"
	| "importFromOriginal_addedExport";

/**
 * 移動対象シンボルに対する内部依存関係の分類結果。
 */
export type DependencyClassification =
	// 依存関係も新しいファイルに移動し、内部でのみ使用 (export しない)
	| { type: "moveToNewFile"; statement: Statement }
	// 依存関係は元のファイルに残り、新しいファイルから import する
	| { type: "importFromOriginal"; statement: Statement; name: string }
	// 依存関係は元のファイルに残るが、新しいファイルから import するためexportをつける
	| { type: "addExport"; statement: Statement; name: string };

/**
 * generateNewSourceFileContent に渡す外部インポート情報の型エイリアス
 */
export type NeededExternalImports = Map<
	string, // moduleSpecifier (計算後の相対パス or オリジナル)
	{
		names: Set<string>; // 名前付きインポート or デフォルト('default') or エイリアス
		declaration?: ImportDeclaration;
		isNamespaceImport?: boolean; // 名前空間インポートかどうかのフラグ
		namespaceImportName?: string; // 名前空間インポートの識別子 (例: 'path')
	}
>;
