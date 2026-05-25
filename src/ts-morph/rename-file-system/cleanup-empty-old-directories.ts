import type { Project } from "ts-morph";
import logger from "../../utils/logger";
import type { PathMapping } from "../types";

/**
 * directory rename 後、ファイルが全て移動した結果として残った旧ディレクトリ階層を
 * bottom-up に掃除する (issue #27)。
 *
 * sourceFile.move() は親ディレクトリのクリーンアップを行わないため、real FS では
 * 空ディレクトリが残り、project の Directory 追跡上にも残骸が残る。
 *
 * 安全側に倒すルール:
 *  - FS 上にエントリが残っているディレクトリは触らない (untracked file 保護)
 *  - 削除は1段ずつ。`Directory.delete()` の再帰削除は untracked を巻き込むので使わない
 *  - 失敗しても rename 全体は失敗させず warn ログだけ出す (副作用扱い)
 */
export function cleanupEmptyOldDirectories(
	project: Project,
	directoryRenames: PathMapping[],
	signal?: AbortSignal,
): void {
	if (directoryRenames.length === 0) return;
	const fs = project.getFileSystem();

	for (const { oldPath } of directoryRenames) {
		signal?.throwIfAborted();
		const oldDir = project.getDirectory(oldPath);
		if (!oldDir) continue;

		// 深い順 (子から親へ) に並べないと、親ディレクトリのチェック時点で
		// 子が削除されていない → entries 残存 → 親も残ってしまう
		const candidates = [oldDir, ...oldDir.getDescendantDirectories()].sort(
			(a, b) => b.getPath().length - a.getPath().length,
		);

		for (const dir of candidates) {
			signal?.throwIfAborted();
			const dirPath = dir.getPath();
			try {
				if (!fs.directoryExistsSync(dirPath)) {
					dir.forget();
					continue;
				}
				const entries = fs.readDirSync(dirPath);
				if (entries.length > 0) {
					// untracked ファイル / 想定外のサブディレクトリが残っている。
					// ここで止めることで親方向の連鎖削除も自動で抑制される
					logger.trace(
						{ dirPath, remaining: entries.length },
						"Skipping cleanup: directory not empty (untracked content)",
					);
					continue;
				}
				fs.deleteSync(dirPath);
				dir.forget();
			} catch (err) {
				logger.warn({ err, dirPath }, "Failed to cleanup empty old directory");
			}
		}
	}
}
