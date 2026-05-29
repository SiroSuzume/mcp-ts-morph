import { Project } from "ts-morph";
import * as path from "node:path";
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
