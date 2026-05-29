import * as path from "node:path";

/**
 * E2E の題材となる外部リポジトリの定義。
 *
 * バージョンは必ず固定する（commit SHA をピン留め）。tag は人間向けの目印で、
 * 実際に checkout するのは commit。これにより上流が動いても結果が変わらない。
 */
export interface TargetRepo {
	/** 識別子（キャッシュディレクトリ名にも使う） */
	readonly name: string;
	/** clone 元 */
	readonly repoUrl: string;
	/** 目印のタグ（ドキュメント用途。実体は commit で固定） */
	readonly tag: string;
	/** 固定する commit SHA。clone 後にこの SHA を checkout する */
	readonly commit: string;
	/**
	 * MCP ツールに渡す tsconfig のリポジトリ相対パス。
	 * project references（files:[]）な root tsconfig はソースを読み込まないため、
	 * src 全体を include する設定を選ぶ。
	 */
	readonly tsconfigRelPath: string;
	/**
	 * 依存インストールコマンド（argv。[0] は PATH 上の package manager 実行ファイル）。
	 * frozen-lockfile + ignore-scripts でロックファイル固定・postinstall 不実行。
	 */
	readonly installArgv: readonly string[];
	/** 型チェック: 対象リポジトリの node_modules/.bin 配下の実行ファイル名と引数 */
	readonly typecheckBin: string;
	readonly typecheckArgs: readonly string[];
	/**
	 * ユニットテスト: Node で走る範囲のみ。
	 * format/lint はリファクタ後に必ず差分が出るため検証に含めない。
	 */
	readonly unitTestBin: string;
	readonly unitTestArgs: readonly string[];
}

/**
 * hono: alias を持たない中規模リポジトリ。bun ネイティブ。
 * rename / find-references / move / find-unused / get-type / change-signature の題材。
 * root tsconfig は project references なので src 全体を include する tsconfig.spec.json を使う。
 * vitest は multi-runtime 構成のため Node で走る `main` project のみ実行する。
 */
export const HONO: TargetRepo = {
	name: "hono",
	repoUrl: "https://github.com/honojs/hono.git",
	tag: "v4.12.23",
	commit: "83bfb3bb4a12c1d92c163a39e907df5d662ff78d",
	tsconfigRelPath: "tsconfig.spec.json",
	installArgv: ["bun", "install", "--frozen-lockfile", "--ignore-scripts"],
	typecheckBin: "tsc",
	typecheckArgs: ["--noEmit", "-p", "tsconfig.spec.json"],
	unitTestBin: "vitest",
	unitTestArgs: ["run", "--project", "main"],
};

/**
 * zustand: path alias（zustand / zustand/* → ./src/*）を持つ単一パッケージ。pnpm。
 * remove_path_alias と rename-file-system（alias 経由 import 更新）の題材。
 * 型チェックは root tsconfig.json（src + tests を include, noEmit）。
 */
export const ZUSTAND: TargetRepo = {
	name: "zustand",
	repoUrl: "https://github.com/pmndrs/zustand.git",
	tag: "v5.0.13",
	commit: "6bc451efd5f0d4ef6e7b2c8d6fc6f8340562a31d",
	tsconfigRelPath: "tsconfig.json",
	installArgv: ["pnpm", "install", "--frozen-lockfile", "--ignore-scripts"],
	typecheckBin: "tsc",
	typecheckArgs: ["--noEmit"],
	unitTestBin: "vitest",
	unitTestArgs: ["run"],
};

export const E2E_CACHE_DIR = path.resolve(__dirname, ".cache");

export function targetCheckoutDir(target: TargetRepo): string {
	return path.join(
		E2E_CACHE_DIR,
		`${target.name}@${target.commit.slice(0, 12)}`,
	);
}
