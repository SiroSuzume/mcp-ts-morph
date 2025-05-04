import type {
	Project,
	SourceFile,
	ImportDeclaration,
	ExportDeclaration,
} from "ts-morph";
import { calculateRelativePath } from "../_utils/calculate-relative-path";

/**
 * モジュール指定子がパスエイリアスかどうかを判定する
 */
function isPathAlias(moduleSpecifier: string, alias: string[]): boolean {
	// paths のキー（例: "@/*", "@components/*", "exact-alias"）に基づいて判定
	return alias.some((alias) => {
		if (moduleSpecifier === alias) {
			return true; // 完全一致
		}
		if (!alias.endsWith("/*")) {
			return false; // ワイルドカードエイリアスでない場合は false
		}
		const prefix = alias.substring(0, alias.length - 1); // 末尾の '*' を除く (例: "@/", "@components/")
		return moduleSpecifier.startsWith(prefix);
	});
}

/**
 * 1つのソースファイル内のパスエイリアスを相対パスに置換する
 */
function processSourceFile(
	sourceFile: SourceFile,
	baseUrl: string,
	paths: Record<string, string[]>,
	dryRun: boolean,
): boolean {
	let changed = false;
	const sourceFilePath = sourceFile.getFilePath();
	const alias = Object.keys(paths);
	const declarations: (ImportDeclaration | ExportDeclaration)[] = [
		...sourceFile.getImportDeclarations(),
		...sourceFile.getExportDeclarations(),
	];

	for (const declaration of declarations) {
		const moduleSpecifierNode = declaration.getModuleSpecifier();
		if (!moduleSpecifierNode) continue;

		const moduleSpecifier = moduleSpecifierNode.getLiteralText();

		if (!isPathAlias(moduleSpecifier, alias)) {
			continue;
		}

		// TypeScript/ts-morph の解決結果を使用
		const resolvedSourceFile = declaration.getModuleSpecifierSourceFile();

		if (!resolvedSourceFile) {
			// console.warn(`[remove-path-alias] Could not resolve module specifier: ${moduleSpecifier} in ${sourceFilePath}`);
			continue; // 解決できないエイリアスはスキップ
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
	baseUrl,
	paths,
}: {
	project: Project; // Project インスタンスは呼び出し元で作成・管理
	targetPath: string;
	dryRun?: boolean;
	baseUrl: string;
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

	const changedFilePaths: string[] = [];

	for (const sourceFile of filesToProcess) {
		const modified = processSourceFile(sourceFile, baseUrl, paths, dryRun);
		if (!modified) {
			continue;
		}
		changedFilePaths.push(sourceFile.getFilePath());
	}

	return { changedFiles: changedFilePaths };
}
