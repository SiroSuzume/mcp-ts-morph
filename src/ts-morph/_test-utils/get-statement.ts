import type { KindToNodeMappings, SourceFile, SyntaxKind } from "ts-morph";
import { findTopLevelDeclarationByName } from "../move-symbol-to-file/find-declaration";

export function getStatement<K extends SyntaxKind>(
	sourceFile: SourceFile,
	name: string,
	kind: K,
): KindToNodeMappings[K] {
	const statement = findTopLevelDeclarationByName(sourceFile, name, kind);
	if (!statement) {
		throw new Error(
			`Test setup failed: top-level declaration '${name}' (kind=${kind}) not found`,
		);
	}
	return statement as KindToNodeMappings[K];
}
