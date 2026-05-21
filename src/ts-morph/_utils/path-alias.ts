/**
 * モジュール指定子が tsconfig の paths で定義されたエイリアスに一致するかを厳密に判定する。
 *
 * - エイリアスがワイルドカード (`@/*`) の場合は `*` を除いた prefix での前方一致
 * - ワイルドカードなし (`@app`) の場合は完全一致のみ
 *
 * 緩い `startsWith(aliasKey.replace("*", ""))` 方式だと
 * `@foo` で定義されたエイリアスが `@foobar/baz` を誤判定するため、ここでは厳密に揃える。
 */
export function isPathAlias(
	moduleSpecifier: string,
	aliasKeys: readonly string[],
): boolean {
	return aliasKeys.some((alias) => {
		if (moduleSpecifier === alias) {
			return true;
		}
		if (!alias.endsWith("/*")) {
			return false;
		}
		const prefix = alias.slice(0, -1);
		return moduleSpecifier.startsWith(prefix);
	});
}
