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
 * 宣言が内部依存関係の条件を満たすかチェックし、満たす場合はトップレベル Statement を返す。
 */
function getValidTopLevelDependency(
	declaration: Node,
	sourceFile: Node,
	isTopLevelStatementFn: (n: Node) => n is Statement,
	targetDeclaration: Statement,
): Statement | undefined {
	logger.trace(
		`Checking declaration: ${declaration.getKindName()} starting with '${declaration
			.getText()
			.substring(0, 30)}...'`,
	);
	if (declaration.getSourceFile() !== sourceFile) {
		logger.trace("Skipping declaration from different source file.");
		return undefined;
	}

	const containingTopLevelStmt = findContainingTopLevelStatement(
		declaration,
		sourceFile,
		isTopLevelStatementFn,
	);
	logger.trace(
		`Containing top level statement: ${containingTopLevelStmt?.getKindName() ?? "None"}`,
	);

	// Guard Clauses
	if (!containingTopLevelStmt || containingTopLevelStmt === targetDeclaration) {
		return undefined;
	}

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
		return undefined;
	}

	return containingTopLevelStmt;
}

/**
 * 指定されたノードから内部依存関係を再帰的に探索し、依存関係セットに追加する。
 */
function findDependenciesRecursive(
	currentNode: Statement, // 探索を開始するノード (トップレベル Statement)
	dependencies: Set<Statement>, // 結果を蓄積する Set
	visited: Set<Statement>, // 訪問済みノードを記録する Set
	sourceFile: Node,
	isTopLevelStatementFn: (n: Node) => n is Statement,
	targetDeclaration: Statement, // 元々の移動対象ノード
) {
	// 既に訪問済みなら処理しない (循環参照防止)
	if (visited.has(currentNode)) {
		return;
	}
	visited.add(currentNode);
	logger.trace(
		`Recursively finding dependencies for: ${currentNode.getKindName()} starting with '${currentNode
			.getText()
			.substring(0, 30)}...'`,
	);

	const identifiers = currentNode.getDescendantsOfKind(SyntaxKind.Identifier);
	const currentIdentifierNode = getDeclarationIdentifier(currentNode);

	for (const identifier of identifiers) {
		// 自己参照や内部定義はスキップ (ただし、依存関係の探索では必要に応じて処理)
		if (currentIdentifierNode && identifier === currentIdentifierNode) {
			continue;
		}

		const symbol = identifier.getSymbol();
		if (!symbol) continue;

		const declarations = symbol.getDeclarations();
		for (const declaration of declarations) {
			const validDependency = getValidTopLevelDependency(
				declaration,
				sourceFile,
				isTopLevelStatementFn,
				targetDeclaration, // 依存関係の判定基準は元の移動対象
			);

			if (validDependency && !dependencies.has(validDependency)) {
				logger.trace(
					`Adding dependency: ${validDependency.getKindName()} starting with '${validDependency
						.getText()
						.substring(0, 30)}...'`,
				);
				dependencies.add(validDependency);
				// 新しく見つかった依存関係について再帰的に探索
				findDependenciesRecursive(
					validDependency,
					dependencies,
					visited,
					sourceFile,
					isTopLevelStatementFn,
					targetDeclaration,
				);
			}
		}
	}
}

/**
 * 指定された宣言ノードがファイル内部で依存している他のトップレベル宣言ノードを特定する
 * (直接的および間接的な依存関係を含む)
 */
export function getInternalDependencies(
	targetDeclaration: Statement,
): Statement[] {
	logger.debug(
		`Getting internal dependencies for: ${targetDeclaration.getKindName()} starting with '${targetDeclaration
			.getText()
			.substring(0, 30)}...'`,
	);
	const dependencies = new Set<Statement>();
	const visited = new Set<Statement>();
	const sourceFile = targetDeclaration.getSourceFile();
	const allTopLevelStatements = sourceFile.getStatements();

	const isTopLevelStatement = (node: Node): node is Statement => {
		return (
			node.getParentIfKind(SyntaxKind.SourceFile) === sourceFile &&
			allTopLevelStatements.includes(node as Statement)
		);
	};

	// targetDeclaration 自体を起点として再帰的に探索を開始
	findDependenciesRecursive(
		targetDeclaration,
		dependencies,
		visited,
		sourceFile,
		isTopLevelStatement,
		targetDeclaration,
	);

	logger.debug(
		`Found ${dependencies.size} internal dependencies (including indirect) for target declaration.`,
	);
	return Array.from(dependencies);
}
