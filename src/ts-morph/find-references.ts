import type { Node, SourceFile } from "ts-morph";
import { initializeProject } from "./ts-morph-project";
import { findIdentifierNode } from "./rename-symbol";

// --- Data Structure for Result ---

export interface ReferenceLocation {
	filePath: string;
	line: number;
	column: number;
	text: string;
}

// --- Main Function ---

/**
 * 指定された位置にあるシンボルの参照箇所をプロジェクト全体から検索する
 */
export async function findSymbolReferences({
	tsconfigPath,
	targetFilePath,
	position,
}: {
	tsconfigPath: string;
	targetFilePath: string;
	position: { line: number; column: number };
}): Promise<{
	references: ReferenceLocation[];
	definition: ReferenceLocation | null;
}> {
	const project = initializeProject(tsconfigPath);

	// targetFilePath は絶対パスである想定
	const identifierNode = findIdentifierNode(project, targetFilePath, position);

	// findReferencesAsNodes() は定義箇所を含まない場合がある
	const referenceNodes: Node[] = identifierNode.findReferencesAsNodes();

	let definitionLocation: ReferenceLocation | null = null;
	const definitions = identifierNode.getDefinitionNodes();
	if (definitions.length > 0) {
		const defNode = definitions[0];
		const defSourceFile = defNode.getSourceFile();
		const defStartPos = defNode.getStart();
		const { line: defLine, column: defColumn } =
			defSourceFile.getLineAndColumnAtPos(defStartPos);
		const lineText = getLineText(defSourceFile, defLine);
		definitionLocation = {
			filePath: defSourceFile.getFilePath(),
			line: defLine,
			column: defColumn,
			text: lineText.trim(),
		};
	}

	const references: ReferenceLocation[] = [];
	for (const refNode of referenceNodes) {
		const refSourceFile = refNode.getSourceFile();
		const refStartPos = refNode.getStart();
		const { line: refLine, column: refColumn } =
			refSourceFile.getLineAndColumnAtPos(refStartPos);

		if (
			definitionLocation &&
			refLine !== undefined &&
			refColumn !== undefined &&
			refSourceFile.getFilePath() === definitionLocation.filePath &&
			refLine === definitionLocation.line &&
			refColumn === definitionLocation.column
		) {
			continue; // 定義箇所と同じであればスキップ
		}

		if (refLine === undefined || refColumn === undefined) continue;

		const filePath = refSourceFile.getFilePath();
		const lineText = getLineText(refSourceFile, refLine);

		references.push({
			filePath,
			line: refLine,
			column: refColumn,
			text: lineText.trim(),
		});
	}

	references.sort((a, b) => {
		if (a.filePath !== b.filePath) {
			return a.filePath.localeCompare(b.filePath);
		}
		return a.line - b.line;
	});

	return { references, definition: definitionLocation };
}

function getLineText(sourceFile: SourceFile, lineNumber: number): string {
	// ファイル全体のテキストを取得し、行で分割して該当行を返す
	const lines = sourceFile.getFullText().split(/\r?\n/);
	// lineNumber は 1-based なので、インデックスは lineNumber - 1
	if (lineNumber > 0 && lineNumber <= lines.length) {
		return lines[lineNumber - 1];
	}
	// 該当行が見つからない場合、エラーとするか、空文字列を返すかなどの仕様による
	// ここではエラーを投げるのが自然かもしれない
	throw new Error(
		`Line ${lineNumber} not found in file ${sourceFile.getFilePath()}`,
	);
}
