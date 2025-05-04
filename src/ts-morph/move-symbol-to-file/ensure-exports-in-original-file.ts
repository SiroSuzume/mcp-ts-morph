import { Node } from "ts-morph";
import type { DependencyClassification } from "../types";
import logger from "../../utils/logger";

/**
 * classifiedDependencies 内の `addExport` タイプの依存関係に対し、
 * 元ファイルで export されていない場合に export キーワードを追加する。
 */
export function ensureExportsInOriginalFile(
	classifiedDependencies: DependencyClassification[],
	originalFilePath: string, // logger用
): void {
	logger.debug("必要なエクスポートを元のファイルで確認中...");
	for (const dep of classifiedDependencies) {
		if (dep.type !== "addExport") {
			continue;
		}
		if (Node.isExportable(dep.statement)) {
			if (!dep.statement.isExported()) {
				dep.statement.setIsExported(true);
				logger.debug(
					`Added export keyword to ${dep.name} in ${originalFilePath}`,
				);
			} else {
				logger.debug(
					`Export keyword for ${dep.name} already exists in ${originalFilePath}. No change needed.`,
				);
			}
		} else {
			logger.warn(
				`Attempted to add export to a non-exportable node (${dep.statement.getKindName()}) named ${dep.name} in ${originalFilePath}. Skipping.`,
			);
		}
	}
}
