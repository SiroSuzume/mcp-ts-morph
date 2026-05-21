import { type Statement, Node, type Identifier } from "ts-morph";
import type { DependencyClassification } from "../types";
import logger from "../../utils/logger";
import { getDeclarationIdentifier } from "./get-declaration-identifier";

/**
 * 指定された Identifier ノードへの参照を検索し、
 * targetDeclaration の外部 (ただし同じソースファイル内) で参照されているかを確認します。
 *
 * @param targetDeclaration 参照のコンテキストとなる移動対象の宣言。
 * @param dependencyIdentifier 参照を検索する依存関係の Identifier。
 * @returns 外部で参照されていれば true、そうでなければ false。
 */
function checkIfReferencedOutsideTarget(
	targetDeclaration: Statement,
	dependencyIdentifier: Identifier,
): boolean {
	const sourceFile = targetDeclaration.getSourceFile();
	const references =
		dependencyIdentifier.findReferencesAsNodes() as Identifier[];
	for (const refNode of references) {
		if (refNode.getSourceFile() !== sourceFile) continue;

		const isInsideTarget = refNode.getAncestors().includes(targetDeclaration);
		if (!isInsideTarget) {
			return true;
		}
	}
	return false;
}

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

		if (!nameNode || !depName) {
			logger.warn(
				`Could not find identifier node or name for dependency: ${dep.getKindName()} starting with '${dep.getText().substring(0, 20)}...'. This dependency will be ignored and left in the original file.`,
			);
			continue;
		}

		const isExported = Node.isExportable(dep) && dep.isExported();

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

		const isReferencedOutside = checkIfReferencedOutsideTarget(
			targetDeclaration,
			nameNode,
		);

		if (isReferencedOutside) {
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
				// export できない型が外部から参照されている場合 (通常は発生しにくい)
				logger.warn(
					`Non-exportable dependency ${depName} (${dep.getKindName()}) seems referenced from outside the target symbol. Classifying as moveToNewFile.`,
				);
				// 警告を出し、フォールバックとして移動対象とする
				classifications.push({ type: "moveToNewFile", statement: dep });
			}
		} else {
			classifications.push({ type: "moveToNewFile", statement: dep });
			logger.debug(`Classified ${depName} as moveToNewFile (private)`);
		}
	}

	return classifications;
}
