import { expect } from "vitest";
import { Project } from "ts-morph";
import * as path from "node:path";
import { prepareTarget } from "./prepare-target";
import {
	assertNoRegression,
	checkHealth,
	type HealthResult,
	resetTarget,
} from "./verify-target";
import { createToolHarness, type ToolResult } from "./call-tool";
import { targetCheckoutDir, type TargetRepo } from "./targets";

export { prepareTarget } from "./prepare-target";
export {
	checkHealth,
	assertNoRegression,
	resetTarget,
	isWorkingTreeClean,
	type HealthResult,
	type RegressionResult,
} from "./verify-target";
export { createToolHarness, type ToolResult } from "./call-tool";

/** ToolResult のテキストコンテンツを連結する。 */
export function textOf(result: ToolResult): string {
	return result.content.map((c) => c.text).join("\n");
}

export interface TargetScenario {
	harness: ReturnType<typeof createToolHarness>;
	/** 対象リポジトリを準備し baseline を取得する（beforeAll で呼ぶ）。 */
	setup: () => void;
	/** リファクタで変更した作業ツリーを元に戻す（afterEach で呼ぶ）。 */
	reset: () => void;
	/** 準備に失敗していれば当該ケースを skip する。 */
	requirePrepared: (ctx: { skip: (note?: string) => void }) => void;
	/** リファクタ後に baseline からの退行が無いことを検証する。 */
	expectNoRegression: () => void;
}

/**
 * 対象リポジトリごとの E2E シナリオ状態（harness / baseline）と、
 * 共通のライフサイクル・アサーションをまとめて生成する。
 * テストファイル側で beforeAll(setup) / afterEach(reset) を登録して使う。
 */
export function createScenario(target: TargetRepo): TargetScenario {
	const harness = createToolHarness();
	let baseline: HealthResult | undefined;

	return {
		harness,
		setup() {
			try {
				prepareTarget(target);
				baseline = checkHealth(target);
			} catch {
				// clone / install に失敗（ネットワーク不通や bun 不在など）した場合は
				// baseline 未取得のまま各ケースを skip する
				baseline = undefined;
			}
		},
		reset() {
			if (baseline) resetTarget(target);
		},
		requirePrepared(ctx) {
			if (!baseline) {
				ctx.skip(
					`${target.name} の準備（clone/install/baseline）に失敗したため skip`,
				);
			}
		},
		expectNoRegression() {
			const reg = assertNoRegression(
				baseline as HealthResult,
				checkHealth(target),
			);
			expect(reg.ok, reg.detail).toBe(true);
		},
	};
}

export interface Position {
	line: number;
	column: number;
}

/**
 * 対象リポジトリ内の export 宣言の「名前識別子」の位置（1-based line/column）を
 * ts-morph で算出する。バージョン固定なので結果は安定するが、行番号ハードコードより
 * 読みやすく壊れにくい。
 */
export function locateSymbolPosition(
	target: TargetRepo,
	relFilePath: string,
	symbolName: string,
): { absFilePath: string; position: Position } {
	const dir = targetCheckoutDir(target);
	const tsconfigPath = path.join(dir, target.tsconfigRelPath);
	const absFilePath = path.join(dir, relFilePath);

	const project = new Project({ tsConfigFilePath: tsconfigPath });
	const sf = project.getSourceFile(absFilePath);
	if (!sf) {
		throw new Error(
			`[e2e] ${target.name}: ${relFilePath} が tsconfig(${target.tsconfigRelPath}) のプロジェクトに含まれていません`,
		);
	}

	const decl =
		sf.getVariableDeclaration(symbolName) ??
		sf.getFunction(symbolName) ??
		sf.getClass(symbolName) ??
		sf.getInterface(symbolName) ??
		sf.getTypeAlias(symbolName);
	if (!decl) {
		throw new Error(
			`[e2e] ${target.name}: ${relFilePath} に export '${symbolName}' が見つかりません`,
		);
	}

	const nameNode = decl.getNameNode();
	const { line, column } = sf.getLineAndColumnAtPos(nameNode.getStart());
	return { absFilePath, position: { line, column } };
}

export function absPath(target: TargetRepo, relPath: string): string {
	return path.join(targetCheckoutDir(target), relPath);
}

export function tsconfigPathOf(target: TargetRepo): string {
	return path.join(targetCheckoutDir(target), target.tsconfigRelPath);
}
