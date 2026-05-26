import {
	type CallExpression,
	Node,
	type OptionalKind,
	type ParameterDeclarationStructure,
} from "ts-morph";
import type { FunctionLikeWithParameters } from "./find-function-declaration";
import type { ChangeSignatureOperation } from "./types";

/**
 * 既存呼び出しの引数テキスト配列に対して、操作列を適用して新しい引数配列を計算する。
 *
 * - add: argumentForCallers が指定されていれば、index 位置に挿入する。
 *   index が現在の引数数を超えていれば呼び出しに必要な引数が欠けているのでエラー。
 *   argumentForCallers 未指定の場合は呼び出し側に変更を入れない (末尾追加で
 *   optional/defaulted パラメータを想定したケース)。
 * - remove: index が範囲内ならその位置を削除。範囲外なら無変更 (省略された optional 引数のため)。
 * - reorder: 呼び出しの引数数が newOrder の長さと一致しない場合はエラー。
 */
export function computeNewArgumentTexts(
	currentArgTexts: readonly string[],
	operations: readonly ChangeSignatureOperation[],
): string[] {
	let args = [...currentArgTexts];
	for (const op of operations) {
		if (op.kind === "add") {
			if (op.argumentForCallers === undefined) continue;
			const insertAt = op.index ?? args.length;
			if (insertAt > args.length) {
				throw new Error(
					`add 操作: index=${insertAt} に挿入しようとしましたが、呼び出しは ${args.length} 個の引数しか渡していません。末尾 optional を省略している呼び出しがあるため、追加位置を末尾以外にする場合は、先に対象呼び出しに引数を補完してから再実行してください。`,
				);
			}
			args.splice(insertAt, 0, op.argumentForCallers);
			continue;
		}
		if (op.kind === "remove") {
			if (op.index >= 0 && op.index < args.length) {
				args.splice(op.index, 1);
			}
			continue;
		}
		if (op.kind === "reorder") {
			if (args.length !== op.newOrder.length) {
				throw new Error(
					`Reorder requires call sites to pass all ${op.newOrder.length} arguments, but a call passes ${args.length}.`,
				);
			}
			args = op.newOrder.map((index) => args[index]);
		}
	}
	return args;
}

/**
 * 関数の Parameter 構造体配列に対して操作列を適用して、新しい構造体配列を計算する。
 *
 * - add の中間挿入で argumentForCallers が無いケースは、呼び出し側が壊れるためここで弾く。
 * - rest パラメータが末尾以外に配置される配列は TypeScript 上不正なので拒否する。
 */
export function computeNewParameterStructures(
	current: ReadonlyArray<OptionalKind<ParameterDeclarationStructure>>,
	operations: readonly ChangeSignatureOperation[],
): OptionalKind<ParameterDeclarationStructure>[] {
	let params: OptionalKind<ParameterDeclarationStructure>[] = current.map(
		(p) => ({ ...p }),
	);
	for (const op of operations) {
		if (op.kind === "add") {
			const insertAt = op.index ?? params.length;
			if (insertAt < 0 || insertAt > params.length) {
				throw new Error(
					`add 操作の index=${insertAt} がパラメータ範囲 [0, ${params.length}] を超えています`,
				);
			}
			const isTrailing = insertAt === params.length;
			const isSafelyOmittable =
				op.optional === true || op.defaultValue !== undefined;
			if (op.argumentForCallers === undefined) {
				if (!isTrailing) {
					throw new Error(
						`add 操作: 中間 index=${insertAt} に挿入する場合は argumentForCallers が必須です (呼び出し側の既存引数と新パラメータの対応が崩れるため)。`,
					);
				}
				if (!isSafelyOmittable) {
					throw new Error(
						"add 操作: 末尾追加でも argumentForCallers を省略する場合は、新パラメータが " +
							"optional または defaultValue を持つ必要があります (既存呼び出しが引数不足になるため)。",
					);
				}
			}
			params.splice(insertAt, 0, {
				name: op.name,
				type: op.typeText,
				hasQuestionToken: op.optional,
				initializer: op.defaultValue,
			});
			continue;
		}
		if (op.kind === "remove") {
			if (op.index < 0 || op.index >= params.length) {
				throw new Error(
					`remove 操作の index=${op.index} がパラメータ範囲 [0, ${params.length - 1}] を超えています`,
				);
			}
			params.splice(op.index, 1);
			continue;
		}
		if (op.kind === "reorder") {
			if (op.newOrder.length !== params.length) {
				throw new Error(
					`reorder の newOrder 長 (${op.newOrder.length}) が現在のパラメータ数 (${params.length}) と一致しません`,
				);
			}
			const seen = new Set<number>();
			for (const i of op.newOrder) {
				if (i < 0 || i >= params.length || seen.has(i)) {
					throw new Error(
						`reorder の newOrder=[${op.newOrder.join(",")}] が不正です (重複/範囲外)`,
					);
				}
				seen.add(i);
			}
			params = op.newOrder.map((i) => params[i]);
		}
	}
	validateRestParameterIsLast(params);
	return params;
}

/**
 * rest パラメータ (`...rest`) は末尾でなければならない (TS2369)。
 */
export function validateRestParameterIsLast(
	params: ReadonlyArray<OptionalKind<ParameterDeclarationStructure>>,
): void {
	const restIndex = params.findIndex((p) => p.isRestParameter === true);
	if (restIndex !== -1 && restIndex !== params.length - 1) {
		throw new Error(
			`rest パラメータ (index=${restIndex}, name='${params[restIndex].name}') は最後の位置にある必要があります ` +
				`(現在のパラメータ数: ${params.length})。`,
		);
	}
}

/**
 * 呼び出し式の引数を一括で newArgTexts に置換する。
 */
export function rewriteCallArguments(
	call: CallExpression,
	newArgTexts: readonly string[],
): void {
	const existingCount = call.getArguments().length;
	for (let i = existingCount - 1; i >= 0; i--) {
		call.removeArgument(i);
	}
	if (newArgTexts.length > 0) {
		call.addArguments([...newArgTexts]);
	}
}

/**
 * 関数のパラメータを一括で newParams に置換する。
 */
export function rewriteParameters(
	fn: FunctionLikeWithParameters,
	newParams: ReadonlyArray<OptionalKind<ParameterDeclarationStructure>>,
): void {
	const existing = fn.getParameters();
	for (const p of [...existing].reverse()) {
		p.remove();
	}
	if (newParams.length > 0) {
		fn.addParameters([...newParams]);
	}
}

/**
 * 呼び出し式の引数に SpreadElement が含まれているか判定する。
 * (`fn(...args)` のような呼び出しは静的に位置を変更できない)
 */
export function callHasSpreadArgument(call: CallExpression): boolean {
	return call.getArguments().some((a) => Node.isSpreadElement(a));
}
