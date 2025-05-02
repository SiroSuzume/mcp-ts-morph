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
			// ★ 分類せず、次の依存関係へ (moveToNewFile へのフォールバックを削除)
			// classifications.push({ type: "moveToNewFile", statement: dep });
			// logger.debug(`Classified ${depName ?? "dependency"} as moveToNewFile (unable to find identifier or name)`);
			continue;
		}

		// 1. 依存関係が元々 export されているか？
		if (Node.isExportable(dep) && dep.isExported()) {
			// depName は上で取得済み
			classifications.push({
				type: "importFromOriginal",
				statement: dep,
				name: depName,
			});
			logger.debug(`Classified ${depName} as importFromOriginal (exported)`);
			continue;
		}

		// 2. export されておらず、移動対象以外からも参照されているか？
		// nameNode は上で取得済み
		let references: Identifier[] = [];
		// nameNode は !null であることが保証されている
		references = nameNode.findReferencesAsNodes() as Identifier[];

		let isReferencedOutsideTarget = false;
		for (const refNode of references) {
			if (refNode.getSourceFile() !== sourceFile) continue;

			const isInsideTarget = refNode.getAncestors().includes(targetDeclaration);
			if (!isInsideTarget) {
				isReferencedOutsideTarget = true;
				break;
			}
		}

		if (isReferencedOutsideTarget) {
			// 他からも参照される
			// depName は上で取得済み
			classifications.push({
				type: "importFromOriginal",
				statement: dep,
				name: depName,
			});
			logger.debug(`Classified ${depName} as importFromOriginal (shared)`);
		} else {
			// 移動対象からのみ参照される
			classifications.push({ type: "moveToNewFile", statement: dep });
			logger.debug(`Classified ${depName} as moveToNewFile (private)`);
		}
	}

	return classifications;
}
