import type {
	Project,
	SourceFile,
	ImportDeclaration,
	ExportDeclaration,
} from "ts-morph";
import * as path from "node:path";
// tsMorphProject.ts から共通関数をインポート (initializeProject はここで直接使わず、呼び出し元で使う想定)

// --- Helper Functions ---

/**
 * 指定されたディレクトリ内の TypeScript/JavaScript ファイルを取得する
 */
function getSourceFilesInDirectory(
	project: Project,
	dirPath: string,
): SourceFile[] {
	const directory = project.getDirectory(dirPath);
	if (!directory) {
		return [];
	}
	// .ts, .tsx, .js, .jsx ファイルを対象とする
	// 必要に応じて拡張子を追加・変更してください
	return directory.getSourceFiles("**/*.{ts,tsx,js,jsx}");
}

/**
 * モジュール指定子がパスエイリアスかどうかを判定する
 */
function isPathAlias(
	moduleSpecifier: string,
	paths: Record<string, string[]>,
): boolean {
	// paths のキー（例: "@/*", "@components/*", "exact-alias"）に基づいて判定
	return Object.keys(paths).some((alias) => {
		if (alias.endsWith("/*")) {
			const prefix = alias.substring(0, alias.length - 1); // 末尾の '*' を除く (例: "@/", "@components/")
			return moduleSpecifier.startsWith(prefix);
		}
		return moduleSpecifier === alias; // 完全一致
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

	const declarations: (ImportDeclaration | ExportDeclaration)[] = [
		...sourceFile.getImportDeclarations(),
		...sourceFile.getExportDeclarations(),
	];

	for (const declaration of declarations) {
		const moduleSpecifierNode = declaration.getModuleSpecifier();
		if (!moduleSpecifierNode) continue;

		const moduleSpecifier = moduleSpecifierNode.getLiteralText();

		// 修正した isPathAlias を使用
		if (isPathAlias(moduleSpecifier, paths)) {
			// 1. エイリアスを絶対パスに解決
			const targetAbsolutePath = resolveAliasToAbsolutePath(
				moduleSpecifier,
				baseUrl,
				paths,
			);

			if (targetAbsolutePath) {
				// 2. 絶対パスを相対パスに変換
				const relativePath = calculateRelativePath(
					sourceFilePath,
					targetAbsolutePath,
				);

				// moduleSpecifier と計算結果の相対パスが異なるかチェック
				// (拡張子の有無などを考慮するため単純比較ではない方が良い場合もあるが、一旦はこれで)
				if (relativePath !== moduleSpecifier) {
					if (!dryRun) {
						declaration.setModuleSpecifier(relativePath);
						changed = true;
					} else {
						changed = true; // DryRunでも変更があったものとしてマーク
					}
				}
			}
		}
	}
	return changed;
}

// --- Main Function ---

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
		if (sourceFile) {
			filesToProcess.push(sourceFile);
		} else {
			throw new Error(
				`指定されたパスはプロジェクト内でディレクトリまたはソースファイルとして見つかりません: ${targetPath}`,
			);
		}
	}

	const changedFilePaths: string[] = [];

	for (const sourceFile of filesToProcess) {
		const modified = processSourceFile(sourceFile, baseUrl, paths, dryRun);
		if (modified) {
			changedFilePaths.push(sourceFile.getFilePath());
		}
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
			const prefix = alias.substring(0, alias.length - 2); // '@' など
			if (aliasPath.startsWith(`${prefix}/`)) {
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

	// 正規表現で確実に POSIX 形式に変換
	relativePath = relativePath.replace(/\\/g, "/");

	// './' を付与 (変換後に行う)
	if (!relativePath.startsWith(".") && !relativePath.startsWith("/")) {
		// 絶対パスでないことも確認
		relativePath = `./${relativePath}`;
	}

	// 拡張子を除去
	const ext = path.extname(relativePath);
	if ([".ts", ".tsx", ".js", ".jsx", ".json"].includes(ext)) {
		relativePath = relativePath.substring(0, relativePath.length - ext.length);
	}

	return relativePath;
}
