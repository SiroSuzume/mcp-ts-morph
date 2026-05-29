import { defineConfig } from "vitest/config";

/**
 * E2E 用の Vitest 設定。
 *
 * 有名 OSS（hono 等）を固定バージョンで clone し、実プロジェクトに対して
 * 各 MCP ツールを適用 → 型チェック + 対象リポジトリのユニットテストが
 * リファクタ前後で同じ結果（差分緑）になることを検証する。
 *
 * clone と依存インストールを伴うため低速・ネットワーク依存。
 * デフォルトの `pnpm test` からは除外し、`pnpm test:e2e` で明示実行する。
 */
export default defineConfig({
	test: {
		include: ["e2e/**/*.e2e.test.ts"],
		// clone + bun install + tsc + vitest を 1 ケース内で回すため長め
		testTimeout: 600_000,
		hookTimeout: 600_000,
		// 対象リポジトリの作業ディレクトリを共有するので直列実行
		fileParallelism: false,
		pool: "threads",
		poolOptions: {
			threads: {
				singleThread: true,
			},
		},
	},
});
