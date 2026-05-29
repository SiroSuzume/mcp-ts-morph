import * as fs from "node:fs";
import { commandExists, run } from "./_child-process";
import { E2E_CACHE_DIR, type TargetRepo, targetCheckoutDir } from "./targets";

function readyMarkerPath(target: TargetRepo): string {
	return `${targetCheckoutDir(target)}.ready`;
}

/**
 * 対象リポジトリを固定 commit で clone し、依存をインストールする。
 * 既に準備済み（.ready マーカあり）なら何もせず checkout ディレクトリを返す。
 *
 * - 特定 commit のみを取得する shallow fetch（GitHub は SHA 指定の fetch を許可）
 * - 依存は frozen-lockfile + ignore-scripts で固定・postinstall 不実行
 * - .ready マーカは checkout 外に置き、scenario 間の git clean で消えないようにする
 */
export function prepareTarget(target: TargetRepo): string {
	const dir = targetCheckoutDir(target);
	const marker = readyMarkerPath(target);

	if (fs.existsSync(marker) && fs.existsSync(dir)) {
		return dir;
	}

	const pkgManager = target.installArgv[0];
	if (!commandExists(pkgManager)) {
		throw new Error(
			`[e2e] パッケージマネージャ '${pkgManager}' が見つかりません（${target.name} の準備に必要）。`,
		);
	}

	fs.mkdirSync(E2E_CACHE_DIR, { recursive: true });
	fs.rmSync(dir, { recursive: true, force: true });
	fs.rmSync(marker, { force: true });
	fs.mkdirSync(dir, { recursive: true });

	const steps: Array<{ cmd: string; args: string[] }> = [
		{ cmd: "git", args: ["init", "-q"] },
		{ cmd: "git", args: ["remote", "add", "origin", target.repoUrl] },
		{ cmd: "git", args: ["fetch", "--depth", "1", "origin", target.commit] },
		{ cmd: "git", args: ["checkout", "-q", "--detach", "FETCH_HEAD"] },
	];
	for (const step of steps) {
		const { ok, output } = run(step.cmd, step.args, dir);
		if (!ok) {
			throw new Error(
				`[e2e] ${target.name}: '${step.cmd} ${step.args.join(" ")}' に失敗しました。\n${output}`,
			);
		}
	}

	const { ok, output } = run(pkgManager, target.installArgv.slice(1), dir);
	if (!ok) {
		throw new Error(
			`[e2e] ${target.name}: 依存インストール '${target.installArgv.join(" ")}' に失敗しました。\n${output}`,
		);
	}

	fs.writeFileSync(marker, `${target.commit}\n${new Date().toISOString()}\n`);
	return dir;
}
