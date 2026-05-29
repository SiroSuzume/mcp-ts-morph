import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { type TargetRepo, targetCheckoutDir } from "./targets";

export interface HealthResult {
	/** tsc が報告した型エラー件数 */
	typeErrorCount: number;
	/** 失敗したユニットテストの識別子（"file > suite > test"）の集合 */
	failedTests: string[];
	/** 失敗時の診断用（型チェック・テストの出力末尾） */
	detail: string;
}

function binPath(dir: string, bin: string): string {
	return path.join(dir, "node_modules", ".bin", bin);
}

/**
 * 子プロセス用のクリーンな環境変数。
 * 外側 Vitest が注入する VITEST_* / NODE_OPTIONS（loader 等）を取り除く。
 */
function childEnv(): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {
		...process.env,
		CI: "true",
		FORCE_COLOR: "0",
	};
	for (const key of Object.keys(env)) {
		if (key.startsWith("VITEST")) {
			delete env[key];
		}
	}
	env.NODE_OPTIONS = undefined;
	return env;
}

function run(
	cmd: string,
	args: readonly string[],
	cwd: string,
): { ok: boolean; output: string } {
	const res = spawnSync(cmd, args as string[], {
		cwd,
		encoding: "utf-8",
		maxBuffer: 64 * 1024 * 1024,
		env: childEnv(),
	});
	const output = `${res.stdout ?? ""}${res.stderr ?? ""}`;
	if (res.error) {
		return { ok: false, output: `${res.error.message}\n${output}` };
	}
	return { ok: res.status === 0, output };
}

function tail(text: string, lines = 40): string {
	return text.split("\n").slice(-lines).join("\n");
}

function countTypeErrors(output: string, ok: boolean): number {
	if (ok) return 0;
	const matches = output.match(/error TS\d+/g);
	return matches ? matches.length : 0;
}

interface VitestJsonAssertion {
	ancestorTitles?: string[];
	title?: string;
	fullName?: string;
	status?: string;
}
interface VitestJsonFile {
	name?: string;
	assertionResults?: VitestJsonAssertion[];
}
interface VitestJson {
	testResults?: VitestJsonFile[];
}

function parseFailedTests(jsonFile: string, repoDir: string): string[] {
	if (!fs.existsSync(jsonFile)) return [];
	let parsed: VitestJson;
	try {
		parsed = JSON.parse(fs.readFileSync(jsonFile, "utf-8")) as VitestJson;
	} catch {
		return [];
	}
	const failed: string[] = [];
	for (const file of parsed.testResults ?? []) {
		const rel = file.name ? path.relative(repoDir, file.name) : "";
		for (const a of file.assertionResults ?? []) {
			if (a.status === "failed") {
				const name =
					a.fullName ?? [...(a.ancestorTitles ?? []), a.title].join(" > ");
				failed.push(`${rel} > ${name}`);
			}
		}
	}
	return failed.sort();
}

/**
 * 対象リポジトリの健全性（型エラー件数 + 失敗テスト集合）を取得する。
 * 絶対的な緑は要求せず、リファクタ前後でこの結果を比較（差分緑）する。
 */
export function checkHealth(target: TargetRepo): HealthResult {
	const dir = targetCheckoutDir(target);

	const type = run(
		binPath(dir, target.typecheckBin),
		target.typecheckArgs,
		dir,
	);

	const jsonFile = path.join(
		os.tmpdir(),
		`e2e-${target.name}-${process.pid}-${Date.now()}.json`,
	);
	const tests = run(
		binPath(dir, target.unitTestBin),
		[
			...target.unitTestArgs,
			"--reporter=json",
			"--outputFile",
			jsonFile,
			"--coverage.enabled=false",
		],
		dir,
	);
	const failedTests = parseFailedTests(jsonFile, dir);
	fs.rmSync(jsonFile, { force: true });

	return {
		typeErrorCount: countTypeErrors(type.output, type.ok),
		failedTests,
		detail: [
			`--- typecheck (${target.typecheckBin} ${target.typecheckArgs.join(" ")}) ok=${type.ok} ---`,
			tail(type.output),
			`--- unit tests (${target.unitTestBin} ${target.unitTestArgs.join(" ")}) exitOk=${tests.ok} failed=${failedTests.length} ---`,
			tail(tests.output),
		].join("\n"),
	};
}

export interface RegressionResult {
	ok: boolean;
	detail: string;
}

/**
 * リファクタ後 (after) が baseline に対して退行していないかを判定する（差分緑）。
 * - 新規の型エラーが無い（after の型エラー件数 <= baseline）
 * - 新規に失敗したテストが無い（after の失敗テスト ⊆ baseline の失敗テスト）
 *
 * baseline 時点で既に失敗している環境依存テストは退行扱いしない。
 */
export function assertNoRegression(
	baseline: HealthResult,
	after: HealthResult,
): RegressionResult {
	const newTypeErrors = after.typeErrorCount > baseline.typeErrorCount;
	const baselineFailed = new Set(baseline.failedTests);
	const newlyFailed = after.failedTests.filter((t) => !baselineFailed.has(t));

	const ok = !newTypeErrors && newlyFailed.length === 0;
	if (ok) {
		return { ok, detail: "退行なし" };
	}
	return {
		ok,
		detail: [
			newTypeErrors
				? `新規の型エラー: baseline=${baseline.typeErrorCount} -> after=${after.typeErrorCount}`
				: "",
			newlyFailed.length > 0
				? `新規に失敗したテスト:\n  ${newlyFailed.join("\n  ")}`
				: "",
			"--- after detail ---",
			after.detail,
		]
			.filter(Boolean)
			.join("\n"),
	};
}

/**
 * 作業ツリーが clean かどうか（rename 往復の同一性検証に使う）。
 */
export function isWorkingTreeClean(target: TargetRepo): boolean {
	const dir = targetCheckoutDir(target);
	const res = run("git", ["status", "--porcelain"], dir);
	return res.ok && res.output.trim() === "";
}

/**
 * リファクタで変更したファイルを git の管理状態に戻す。
 */
export function resetTarget(target: TargetRepo): void {
	const dir = targetCheckoutDir(target);
	const checkout = run("git", ["checkout", "-q", "--", "."], dir);
	if (!checkout.ok) {
		throw new Error(
			`[e2e] ${target.name}: git checkout に失敗\n${checkout.output}`,
		);
	}
	const clean = run("git", ["clean", "-fdq"], dir);
	if (!clean.ok) {
		throw new Error(`[e2e] ${target.name}: git clean に失敗\n${clean.output}`);
	}
}
