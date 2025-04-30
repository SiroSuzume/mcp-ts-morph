import { type Project, SyntaxKind, type Identifier, type Node } from "ts-morph";
// 共通関数をインポート
import {
	initializeProject,
	getChangedFiles,
	saveProjectChanges,
} from "./ts-morph-project";

// --- Helper Functions ---

/**
 * 指定されたファイルと位置から Identifier ノードを検索する
 */
export function findIdentifierNode(
	project: Project,
	targetFilePath: string,
	position: { line: number; column: number },
): Identifier {
	const sourceFile = project.getSourceFile(targetFilePath);
	if (!sourceFile)
		throw new Error(`ファイルが見つかりません: ${targetFilePath}`);

	let positionOffset: number;
	try {
		positionOffset = sourceFile.compilerNode.getPositionOfLineAndCharacter(
			position.line - 1,
			position.column - 1,
		);
	} catch (error) {
		throw new Error(
			`指定位置 (${position.line}:${position.column}) はファイルの範囲外か無効です`,
		);
	}

	const node = sourceFile.getDescendantAtPos(positionOffset);

	if (!node) {
		throw new Error(
			`指定位置 (${position.line}:${position.column}) にノードが見つかりません`,
		);
	}

	const identifier = node.asKind(SyntaxKind.Identifier);

	if (
		identifier &&
		identifier.getStart() <= positionOffset &&
		positionOffset < identifier.getEnd()
	) {
		return identifier;
	}

	throw new Error(
		`指定位置 (${position.line}:${position.column}) は Identifier ではありません`,
	);
}

/**
 * Identifier ノードが期待されるシンボル名と種類（親ノードの種類）であるか検証する
 */
export function validateSymbol(
	identifier: Identifier,
	expectedSymbolName: string,
): void {
	if (identifier.getText() === expectedSymbolName) {
		return;
	}
	throw new Error(
		`シンボル名が一致しません (期待: ${expectedSymbolName}, 実際: ${identifier.getText()})`,
	);
}

/**
 * 指定された Identifier ノードの参照箇所をすべて取得する
 * (定義箇所を含む場合があることに注意)
 * @param identifier 参照を検索する対象の Identifier ノード
 * @returns 参照箇所の Node 配列
 */
export function findAllReferencesAsNodes(identifier: Identifier): Node[] {
	return identifier.findReferencesAsNodes();
}

/**
 * 指定されたシンボルをプロジェクト全体でリネームする
 */
export async function renameSymbol({
	tsconfigPath,
	targetFilePath,
	position,
	symbolName,
	newName,
	dryRun = false,
}: {
	tsconfigPath: string;
	targetFilePath: string;
	position: { line: number; column: number };
	symbolName: string;
	newName: string;
	dryRun?: boolean;
}): Promise<{ changedFiles: string[] }> {
	const project = initializeProject(tsconfigPath);
	const identifierNode = findIdentifierNode(project, targetFilePath, position);
	validateSymbol(identifierNode, symbolName);
	identifierNode.rename(newName);

	const changedFiles = getChangedFiles(project);

	if (!dryRun) {
		await saveProjectChanges(project);
	}
	return { changedFiles: changedFiles.map((f) => f.getFilePath()) };
}
