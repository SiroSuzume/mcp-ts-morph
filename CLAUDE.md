# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 概要

MCP ts-morph Refactoring Tools - ts-morphを利用したTypeScript/JavaScriptのリファクタリングツールを提供するMCPサーバー。

## 開発コマンド

### ビルド
```bash
pnpm build        # TypeScriptをコンパイル（dist/に出力）
pnpm clean        # distディレクトリをクリーン
```

### テスト
```bash
pnpm test         # テスト実行（単一スレッドで実行）
pnpm test:watch   # ウォッチモードでテスト実行
pnpm test -- path/to/test.ts  # 特定のテストファイルを実行
pnpm test:e2e     # 実リポジトリ E2E（hono/zustand を clone して全ツール適用）
```

### E2E テスト（`pnpm test:e2e`）

`e2e/` は、バージョン固定の実 OSS（hono / zustand）を clone し、各 MCP ツールを
実プロジェクトに適用して「差分緑」（baseline と比較し新規型エラー・新規失敗テスト
が無いこと）を検証する。ユニットテストでは拾えない実世界の AST 不整合を掘り当てる
（例: `move_symbol_to_file` の逆向き import バグ）。

- デフォルトの `pnpm test` からは除外（`vitest.config.ts` の exclude）。CI には
  未組み込み（nightly + 手動 dispatch を予定）。
- 初回は clone + 依存インストールが走る（`bun` / `pnpm` が必要。無ければ baseline
  未取得で各ケース skip）。2 回目以降は `e2e/.cache/*.ready` マーカで再利用。
- 実行時間の目安: キャッシュ有りで 2〜3 分。

**Claude への指示**: `src/ts-morph/**` のリファクタロジック（特に
`move-symbol-to-file` / `rename-*` / `remove-path-alias` / `change-signature`）に
触れた変更は、**仕上げ段階（コミット前 / PR 化前）で `pnpm test:e2e` を実行**して
実リポジトリで退行が無いことを確認すること。時間がかかるので開発の各イテレーション
ではなく、まとまった作業の最後に回す。ネットワークや `bun` 不在で skip された場合は
その旨をユーザーに伝える。

### 型チェック・リント・フォーマット
```bash
pnpm check-types  # TypeScriptの型チェック（コンパイルなし）
pnpm lint         # Biomeでリントチェック
pnpm lint:fix     # Biomeでリント修正
pnpm format       # Biomeでコードフォーマット
```

### デバッグ
```bash
pnpm inspector    # MCP Inspectorでデバッグ実行
```

### リリース（バージョン bump）

**Git タグが単一の真実の source。手で bump しない。**

- `package.json` の `version` と `src/version.ts` の `VERSION` はどちらも `0.0.0-development` に固定。
- リリースは `git tag vX.Y.Z && git push origin vX.Y.Z` のみ。
- `.github/workflows/release.yml` が tag から値を抽出して両ファイルを書き換え、`pnpm build` → `pnpm test` → `dist` の整合性確認 → `pnpm publish` を実行する。
- 詳細手順は `.claude/skills/release/SKILL.md` および README の「リリース」セクション参照。
- ユーザーから「リリース」「タグを打って」等を言われたら release skill を使うこと。

## プロジェクト構造

### コアアーキテクチャ

1. **エントリーポイント**: `src/index.ts`
   - MCPサーバーのエントリーポイント
   - STDIOサーバーを起動

2. **MCPレイヤー** (`src/mcp/`)
   - `stdio.ts`: STDIOサーバーの実装
   - `config.ts`: サーバー設定
   - `tools/`: MCPツールの登録と実装
     - 各ツールは`register-*.ts`として実装
     - `ts-morph-tools.ts`で全ツールを統合

3. **ts-morphレイヤー** (`src/ts-morph/`)
   - 実際のリファクタリング処理を実装
   - 各機能は独立したモジュールとして実装：
     - `rename-symbol/`: シンボル名の変更
     - `rename-file-system/`: ファイル/フォルダのリネーム
     - `remove-path-alias/`: パスエイリアスの削除
     - `find-references.ts`: 参照検索
     - `move-symbol-to-file/`: シンボルのファイル間移動
     - `find-unused-exports.ts`: 未使用 export の検出
     - `change-signature/`: 関数シグネチャの変更
     - `get-type-at-position/`: 指定位置の型情報の取得
   - `_utils/`: 共通ユーティリティ
     - `ts-morph-project.ts`: プロジェクト作成の共通処理
   - `_test-utils/`: テスト用ヘルパー

4. **ユーティリティ** (`src/utils/`)
   - `logger.ts`: Pinoベースのロガー実装
   - その他の共通ユーティリティ

5. **エラー処理** (`src/errors/`)
   - カスタムエラークラスの定義

### テスト構造

- 各機能モジュールには対応する`.test.ts`ファイルが存在
- テストフレームワーク: Vitest
- テストサンドボックス: `packages/sandbox/`にテスト用のTypeScriptコード

## 重要な実装パターン

### ts-morphプロジェクトの作成
```typescript
// src/ts-morph/_utils/ts-morph-project.ts を使用
import { createTsMorphProject } from "../_utils/ts-morph-project";
const project = createTsMorphProject(tsconfigPath);
```

### MCPツールの登録
各ツールは以下のパターンで実装：
1. Zodスキーマでパラメータ定義
2. ツール実装関数（ts-morphレイヤーを呼び出し）
3. `server.setRequestHandler`で登録

### エラーハンドリング
- カスタムエラークラスを使用
- ロガーでエラー内容を記録
- MCPエラーレスポンスとして返却

## 開発時の注意事項

### 依存関係
- Node.js（Voltaで管理。バージョンは `package.json` の `volta.node` を参照。現在は 22.14.0）
- pnpm（`package.json` の `packageManager` で指定。現在は 11.1.2）

### Git Hooks（lefthook）
- pre-commit: Biomeでフォーマット自動実行
- pre-push: フォーマットチェックとテスト実行

### ロギング
環境変数で制御可能：
- `LOG_LEVEL`: ログレベル（debug, info, warn, error等）
- `LOG_OUTPUT`: 出力先（console, file）
- `LOG_FILE_PATH`: ファイル出力時のパス

### テスト実行の詳細
- 単一スレッドで実行（`--pool threads --poolOptions.threads.singleThread`）
- モックは各テスト後に自動リセット
- 環境変数`API_ADDRESS`がテスト時に設定される

## 主要な機能と実装ファイル

- **シンボル名変更**: `src/ts-morph/rename-symbol/`
- **ファイル/フォルダ名変更**: `src/ts-morph/rename-file-system/`
- **参照検索**: `src/ts-morph/find-references.ts`
- **パスエイリアス削除**: `src/ts-morph/remove-path-alias/`
- **シンボル移動**: `src/ts-morph/move-symbol-to-file/`
- **未使用 export 検出**: `src/ts-morph/find-unused-exports.ts`
- **関数シグネチャ変更**: `src/ts-morph/change-signature/`
- **型情報の取得**: `src/ts-morph/get-type-at-position/`

各機能の詳細な仕様はREADME.mdを参照。