import type {
	SourceFile,
	ImportDeclaration,
	ExportDeclaration,
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
