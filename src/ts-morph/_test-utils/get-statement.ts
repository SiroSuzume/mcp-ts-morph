import type { SourceFile, Statement, SyntaxKind } from "ts-morph";
import { findTopLevelDeclarationByName } from "../move-symbol-to-file/find-declaration";

export function getStatement<T extends Statement>(
	sourceFile: SourceFile,
	name: string,
	kind: SyntaxKind,
): T {
	const statement = findTopLevelDeclarationByName(sourceFile, name, kind);
	if (!statement) {
		throw new Error(
			`Test setup failed: top-level declaration '${name}' (kind=${kind}) not found`,
		);
	}
	return statement as T;
}
