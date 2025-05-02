import type { Project } from "ts-morph";
import * as path from "node:path";
import { calculateRelativePath } from "./calculate-relative-path";
import logger from "../utils/logger";
import { findDeclarationsReferencingFile } from "./find-declarations-to-update";

/**
 * 指定されたファイルパス (oldFilePath) を参照しているインポート/エクスポート文のパスを、
 * 新しいファイルパス (newFilePath) への参照に更新します。
 *
 * @param project ts-morph プロジェクトインスタンス。
 * @param oldFilePath 移動元のファイルの絶対パス。
 * @param newFilePath 移動先のファイルの絶対パス。
 */
export async function updateImportsInReferencingFiles(
	project: Project,
	oldFilePath: string,
	newFilePath: string,
): Promise<void> {
	const oldSourceFile = project.getSourceFile(oldFilePath);
	if (!oldSourceFile) {
		logger.error(`Source file not found at old path: ${oldFilePath}`);
		throw new Error(`Source file not found at old path: ${oldFilePath}`);
	}

	const declarationsToUpdate =
		await findDeclarationsReferencingFile(oldSourceFile);
	logger.debug(
		{ count: declarationsToUpdate.length, oldFile: oldFilePath },
		"Found declarations referencing the old file path.",
	);

	for (const {
		declaration,
		referencingFilePath,
		originalSpecifierText,
	} of declarationsToUpdate) {
		const moduleSpecifier = declaration.getModuleSpecifier();
		if (!moduleSpecifier) continue;

		const currentReferencingFilePath = referencingFilePath;

		const newRelativePath = calculateRelativePath(
			currentReferencingFilePath,
			newFilePath,
			{
				removeExtensions: ![".js", ".jsx", ".json", ".mjs", ".cjs"].includes(
					path.extname(originalSpecifierText),
				),
				simplifyIndex: true,
			},
		);

		const currentSpecifier = moduleSpecifier.getLiteralText();
		if (currentSpecifier !== newRelativePath) {
			logger.trace(
				{
					file: currentReferencingFilePath,
					from: currentSpecifier,
					to: newRelativePath,
					kind: declaration.getKindName(),
				},
				"Updating module specifier",
			);
			try {
				declaration.setModuleSpecifier(newRelativePath);
			} catch (err) {
				logger.error(
					{ err, file: currentReferencingFilePath, newPath: newRelativePath },
					"Failed to set module specifier",
				);
			}
		}
	}
}
