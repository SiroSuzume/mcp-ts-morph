import { Node } from "ts-morph";
import type { Identifier } from "ts-morph"; // Use import type for Identifier
// logger import removed for now
// SyntaxKind import removed as it's unused

/**
 * 様々な宣言ノード (変数宣言、関数宣言、クラス宣言、デフォルトエクスポートなど) から、
 * その宣言が表す主要な名前 (識別子) のノードを取得します。
 *
 * 例えば、`const foo = 1;` であれば `foo` の Identifier ノードを返します。
 * `export default myIdentifier;` であれば `myIdentifier` の Identifier ノードを返します。
 *
 * 識別子が見つからない場合 (例: 無名のエクスポート) や、
 * 未対応の宣言タイプの場合は undefined を返します。
 *
 * @param node - 対象の ts-morph 宣言ノード (Node型)。
 * @returns 識別子ノード (Identifier) または undefined。
 */
export function getIdentifierNodeFromDeclaration(
	node: Node,
): Identifier | undefined {
	// 1. 主要な宣言タイプを直接チェック
	if (Node.isVariableDeclaration(node)) {
		// VariableDeclaration の場合、getNameNode() で識別子を取得
		// 例: const foo = ...; -> foo
		const nameNode = node.getNameNode();
		// 分割代入など Identifier 以外の場合があるためチェック
		if (Node.isIdentifier(nameNode)) {
			return nameNode;
		}
		return undefined;
	}
	if (Node.isFunctionDeclaration(node) || Node.isClassDeclaration(node)) {
		// 関数/クラス宣言の場合、getNameNode() で識別子を取得
		// 例: function foo() {} -> foo, class Bar {} -> Bar
		// 無名関数/クラスの場合は undefined が返る
		return node.getNameNode();
	}
	if (
		Node.isInterfaceDeclaration(node) ||
		Node.isTypeAliasDeclaration(node) ||
		Node.isEnumDeclaration(node)
	) {
		// インターフェース/型エイリアス/列挙型宣言の場合、getNameNode() で識別子を取得
		return node.getNameNode();
	}

	// 2. デフォルトエクスポート (`export default ...`) の処理
	if (Node.isExportAssignment(node)) {
		const expression = node.getExpression();
		// `export default identifier;` の形式の場合
		if (Node.isIdentifier(expression)) {
			return expression;
		}
		// `export default function foo() {}` や `export default class Bar {}` の形式の場合
		// (無名の場合 getNameNode() は undefined を返す)
		if (
			Node.isFunctionDeclaration(expression) ||
			Node.isClassDeclaration(expression)
		) {
			return expression.getNameNode();
		}
		// export default () => {} や export default {} など、
		// 直接識別子を持たない式の場合はここでは取得できない
	}

	// 3. フォールバック処理
	//    (シンボルの getDeclarations() が直接 Identifier を返すなど、稀なケースに対応)
	if (Node.isIdentifier(node)) {
		return node;
	}

	// 4. 更なるフォールバック (やや不安定な可能性あり)
	//    ExportSpecifier など、getNameNode() メソッドを持つ他のノードタイプを試す
	//    例: export { originalName as aliasName }; の aliasName
	if ("getNameNode" in node && typeof node.getNameNode === "function") {
		const nameNode = node.getNameNode();
		if (Node.isIdentifier(nameNode)) {
			return nameNode;
		}
	}
	//    getName() メソッドを持つノードから名前を取得し、その名前を持つ Identifier を子孫から探す
	if ("getName" in node && typeof node.getName === "function") {
		const name = node.getName();
		if (typeof name === "string") {
			const identifier = node.getFirstDescendant(
				(descendant: Node) =>
					Node.isIdentifier(descendant) && descendant.getText() === name,
			);
			if (identifier && Node.isIdentifier(identifier)) return identifier;
		}
	}

	// logger.trace({ declarationKind: node.getKindName() }, 'Could not get Identifier from node kind'); // Logger call commented out
	return undefined;
}
