import { spawnSync } from "node:child_process";

/**
 * 子プロセス用のクリーンな環境変数。
 * 外側 Vitest が注入する VITEST_* / NODE_OPTIONS（loader 等）を取り除き、
 * 子の package manager / テストランナーに持ち込まないようにする。
 *
 * @param extra マージする追加の環境変数（例: CI / FORCE_COLOR）
 */
export function childEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
	for (const key of Object.keys(env)) {
		if (key.startsWith("VITEST")) {
			delete env[key];
		}
	}
	env.NODE_OPTIONS = undefined;
	return env;
}

export interface RunResult {
	ok: boolean;
	output: string;
}

/**
 * 子プロセスを同期実行し、stdout/stderr を結合した出力と成否を返す。
 * 依存インストールやテスト出力が大きくなるため maxBuffer を大きめに取る。
 *
 * @param extraEnv childEnv にマージする追加の環境変数
 */
export function run(
	cmd: string,
	args: readonly string[],
	cwd: string,
	extraEnv: NodeJS.ProcessEnv = {},
): RunResult {
	const res = spawnSync(cmd, args as string[], {
		cwd,
		encoding: "utf-8",
		maxBuffer: 64 * 1024 * 1024,
		env: childEnv(extraEnv),
	});
	const output = `${res.stdout ?? ""}${res.stderr ?? ""}`;
	if (res.error) {
		return { ok: false, output: `${res.error.message}\n${output}` };
	}
	return { ok: res.status === 0, output };
}

export function commandExists(cmd: string): boolean {
	const res = spawnSync(cmd, ["--version"], { encoding: "utf-8" });
	return !res.error && res.status === 0;
}
