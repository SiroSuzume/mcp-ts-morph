import {
	SyntaxKind,
	type FunctionDeclaration,
	type ImportDeclaration,
	type SourceFile,
	type Statement,
} from "ts-morph";
import { getInternalDependencies } from "./internal-dependencies";

export function getDependentImportDeclarations(
	targetNode: FunctionDeclaration,
): ImportDeclaration[] {
	const dependentImports = new Set<ImportDeclaration>();

	// 1. 関数内のすべての Identifier を取得
	const identifiers = targetNode.getDescendantsOfKind(SyntaxKind.Identifier);

	for (const identifier of identifiers) {
		// 2. 各 Identifier の Symbol を取得し、その宣言を調べる
		const symbol = identifier.getSymbol();
		if (!symbol) continue;

		const declarations = symbol.getDeclarations();

		for (const declaration of declarations) {
			// 3. 宣言が ImportDeclaration の子孫であるか確認
			//    (ImportSpecifier, NamespaceImport, ImportClause などが該当)
			const importDeclaration = declaration.getFirstAncestorByKind(
				SyntaxKind.ImportDeclaration,
			);

			if (importDeclaration) {
				// 4. 見つかった ImportDeclaration を Set に追加 (重複排除)
				dependentImports.add(importDeclaration);
				// このシンボルに対応する ImportDeclaration が見つかれば、
				// 同じシンボルの他の宣言をチェックする必要はない場合が多い
				// break; // 必要に応じて break を検討
			}
		}
	}

	// 5. Set を配列に変換して返す
	return Array.from(dependentImports);
}

/**
 * ファイル直下のトップレベルの宣言ノードを取得する
 * (Import/Export宣言、空のステートメントなどは除く)
 */
export function getTopLevelDeclarationsFromFile(
	sourceFile: SourceFile,
): Statement[] {
	// 1. ファイル直下のすべてのステートメントを取得
	const allStatements = sourceFile.getStatements();

	// 2. 目的の宣言ノードのみをフィルタリング
	const declarationStatements = allStatements.filter((statement) => {
		const kind = statement.getKind();
		return (
			kind === SyntaxKind.VariableStatement ||
			kind === SyntaxKind.FunctionDeclaration ||
			kind === SyntaxKind.ClassDeclaration ||
			kind === SyntaxKind.TypeAliasDeclaration ||
			kind === SyntaxKind.InterfaceDeclaration
		);
	});

	return declarationStatements;
}

/**
 * 移動対象の宣言ノードと、それに依存するすべての内部宣言、および必要なインポート宣言を取得する。
 * @param targetDeclaration 移動対象のトップレベル宣言ノード
 * @returns 移動に必要な内部宣言の Set とインポート宣言の Set を含むオブジェクト
 */
export function getDependenciesForMovingSymbol(targetDeclaration: Statement): {
	internalDeclarations: Set<Statement>;
	importDeclarations: Set<ImportDeclaration>;
} {
	const internalDeclarations = new Set<Statement>();
	const importDeclarations = new Set<ImportDeclaration>();
	const declarationQueue: Statement[] = [targetDeclaration]; // 処理対象キュー
	const processedDeclarations = new Set<Statement>(); // 処理済み記録 (循環参照防止)

	// 1. 依存関係ツリーの構築 (内部宣言)
	while (declarationQueue.length > 0) {
		const currentDeclaration = declarationQueue.shift();

		if (!currentDeclaration) {
			// キューが空になったら終了
			break;
		}

		if (processedDeclarations.has(currentDeclaration)) {
			continue; // 既に処理済み
		}
		processedDeclarations.add(currentDeclaration);

		// 自分自身は移動対象なので internalDeclarations には含めない (キューの起点のみ)
		if (currentDeclaration !== targetDeclaration) {
			internalDeclarations.add(currentDeclaration);
		}

		// 直接的な内部依存を取得
		const directDependencies = getInternalDependencies(currentDeclaration);

		for (const dependency of directDependencies) {
			if (!processedDeclarations.has(dependency)) {
				declarationQueue.push(dependency);
			}
		}
	}

	// 2. 必要なインポート宣言の収集
	const allDeclarationsToScan = [targetDeclaration, ...internalDeclarations];

	for (const decl of allDeclarationsToScan) {
		// 現状 getDependentImportDeclarations は FunctionDeclaration のみ対応
		if (decl.isKind(SyntaxKind.FunctionDeclaration)) {
			const imports = getDependentImportDeclarations(
				decl as FunctionDeclaration,
			);
			for (const imp of imports) {
				importDeclarations.add(imp);
			}
		}
		// TODO: VariableStatement や ClassDeclaration など他の種類の宣言が持つ
		//       import 依存も収集できるように getDependentImportDeclarations を拡張するか、
		//       ここで別途処理を追加する必要がある。
	}

	return {
		internalDeclarations,
		importDeclarations,
	};
}
