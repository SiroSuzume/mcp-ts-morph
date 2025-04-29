import type {
	Project,
	SourceFile,
	ImportDeclaration,
	ExportDeclaration,
} from "ts-morph";
import * as path from "node:path";

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

		const targetAbsolutePath = resolveAliasToAbsolutePath(
			moduleSpecifier,
			baseUrl,
			paths,
		);

		if (!targetAbsolutePath) {
			continue;
		}

		const relativePath = calculateRelativePath(
			sourceFilePath,
			targetAbsolutePath,
		);

		if (relativePath === moduleSpecifier) {
			continue;
		}

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

/**
 * @returns 解決された絶対パス、または解決できない場合は undefined
 */
export function resolveAliasToAbsolutePath(
	aliasPath: string,
	baseUrl: string,
	paths: Record<string, string[]>,
): string | undefined {
	for (const [alias, targetPaths] of Object.entries(paths)) {
		if (alias.endsWith("/*")) {
			const prefix = alias.substring(0, alias.length - "/*".length);
			if (!aliasPath.startsWith(`${prefix}/`)) {
				continue;
			}
			const remainingPath = aliasPath.substring(prefix.length + 1);
			// 最初にマッチした targetPath を使う
			const targetBasePath = targetPaths[0]?.substring(
				0,
				targetPaths[0].length - 2,
			); // '*' を除いた部分 (例: 'src')
			if (targetBasePath !== undefined) {
				// baseUrl からの相対パスとして解決
				return path.resolve(baseUrl, targetBasePath, remainingPath);
			}
		} else if (alias === aliasPath) {
			// 完全一致 (例: "@": ["src"])
			if (targetPaths[0]) {
				return path.resolve(baseUrl, targetPaths[0]);
			}
		}
	}

	return undefined;
}

/**
 * @returns POSIX 形式の相対パス (./ や ../ で始まる)、拡張子は除去
 */
export function calculateRelativePath(
	fromPath: string,
	toPath: string,
): string {
	const fromDir = path.dirname(fromPath);
	let relativePath = path.relative(fromDir, toPath);

	relativePath = relativePath.replace(/\\/g, "/");

	if (!relativePath.startsWith(".") && !relativePath.startsWith("/")) {
		// 絶対パスでないことも確認
		relativePath = `./${relativePath}`;
	}

	const ext = path.extname(relativePath);
	if ([".ts", ".tsx", ".js", ".jsx", ".json"].includes(ext)) {
		relativePath = relativePath.substring(0, relativePath.length - ext.length);
	}

	return relativePath;
}
