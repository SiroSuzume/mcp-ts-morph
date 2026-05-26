import type {
	CallExpression,
	OptionalKind,
	ParameterDeclarationStructure,
	Project,
} from "ts-morph";
import logger from "../../utils/logger";
import {
	getChangedFiles,
	initializeProject,
	saveProjectChanges,
} from "../_utils/ts-morph-project";
import {
	findIdentifierNode,
	validateSymbol,
} from "../rename-symbol/rename-symbol";
import {
	callHasSpreadArgument,
	computeNewArgumentTexts,
	computeNewParameterStructures,
	rewriteCallArguments,
	rewriteParameters,
} from "./apply-changes";
import { filterCallSites } from "./find-call-sites";
import {
	findFunctionLikeDeclaration,
	type FunctionLikeWithParameters,
	getAllRelatedFunctionDeclarations,
} from "./find-function-declaration";
import type {
	ChangeSignatureOperation,
	ChangeSignatureParams,
	ChangeSignatureResult,
} from "./types";

interface CallSitePlan {
	call: CallExpression;
	newArgTexts: string[];
}

/**
 * 関数のシグネチャ (パラメータの追加/削除/並び替え) を変更し、
 * プロジェクト全体の呼び出し箇所も同期して更新する。
 *
 * tsconfigPath からプロジェクトを初期化して `changeSignatureOnProject` に委譲する。
 * テストなど既存の Project に対して実行したい場合は `changeSignatureOnProject` を直接使う。
 */
export async function changeSignature(
	params: ChangeSignatureParams,
): Promise<ChangeSignatureResult> {
	const project = initializeProject(params.tsconfigPath);
	return changeSignatureOnProject(project, params);
}

/**
 * 既存の Project に対して signature 変更を適用する内部 API。
 */
export async function changeSignatureOnProject(
	project: Project,
	{
		targetFilePath,
		position,
		functionName,
		changes,
		dryRun = false,
	}: Omit<ChangeSignatureParams, "tsconfigPath">,
): Promise<ChangeSignatureResult> {
	logger.debug(
		{
			targetFilePath,
			position,
			functionName,
			changeCount: changes.length,
			dryRun,
		},
		"changeSignature 開始",
	);

	if (changes.length === 0) {
		throw new Error("changes 配列が空です");
	}

	const identifier = findIdentifierNode(project, targetFilePath, position);
	validateSymbol(identifier, functionName);

	const primary = findFunctionLikeDeclaration(identifier);
	const allDeclarations = getAllRelatedFunctionDeclarations(primary);
	logger.debug(
		{ declarationCount: allDeclarations.length },
		"対象関数宣言を解決",
	);

	// 呼び出し位置を抽出
	const references = identifier.findReferencesAsNodes();
	const callSites = filterCallSites(references);
	logger.debug({ callSiteCount: callSites.length }, "呼び出し位置を抽出");

	// SpreadElement を含む呼び出しは静的に置換できないため検出する。
	// (引数を変更する operation がある場合のみ問題になる)
	const operationsTouchCallers = changes.some((op) => {
		if (op.kind === "add") return op.argumentForCallers !== undefined;
		return true; // remove / reorder は必ず引数に影響
	});
	if (operationsTouchCallers) {
		const spreadCalls = callSites.filter(callHasSpreadArgument);
		if (spreadCalls.length > 0) {
			const samples = spreadCalls
				.slice(0, 3)
				.map((c) => {
					const sf = c.getSourceFile();
					const { line, column } = sf.getLineAndColumnAtPos(c.getStart());
					return `  - ${sf.getFilePath()}:${line}:${column}`;
				})
				.join("\n");
			throw new Error(
				`スプレッド引数 (...args) を含む呼び出しがあり、安全に書き換えできません:\n${samples}`,
			);
		}
	}

	// --- Phase 1: 計画フェーズ (mutation せずに新しい引数列とパラメータ列を計算) ---
	// ここで例外が出ても in-memory project には一切手を付けていないので安全。
	// オーバーロードシグネチャごとに型注釈が異なるので、宣言ごとに個別に計算する。
	const declarationPlans = allDeclarations.map((decl) => ({
		decl,
		newParameterStructures: buildNewParameterStructures(decl, changes),
	}));
	const callSitePlans = planCallSiteRewrites(callSites, changes);

	logger.debug(
		{
			declarationCount: declarationPlans.length,
			callSitePlanCount: callSitePlans.length,
		},
		"計画フェーズ完了",
	);

	// --- Phase 2: 適用フェーズ (例外が起きないことを期待) ---
	for (const plan of callSitePlans) {
		rewriteCallArguments(plan.call, plan.newArgTexts);
	}
	for (const { decl, newParameterStructures } of declarationPlans) {
		rewriteParameters(decl, newParameterStructures);
	}

	const changedFiles = getChangedFiles(project).map((sf) => sf.getFilePath());
	logger.debug({ changedFileCount: changedFiles.length }, "適用フェーズ完了");

	if (!dryRun) {
		await saveProjectChanges(project);
		logger.info(
			{ functionName, changedFileCount: changedFiles.length },
			"changeSignature 保存完了",
		);
	}
	return { changedFiles };
}

function buildNewParameterStructures(
	fn: FunctionLikeWithParameters,
	operations: readonly ChangeSignatureOperation[],
): OptionalKind<ParameterDeclarationStructure>[] {
	const currentStructures: OptionalKind<ParameterDeclarationStructure>[] = fn
		.getParameters()
		.map((p) => {
			const structure = p.getStructure();
			return {
				name: typeof structure.name === "string" ? structure.name : p.getName(),
				type: typeof structure.type === "string" ? structure.type : undefined,
				hasQuestionToken: structure.hasQuestionToken,
				initializer:
					typeof structure.initializer === "string"
						? structure.initializer
						: undefined,
				isRestParameter: structure.isRestParameter,
				isReadonly: structure.isReadonly,
				scope: structure.scope,
				decorators: structure.decorators,
			};
		});
	return computeNewParameterStructures(currentStructures, operations);
}

function planCallSiteRewrites(
	callSites: readonly CallExpression[],
	operations: readonly ChangeSignatureOperation[],
): CallSitePlan[] {
	const plans: CallSitePlan[] = [];
	for (const call of callSites) {
		const argTexts = call.getArguments().map((a) => a.getText());
		try {
			const newArgTexts = computeNewArgumentTexts(argTexts, operations);
			plans.push({ call, newArgTexts });
		} catch (error) {
			const sf = call.getSourceFile();
			const { line, column } = sf.getLineAndColumnAtPos(call.getStart());
			const baseMessage =
				error instanceof Error ? error.message : String(error);
			throw new Error(
				`呼び出し位置 ${sf.getFilePath()}:${line}:${column} で操作を適用できませんでした: ${baseMessage}`,
			);
		}
	}
	return plans;
}
