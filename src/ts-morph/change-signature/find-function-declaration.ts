import { type Identifier, Node, type ParameteredNode } from "ts-morph";

/** パラメータリストを持つ関数様ノード */
export type FunctionLikeWithParameters = Node & ParameteredNode;

/**
 * Identifier から所属する関数様宣言 (FunctionDeclaration / MethodDeclaration /
 * ArrowFunction / FunctionExpression / GetAccessor / SetAccessor) を取得する。
 */
export function findFunctionLikeDeclaration(
	identifier: Identifier,
): FunctionLikeWithParameters {
	const parent = identifier.getParent();
	if (!parent) {
		throw new Error("Identifier has no parent");
	}

	if (
		Node.isFunctionDeclaration(parent) &&
		parent.getNameNode() === identifier
	) {
		return parent;
	}
	if (Node.isMethodDeclaration(parent) && parent.getNameNode() === identifier) {
		return parent;
	}
	if (Node.isMethodSignature(parent) && parent.getNameNode() === identifier) {
		return parent;
	}
	if (
		Node.isGetAccessorDeclaration(parent) &&
		parent.getNameNode() === identifier
	) {
		return parent;
	}
	if (
		Node.isSetAccessorDeclaration(parent) &&
		parent.getNameNode() === identifier
	) {
		return parent;
	}
	if (
		Node.isFunctionExpression(parent) &&
		parent.getNameNode() === identifier
	) {
		return parent;
	}

	// const foo = () => {} / const foo = function() {}
	if (
		Node.isVariableDeclaration(parent) &&
		parent.getNameNode() === identifier
	) {
		const initializer = parent.getInitializer();
		if (
			initializer &&
			(Node.isArrowFunction(initializer) ||
				Node.isFunctionExpression(initializer))
		) {
			return initializer;
		}
	}

	// foo: () => {}  (property assignment in object literal)
	if (
		Node.isPropertyAssignment(parent) &&
		parent.getNameNode() === identifier
	) {
		const initializer = parent.getInitializer();
		if (
			initializer &&
			(Node.isArrowFunction(initializer) ||
				Node.isFunctionExpression(initializer))
		) {
			return initializer;
		}
	}

	const parentKind = parent.getKindName();
	throw new Error(
		`指定位置のシンボル '${identifier.getText()}' は関数宣言/メソッド/関数式ではありません (検出した親ノード種別: ${parentKind})。コンストラクタは対象外です。パラメータ自体やインポート位置を指していないか確認してください。`,
	);
}

/**
 * オーバーロード関数/メソッドの場合、関連する全宣言 (overload signature + implementation)
 * を返す。そうでなければ受け取った宣言だけを単独で返す。
 *
 * これにより `change_signature` 適用時にオーバーロードシグネチャの片方だけが
 * 変更されて型不整合になるのを防ぐ。
 */
export function getAllRelatedFunctionDeclarations(
	fn: FunctionLikeWithParameters,
): FunctionLikeWithParameters[] {
	if (Node.isFunctionDeclaration(fn) || Node.isMethodDeclaration(fn)) {
		const implementation = fn.isImplementation() ? fn : fn.getImplementation();
		if (implementation) {
			const overloads = implementation.getOverloads();
			if (overloads.length > 0) {
				return [...overloads, implementation];
			}
		}
		// オーバーロード無しでも getOverloads() を呼ぶことで MethodSignature の
		// 重複定義などには対応できないが、それは想定外。
	}
	return [fn];
}
