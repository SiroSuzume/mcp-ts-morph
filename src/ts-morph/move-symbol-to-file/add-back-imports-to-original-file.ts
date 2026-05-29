import type { SourceFile, Statement } from "ts-morph";
import { calculateRelativePath } from "../_utils/calculate-relative-path";
import logger from "../../utils/logger";
import { getDeclarationIdentifier } from "./get-declaration-identifier";

/**
 * 移動対象として削除される宣言のうち、移動元ファイルに残るコードから
 * まだ参照されているシンボル名を収集する。
 *
 * 削除前に呼び出す必要がある（参照解決のため宣言が存在している状態）。
 * 戻り値の名前は、移動先ファイルからの「逆向き import」が必要なシンボル。
 */
export function collectSymbolsNeedingBackImport(
	declarationsToRemove: Statement[],
): string[] {
	if (declarationsToRemove.length === 0) {
		return [];
	}

	const sourceFile = declarationsToRemove[0].getSourceFile();
	const filePath = sourceFile.getFilePath();
	const removedRanges = declarationsToRemove.map(
		(decl) => [decl.getStart(), decl.getEnd()] as const,
	);

	const names: string[] = [];
	for (const declaration of declarationsToRemove) {
		const identifier = getDeclarationIdentifier(declaration);
		if (!identifier) {
			continue;
		}
		const name = identifier.getText();

		const referencedByRemainingCode = identifier
			.findReferencesAsNodes()
			.some((ref) => {
				if (ref.getSourceFile().getFilePath() !== filePath) {
					return false;
				}
				const pos = ref.getStart();
				const insideRemovedDeclaration = removedRanges.some(
					([start, end]) => pos >= start && pos < end,
				);
				return !insideRemovedDeclaration;
			});

		if (referencedByRemainingCode && !names.includes(name)) {
			names.push(name);
		}
	}

	return names;
}

/**
 * 移動元ファイルに、移動先ファイルから指定シンボルを import する宣言を追加する。
 * 同一モジュールへの既存 import があればマージする。
 *
 * ts-morph の `fixMissingImports()` は language service 経由の text 置換で
 * AST 不整合 ("children ... same count") を起こすことがあるため、
 * 構造的な `addImportDeclaration` で明示的に追加する。
 */
export function addBackImportsToOriginalFile(
	originalSourceFile: SourceFile,
	newFilePath: string,
	names: string[],
): void {
	if (names.length === 0) {
		return;
	}

	const moduleSpecifier = calculateRelativePath(
		originalSourceFile.getFilePath(),
		newFilePath,
		{ removeExtensions: true, simplifyIndex: true },
	);

	const existing = originalSourceFile.getImportDeclaration(
		(decl) => decl.getModuleSpecifierValue() === moduleSpecifier,
	);

	if (existing) {
		const existingNames = new Set(
			existing.getNamedImports().map((spec) => spec.getNameNode().getText()),
		);
		for (const name of names) {
			if (!existingNames.has(name)) {
				existing.addNamedImport(name);
			}
		}
	} else {
		originalSourceFile.addImportDeclaration({
			moduleSpecifier,
			namedImports: names,
		});
	}

	logger.debug(
		{ names, moduleSpecifier, file: originalSourceFile.getFilePath() },
		"移動元ファイルに逆向き import を追加。",
	);
}
