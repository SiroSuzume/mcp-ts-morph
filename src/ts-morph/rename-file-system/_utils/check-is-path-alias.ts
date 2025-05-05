/**
 * モジュール指定子が tsconfig で定義されたパスエイリアスを使用しているかチェックする
 */
export function checkIsPathAlias(
	specifier: string,
	tsConfigPaths?: Record<string, string[]>,
): boolean {
	if (!tsConfigPaths) {
		return false;
	}
	return Object.keys(tsConfigPaths).some((aliasKey) =>
		specifier.startsWith(aliasKey.replace(/\*$/, "")),
	);
}
