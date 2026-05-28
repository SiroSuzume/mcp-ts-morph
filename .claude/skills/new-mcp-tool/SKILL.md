---
name: new-mcp-tool
description: このリポジトリに新しい ts-morph リファクタリング MCP ツールを追加するときの定型作業をガイドする。ts-morph ロジック・MCP 登録ファイル・コロケートテスト・aggregator への登録・README/CLAUDE.md への追記までを抜け漏れなく行う。「新しいツールを追加」「MCP ツールを増やす」「register-*.ts を作る」等で使用。
disable-model-invocation: true
---

# 新しい MCP ツールを追加する

`@sirosuzume/mcp-tsmorph-refactor` に新ツールを 1 つ追加するときの定型手順。過去に README のツール表と CLAUDE.md のモジュール一覧が実態とドリフトしたため、**ドキュメント追記まで含めて 1 つの作業**として扱う。

t-wada 式 TDD で進める（テストファースト → レッド → グリーン → リファクタ）。ロジックは ts-morph レイヤーに置き、MCP レイヤーは薄い登録だけにする。

## 作成・更新するファイル一覧

新ツール名を仮に `do_something_by_tsmorph`、ロジックを `src/ts-morph/do-something/` に置く場合：

1. **ts-morph ロジック**: `src/ts-morph/do-something/do-something.ts`
   - 純粋関数として実装。`initializeProject(tsconfigPath)` で受け取った `Project` を引数に取り、結果オブジェクトを返す（または Result 型を検討）。
   - 例外は握りつぶさず、呼び出し側でメッセージ化できるよう投げる。
2. **コロケートテスト**: `src/ts-morph/do-something/do-something.test.ts`
   - Vitest。仕様としてのテストを先に書く。Mock は極力使わず、使うときはコメントで理由を補足。
   - `src/ts-morph/_test-utils/` のヘルパーで一時プロジェクトを組み立てる（既存テストを参照）。
   - **既知の落とし穴を必ずケース化**: default export / 再エクスポート / パスエイリアス / node_modules 越し参照のうち、該当するもの。
3. **MCP 登録ファイル**: `src/mcp/tools/register-do-something-tool.ts`
   - 既存の `register-get-type-at-position-tool.ts` を雛形にする（下記テンプレ）。
4. **aggregator へ登録**: `src/mcp/tools/ts-morph-tools.ts`
   - import を 1 行追加し、`registerTsMorphTools` 内で `registerDoSomethingTool(server);` を呼ぶ。
5. **README.md**:
   - 「提供されるツール」のツール表に 1 行追加（`[\`do_something_by_tsmorph\`](#do_something_by_tsmorph)`）。
   - 対応する詳細セクション（機能・ユースケース・必要な情報・注意）を追加。
6. **CLAUDE.md**:
   - 「ts-morphレイヤー」のモジュール一覧に `do-something/` を追加。
   - 「主要な機能と実装ファイル」に 1 行追加。

## register-*.ts テンプレート

既存ツールに合わせた骨格。`server.tool(name, description, zodSchema, handler)` の 4 引数。

```typescript
import { performance } from "node:perf_hooks";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { initializeProject } from "../../ts-morph/_utils/ts-morph-project";
import { doSomething } from "../../ts-morph/do-something/do-something";
import logger from "../../utils/logger";

// logger 自体が投げても MCP レスポンス生成を阻まないようにラップする
function safeLogError(error: unknown, toolArgs: Record<string, unknown>): void {
	try {
		logger.error({ err: error, toolArgs }, "Error executing do_something_by_tsmorph");
	} catch (loggerErr) {
		console.error("Failed to write error log:", loggerErr);
	}
}

function safeLogInfo(fields: Record<string, unknown>): void {
	try {
		logger.info(fields, "do_something_by_tsmorph tool finished");
	} catch (loggerErr) {
		console.error("Failed to write info log:", loggerErr);
	}
}

export function registerDoSomethingTool(server: McpServer): void {
	server.tool(
		"do_something_by_tsmorph",
		`[ts-morph] <一行サマリ>

## When to use
- ...

## When NOT to use
- ...

## Critical constraints
- All paths (\`tsconfigPath\`, ...) MUST be absolute.
- position は 1-based（line/column）。`,
		{
			tsconfigPath: z.string().describe("Path to the project's tsconfig.json file."),
			// ... 他パラメータ
		},
		async (args) => {
			const startTime = performance.now();
			let message = "";
			let isError = false;
			let duration = "0.00";
			const logArgs = { /* 主要 args */ };

			try {
				const project = initializeProject(args.tsconfigPath);
				const result = doSomething(project /*, ...args */);
				message = /* result を文字列化 */ "";
			} catch (error) {
				safeLogError(error, logArgs);
				message = `Error: ${error instanceof Error ? error.message : String(error)}`;
				isError = true;
			} finally {
				const endTime = performance.now();
				duration = ((endTime - startTime) / 1000).toFixed(2);
				safeLogInfo({
					status: isError ? "Failure" : "Success",
					durationMs: Number.parseFloat((endTime - startTime).toFixed(2)),
					...logArgs,
				});
				try {
					logger.flush();
				} catch (flushErr) {
					console.error("Failed to flush logs:", flushErr);
				}
			}

			return {
				content: [
					{
						type: "text",
						text: `${message}\nStatus: ${isError ? "Failure" : "Success"}\nProcessing time: ${duration} seconds`,
					},
				],
				isError,
			};
		},
	);
}
```

## 命名規約

- MCP ツール名: `snake_case` + `_by_tsmorph` サフィックス。
- 登録関数: `register<PascalCase>Tool`。
- ディレクトリ: `kebab-case`。

## 完了前チェック

```bash
pnpm check-types   # 型エラーなし
pnpm test          # 新テスト含め全パス
pnpm format        # Biome 整形
```

最後に `/check-docs` を実行し、登録ツール名と README/CLAUDE.md の記載が一致していることを確認する。
