import { SyntaxKind, type Statement, type Node } from "ts-morph";
import { getDeclarationIdentifier } from "./get-declaration-identifier";
import logger from "../../utils/logger";

/**
 * 与えられたノードを含むトップレベルの Statement を見つける。
 * ノード自身がトップレベル Statement の場合はそれを返す。
 * 見つからない場合は undefined を返す。
 */
function findContainingTopLevelStatement(
	node: Node,
	sourceFile: Node, // SourceFile は Node のサブタイプ
	isTopLevelStatementFn: (n: Node) => n is Statement,
): Statement | undefined {
	if (isTopLevelStatementFn(node)) {
		return node;
	}

	let current: Node | undefined = node;
	while (current && !isTopLevelStatementFn(current)) {
		current = current.getParent();
		if (!current || current === sourceFile) {
			// SourceFile に到達するか、親がなくなったら探索終了
			return undefined;
		}
	}
	// current が isTopLevelStatementFn を満たす Statement であるはず
	return current as Statement | undefined;
}

/**
 * 宣言が内部依存関係の条件を満たすかチェックし、満たす場合は dependencies Set に追加する。
 */
function checkAndAddDependency(
	declaration: Node, // ここは Statement ではない可能性がある
	sourceFile: Node,
	isTopLevelStatementFn: (n: Node) => n is Statement,
	targetDeclaration: Statement,
	dependencies: Set<Statement>,
) {
	logger.trace(
		`Checking declaration: ${declaration.getKindName()} starting with '${declaration.getText().substring(0, 30)}...'`,
	);
	if (declaration.getSourceFile() !== sourceFile) {
		logger.trace("Skipping declaration from different source file.");
		return;
	}

	const containingTopLevelStmt = findContainingTopLevelStatement(
		declaration,
		sourceFile,
		isTopLevelStatementFn,
	);
	logger.trace(
		`Containing top level statement: ${containingTopLevelStmt?.getKindName() ?? "None"}`,
	);

	// --- Guard Clauses ---
	// 1. トップレベルステートメントが見つからない or 移動対象自身なら対象外
	if (!containingTopLevelStmt || containingTopLevelStmt === targetDeclaration) {
		return;
	}

	// 2. 依存関係として意味のある Kind かチェック
	const kind = containingTopLevelStmt.getKind();
	const isRelevantKind = [
		SyntaxKind.VariableStatement,
		SyntaxKind.FunctionDeclaration,
		SyntaxKind.ClassDeclaration,
		SyntaxKind.InterfaceDeclaration,
		SyntaxKind.TypeAliasDeclaration,
		SyntaxKind.EnumDeclaration,
	].includes(kind);

	if (!isRelevantKind) {
		logger.trace(
			`Skipping dependency of kind: ${containingTopLevelStmt.getKindName()}`,
		);
		return;
	}

	// 3. 既に依存関係として追加済みなら対象外
	if (dependencies.has(containingTopLevelStmt)) {
		logger.trace(
			`Dependency already added: ${containingTopLevelStmt.getKindName()}`,
		);
		return;
	}

	// --- Add Dependency ---
	logger.trace(
		`Adding dependency: ${containingTopLevelStmt.getKindName()} starting with '${containingTopLevelStmt.getText().substring(0, 30)}...'`,
	);
	dependencies.add(containingTopLevelStmt);
}

/**
 * 指定された宣言ノードがファイル内部で依存している他のトップレベル宣言ノードを特定する
 * @param targetDeclaration 依存関係を調べる対象の宣言ノード (FunctionDeclaration, VariableStatement など)
 * @returns 依存先のトップレベル宣言ノードの配列
 */
export function getInternalDependencies(
	targetDeclaration: Statement,
): Statement[] {
	logger.debug(
		`Getting internal dependencies for: ${targetDeclaration.getKindName()} starting with '${targetDeclaration.getText().substring(0, 30)}...'`,
	);
	const dependencies = new Set<Statement>();
	const sourceFile = targetDeclaration.getSourceFile();
	const allTopLevelStatements = sourceFile.getStatements();

	const isTopLevelStatement = (node: Node): node is Statement => {
		return (
			node.getParentIfKind(SyntaxKind.SourceFile) === sourceFile &&
			allTopLevelStatements.includes(node as Statement)
		);
	};

	const identifiers = targetDeclaration.getDescendantsOfKind(
		SyntaxKind.Identifier,
	);

	const targetIdentifierNode = getDeclarationIdentifier(targetDeclaration);

	for (const identifier of identifiers) {
		logger.trace(`Processing identifier: ${identifier.getText()}`);
		// --- 自己参照や内部定義はスキップ ---
		if (targetIdentifierNode && identifier === targetIdentifierNode) {
			logger.trace(`Skipping self-reference: ${identifier.getText()}`);
			continue;
		}

		// --- 外部参照の処理 ---
		const symbol = identifier.getSymbol();
		if (!symbol) {
			logger.trace(`No symbol found for identifier: ${identifier.getText()}`);
			continue;
		}

		const declarations = symbol.getDeclarations();
		logger.trace(
			`Found ${declarations.length} declarations for symbol: ${symbol.getName()}`,
		);

		// 各宣言をチェックして依存関係セットに追加
		for (const declaration of declarations) {
			checkAndAddDependency(
				declaration,
				sourceFile,
				isTopLevelStatement,
				targetDeclaration,
				dependencies,
			);
		}
	}

	logger.debug(
		`Found ${dependencies.size} internal dependencies for target declaration.`,
	);
	return Array.from(dependencies);
}
