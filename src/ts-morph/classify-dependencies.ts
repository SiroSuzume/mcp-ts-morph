import { type Statement, Node, type Identifier } from "ts-morph";
import type { DependencyClassification } from "./types";
import logger from "../utils/logger";
import { getDeclarationIdentifier } from "./utils/get-declaration-identifier";

/**
 * 移動対象シンボル (targetDeclaration) が依存する内部シンボル (internalDependencies) を分類する。
 *
 * @param targetDeclaration 移動対象シンボルの宣言ステートメント
 * @param internalDependencies targetDeclaration が依存する内部シンボルのステートメント配列
 * @returns 分類結果の配列
 */
export function classifyDependencies(
	targetDeclaration: Statement,
	internalDependencies: Statement[],
): DependencyClassification[] {
	const sourceFile = targetDeclaration.getSourceFile();
	const classifications: DependencyClassification[] = [];

	for (const dep of internalDependencies) {
		const nameNode = getDeclarationIdentifier(dep);
		const depName = nameNode?.getText();

		// nameNode または depName が取得できない場合 (参照追跡不可)
		if (!nameNode || !depName) {
			logger.warn(
				`Could not find identifier node or name for dependency: ${dep.getKindName()} starting with '${dep.getText().substring(0, 20)}...'. This dependency will be ignored and left in the original file.`,
			);
			continue;
		}

		const isExported = Node.isExportable(dep) && dep.isExported();

		// 1. 依存関係が元々 export されているか？
		if (isExported) {
			classifications.push({
				type: "importFromOriginal",
				statement: dep,
				name: depName,
			});
			logger.debug(
				`Classified ${depName} as importFromOriginal (already exported)`,
			);
			continue;
		}

		// 2. export されておらず、移動対象以外からも参照されているか？
		let isReferencedOutsideTarget = false;
		try {
			const references = nameNode.findReferencesAsNodes() as Identifier[];
			for (const refNode of references) {
				if (refNode.getSourceFile() !== sourceFile) continue; // 別ファイルの参照は無視

				const isInsideTarget = refNode
					.getAncestors()
					.includes(targetDeclaration);
				if (!isInsideTarget) {
					isReferencedOutsideTarget = true;
					break;
				}
			}
		} catch (e) {
			logger.warn(`Error finding references for ${depName}:`, e);
			// 参照が見つからない場合は安全側に倒し、移動しない (importFromOriginal 扱い)
			// → いや、他から参照されている可能性を考慮し、addExport が適切かもしれないが、
			//   より安全なのは moveToNewFile か？ → いや、エラー時は何もしないのが一番安全。
			//   今回は、一旦 addExport に寄せておく（もし外部参照があれば export が必要になるため）
			//   ★ただし、exportできないノードかもしれないので注意が必要。
			//   Node.isExportable(dep) を確認する。
			if (Node.isExportable(dep)) {
				classifications.push({
					type: "addExport",
					statement: dep,
					name: depName,
				});
				logger.debug(
					`Classified ${depName} as addExport (reference check failed, fallback)`,
				);
			} else {
				logger.warn(
					`Dependency ${depName} cannot be exported but reference check failed. Leaving it in the original file without export.`,
				);
				// エクスポート不可で参照チェックエラーの場合は何もしない
			}
			continue; // 次の依存関係へ
		}

		if (isReferencedOutsideTarget) {
			// 他からも参照される → export を追加して元のファイルに残す
			if (Node.isExportable(dep)) {
				classifications.push({
					type: "addExport",
					statement: dep,
					name: depName,
				});
				logger.debug(
					`Classified ${depName} as addExport (shared, needs export)`,
				);
			} else {
				// exportできない型 (e.g., TypeAlias) が外部から参照されている場合。
				// このケースは理論上発生しづらいが、警告を出して移動対象にする。
				// 本来は参照エラーになるはず。
				logger.warn(
					`Non-exportable dependency ${depName} (${dep.getKindName()}) is referenced from outside the target symbol. This might indicate an issue. Classifying as moveToNewFile.`,
				);
				classifications.push({ type: "moveToNewFile", statement: dep });
			}
		} else {
			// 移動対象からのみ参照される → 新しいファイルへ移動
			classifications.push({ type: "moveToNewFile", statement: dep });
			logger.debug(`Classified ${depName} as moveToNewFile (private)`);
		}
	}

	return classifications;
}
