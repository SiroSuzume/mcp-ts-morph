import type { UnusedExport } from "./find-unused-exports";

export interface KindCount {
	kind: string;
	count: number;
}

export interface DirectoryCount {
	directory: string;
	count: number;
}

export interface UnusedExportsSummary {
	/** 候補総数 */
	total: number;
	/** `sameFileReferenceCount === 0` = 真のデッド (宣言ごと削除可) の件数 */
	deletable: number;
	/** `sameFileReferenceCount >= 1` = 過剰 export (export キーワードのみ不要) の件数 */
	unexportOnly: number;
	/** `[default]` 候補 (偽陽性になりやすい) の件数 */
	defaultExports: number;
	/** 宣言種別ごとの件数 (件数降順 → kind 名昇順) */
	byKind: KindCount[];
	/** ディレクトリ (ファイル名を除いたパス) ごとの件数 (件数降順 → パス昇順) */
	byDirectory: DirectoryCount[];
}

function dirnameOf(filePath: string): string {
	const idx = filePath.lastIndexOf("/");
	return idx <= 0 ? "/" : filePath.slice(0, idx);
}

/**
 * 件数降順、同数ならキー昇順で安定ソートした `[key, count]` 配列を返す。
 */
function rank(counts: Map<string, number>): { key: string; count: number }[] {
	return [...counts.entries()]
		.map(([key, count]) => ({ key, count }))
		.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/**
 * `findUnusedExports` の候補配列を集計し、大規模リポジトリでも俯瞰できるサマリを返す純関数。
 *
 * 1 候補 1 行で全件列挙すると MCP のトークン上限を超えやすいため、
 * 「削除可 (deletable) / unexport のみ (unexportOnly)」「kind 別」「ディレクトリ別」の
 * 集計だけを返してエージェントが対象範囲を素早く判断できるようにする。
 */
export function summarizeUnusedExports(
	entries: UnusedExport[],
): UnusedExportsSummary {
	const byKind = new Map<string, number>();
	const byDirectory = new Map<string, number>();
	let deletable = 0;
	let unexportOnly = 0;
	let defaultExports = 0;

	for (const e of entries) {
		if (e.sameFileReferenceCount === 0) deletable++;
		else unexportOnly++;
		if (e.isDefaultExport) defaultExports++;
		byKind.set(e.kind, (byKind.get(e.kind) ?? 0) + 1);
		const dir = dirnameOf(e.filePath);
		byDirectory.set(dir, (byDirectory.get(dir) ?? 0) + 1);
	}

	return {
		total: entries.length,
		deletable,
		unexportOnly,
		defaultExports,
		byKind: rank(byKind).map(({ key, count }) => ({ kind: key, count })),
		byDirectory: rank(byDirectory).map(({ key, count }) => ({
			directory: key,
			count,
		})),
	};
}
