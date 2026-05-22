import type {
	Project,
	SourceFile,
	ImportDeclaration,
	ExportDeclaration,
} from "ts-morph";
import { calculateRelativePath } from "../_utils/calculate-relative-path";
import { isPathAlias } from "../_utils/path-alias";

/**
 * 1つのソースファイル内のパスエイリアスを相対パスに置換する
 */
function processSourceFile(
	sourceFile: SourceFile,
	aliasKeys: readonly string[],
	dryRun: boolean,
): boolean {
	let changed = false;
	const sourceFilePath = sourceFile.getFilePath();
	const declarations: (ImportDeclaration | ExportDeclaration)[] = [
		...sourceFile.getImportDeclarations(),
		...sourceFile.getExportDeclarations(),
	];

	for (const declaration of declarations) {
		const moduleSpecifierNode = declaration.getModuleSpecifier();
		if (!moduleSpecifierNode) continue;

		const moduleSpecifier = moduleSpecifierNode.getLiteralText();

		if (!isPathAlias(moduleSpecifier, aliasKeys)) {
			continue;
		}

		const resolvedSourceFile = declaration.getModuleSpecifierSourceFile();
		if (!resolvedSourceFile) {
			continue;
		}
		const targetAbsolutePath = resolvedSourceFile.getFilePath();

		const relativePath = calculateRelativePath(
			sourceFilePath,
			targetAbsolutePath,
			{
				simplifyIndex: false,
				removeExtensions: true,
			},
		);

		if (!dryRun) {
			declaration.setModuleSpecifier(relativePath);
		}
		changed = true;
	}
	return changed;
}

/**
 * 指定されたパス (ファイルまたはディレクトリ) 内のパスエイリアスを相対パスに置換する
 */
export async function removePathAlias({
	project,
	targetPath,
	dryRun = false,
	paths,
}: {
	project: Project;
	targetPath: string;
	dryRun?: boolean;
	paths: Record<string, string[]>;
}): Promise<{ changedFiles: string[] }> {
	let filesToProcess: SourceFile[] = [];
	const directory = project.getDirectory(targetPath);

	if (directory) {
		filesToProcess = directory.getSourceFiles("**/*.{ts,tsx,js,jsx}");
	} else {
		const sourceFile = project.getSourceFile(targetPath);
		if (!sourceFile) {
			throw new Error(
				`指定されたパスはプロジェクト内でディレクトリまたはソースファイルとして見つかりません: ${targetPath}`,
			);
		}
		filesToProcess.push(sourceFile);
	}

	const aliasKeys = Object.keys(paths);
	const changedFilePaths: string[] = [];

	for (const sourceFile of filesToProcess) {
		const modified = processSourceFile(sourceFile, aliasKeys, dryRun);
		if (!modified) {
			continue;
		}
		changedFilePaths.push(sourceFile.getFilePath());
	}

	return { changedFiles: changedFilePaths };
}
