import { type CallExpression, type Identifier, Node } from "ts-morph";

/**
 * Identifier がコール式の callee 位置にあるか判定し、該当する CallExpression を返す。
 * 該当しない場合 (代入先、型注釈、コメントなど) は undefined。
 *
 * 対応する形:
 *   foo()                       -> identifier 'foo' の親が CallExpression
 *   obj.foo()                   -> identifier 'foo' の親が PropertyAccess、その親が CallExpression
 *   obj?.foo()                  -> PropertyAccess (optional chain) を経由
 *   a.b.foo()                   -> 連鎖した PropertyAccess を遡る
 */
export function getEnclosingCallExpression(
	identifier: Identifier,
): CallExpression | undefined {
	let current: Node = identifier;

	while (true) {
		const parent = current.getParent();
		if (!parent) return undefined;

		if (Node.isPropertyAccessExpression(parent)) {
			// identifier がプロパティ名 (右側) であれば PropertyAccess に登っていく
			if (parent.getNameNode() === current) {
				current = parent;
				continue;
			}
			return undefined;
		}

		if (Node.isCallExpression(parent)) {
			if (parent.getExpression() === current) {
				return parent;
			}
			return undefined;
		}

		return undefined;
	}
}

/**
 * 参照 Node 群から呼び出し式のみを抽出する
 */
export function filterCallSites(references: Node[]): CallExpression[] {
	const calls: CallExpression[] = [];
	for (const ref of references) {
		if (!Node.isIdentifier(ref)) continue;
		const call = getEnclosingCallExpression(ref);
		if (call) calls.push(call);
	}
	return calls;
}
