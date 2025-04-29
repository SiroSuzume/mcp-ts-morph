import { type Project, SyntaxKind, type Identifier } from "ts-morph";
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
	expectedSymbolKind: string,
): void {
	if (identifier.getText() !== expectedSymbolName) {
		throw new Error(
			`シンボル名が一致しません (期待: ${expectedSymbolName}, 実際: ${identifier.getText()})`,
		);
	}

	const parent = identifier.getParent();
	let actualKind: string | undefined;
	let isValidKind = false;

	if (parent) {
		actualKind = parent.getKindName();
		if (
			expectedSymbolKind.toLowerCase() === "function" &&
			parent.getKind() === SyntaxKind.FunctionDeclaration
		)
			isValidKind = true;
		else if (
			expectedSymbolKind.toLowerCase() === "variable" &&
			parent.getKind() === SyntaxKind.VariableDeclaration
		)
			isValidKind = true;
		else if (
			expectedSymbolKind.toLowerCase() === "class" &&
			parent.getKind() === SyntaxKind.ClassDeclaration
		)
			isValidKind = true;
	}
}

/**
 * Identifier ノードのリネームを実行する
 */
export function executeRename(identifier: Identifier, newName: string): void {
	try {
		identifier.rename(newName);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`リネームに失敗しました: ${message}`);
	}
}

// --- Main Function ---

/**
 * 指定されたシンボルをプロジェクト全体でリネームする
 */
export async function renameSymbol({
	tsconfigPath,
	targetFilePath,
	position,
	symbolName,
	newName,
	symbolKind,
	dryRun = false,
}: {
	tsconfigPath: string;
	targetFilePath: string;
	position: { line: number; column: number };
	symbolName: string;
	newName: string;
	symbolKind: "function" | "variable" | "class" | string;
	dryRun?: boolean;
}): Promise<{ changedFiles: string[] }> {
	const project = initializeProject(tsconfigPath);
	const identifierNode = findIdentifierNode(project, targetFilePath, position);
	validateSymbol(identifierNode, symbolName, symbolKind);
	executeRename(identifierNode, newName);

	const changedFiles = getChangedFiles(project);

	if (!dryRun) {
		await saveProjectChanges(project);
	}
	return { changedFiles: changedFiles.map((f) => f.getFilePath()) };
}
