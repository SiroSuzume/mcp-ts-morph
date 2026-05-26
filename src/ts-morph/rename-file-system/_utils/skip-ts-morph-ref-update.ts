import type { Project, SourceFile } from "ts-morph";
import logger from "../../../utils/logger";

/**
 * ts-morph (v25.x 系) の `SourceFile.move()` / `Directory.move()` は内部で
 * `_updateReferencesForMoveInternal` を呼び、移動ファイル単位で「参照しているリテラル」
 * を全プロジェクトから探して module specifier を書き換える。
 *
 * このリポジトリでは `updateModuleSpecifiers` が同じ仕事を既に行っているため二重実行。
 * しかも ts-morph 側の参照解決は per-file × O(project) で cascade slowdown を起こし、
 * 大規模 monorepo (3000+ files) でディレクトリ rename すると 6 分を超えるレベル
 * (実測値: 369s for 34 files in src/types/)。
 *
 * 本 util は SourceFile prototype の参照解決ペアを一時的に no-op 化して、その間に
 * move を実行する。fn 終了後 try/finally で必ず restore する。
 *
 * 注意:
 *  - private API (`_underscore` メンバ) への monkey-patch のため、ts-morph 25.x に依存。
 *    将来バージョンで private 名が変わった場合は patch が当たらず、自動的に従来動作
 *    (auto-ref-update 込み) に fallback する (= 遅いが正しく動く)。
 *  - patch は **prototype レベルで一時上書き** するため、同プロセス内の他コードが
 *    並行で move() を呼んだ場合も影響を受ける。直列実行が前提。
 */
export function withSkippedTsMorphReferenceUpdates<T>(
	project: Project,
	fn: () => T,
): T {
	const proto = pickSourceFilePrototype(project);
	if (!proto) {
		logger.warn(
			"Could not locate SourceFile.prototype for skip-ref-update patch; falling back to default (slow) ts-morph behavior",
		);
		return fn();
	}

	const protoAny = proto as unknown as Record<string, unknown>;
	const originalGetRefs = protoAny._getReferencesForMoveInternal;
	const originalUpdateRefs = protoAny._updateReferencesForMoveInternal;

	if (
		typeof originalGetRefs !== "function" ||
		typeof originalUpdateRefs !== "function"
	) {
		logger.warn(
			{
				hasGetRefs: typeof originalGetRefs,
				hasUpdateRefs: typeof originalUpdateRefs,
			},
			"ts-morph internal reference-update API not found on SourceFile.prototype; skip patch (falling back to slow path)",
		);
		return fn();
	}

	protoAny._getReferencesForMoveInternal = () => ({
		literalReferences: [],
		referencingLiterals: [],
	});
	protoAny._updateReferencesForMoveInternal = () => {
		/* no-op: updateModuleSpecifiers が同等の処理を担当 */
	};

	try {
		return fn();
	} finally {
		protoAny._getReferencesForMoveInternal = originalGetRefs;
		protoAny._updateReferencesForMoveInternal = originalUpdateRefs;
	}
}

/**
 * Project から既存の SourceFile を 1 つ取り、その prototype を返す。
 * Project に SourceFile が 1 つもない場合は undefined。
 */
function pickSourceFilePrototype(project: Project): object | undefined {
	const sourceFiles = project.getSourceFiles();
	if (sourceFiles.length === 0) return undefined;
	const sf: SourceFile = sourceFiles[0];
	return Object.getPrototypeOf(sf);
}
