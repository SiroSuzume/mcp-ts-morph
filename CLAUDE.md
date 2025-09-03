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
```

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
     - `rename-file-system/`: ファイル/フォルダのリネーム
     - `remove-path-alias/`: パスエイリアスの削除
     - `find-references.ts`: 参照検索
     - `move-symbol-to-file/`: シンボルのファイル間移動
     - `rename-symbol/`: シンボル名の変更
   - `_utils/`: 共通ユーティリティ
     - `ts-morph-project.ts`: プロジェクト作成の共通処理

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
- Node.js v20.19.0（Voltaで管理）
- pnpm v10.10.0（packageManagerで指定）

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

各機能の詳細な仕様はREADME.mdを参照。