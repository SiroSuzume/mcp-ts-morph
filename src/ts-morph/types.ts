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

export type RenameOperation = {
	sourceFile: SourceFile;
	oldPath: string;
	newPath: string;
};

export interface DeclarationToUpdate {
	declaration: ImportDeclaration | ExportDeclaration;
	resolvedPath: string;
	referencingFilePath: string;
	originalSpecifierText: string;
	wasPathAlias?: boolean;
}

export type DependencyClassificationType =
	| "moveToNewFile"
	| "importFromOriginal"
	| "importFromOriginal_addedExport";

/**
 * 移動対象シンボルに対する内部依存関係の分類
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
	{ names: Set<string>; declaration?: ImportDeclaration } // インポート名セットと元の宣言 (パス計算用)
>;
