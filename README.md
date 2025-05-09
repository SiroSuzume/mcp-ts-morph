# MCP ts-morph Refactoring Tools

## 概要

この MCP サーバーは、[ts-morph](https://ts-morph.com/) を利用して TypeScript および JavaScript のコードベースに対するリファクタリング操作を提供します。
Cursor などのエディタ拡張機能と連携し、シンボル名の変更、ファイル/フォルダ名の変更、参照箇所の検索などを AST (Abstract Syntax Tree) ベースで行うことができます。

## 提供される機能

この MCP サーバーは以下のリファクタリング機能を提供します。各機能は `ts-morph` を利用して AST を解析し、プロジェクト全体の整合性を保ちながら変更を行います。

### シンボル名の変更 (`rename_symbol_by_tsmorph`)

- **機能**: 指定されたファイル内の特定の位置にあるシンボル (関数、変数、クラス、インターフェースなど) の名前を、プロジェクト全体で一括変更します。
- **ユースケース**: 関数名や変数名を変更したいが、参照箇所が多く手作業での変更が困難な場合。
- **必要な情報**: プロジェクトの `tsconfig.json` パス、対象ファイルのパス、シンボルの位置 (行・列)、現在のシンボル名、新しいシンボル名

### ファイル/フォルダ名の変更 (`rename_filesystem_entry_by_tsmorph`)

- **機能**: 指定された**複数の**ファイルおよび/またはフォルダの名前を変更し、プロジェクト内のすべての `import`/`export` 文のパスを自動的に更新します。
- **ユースケース**: ファイル構成を変更し、それに伴って import パスを修正したい場合。複数のファイル/フォルダを一度にリネーム/移動したい場合。
- **必要な情報**: プロジェクトの `tsconfig.json` パス、リネーム操作の配列 (`renames: { oldPath: string, newPath: string }[]`)。
- **備考**:
    - 参照の解決には主にシンボル解析が用いられます。
    - パスエイリアス (`@/` など) を含む参照は更新されますが、**相対パスに変換**されます。
    - ディレクトリのインデックスファイルを参照するインポート (例: `../components`) は、**明示的なファイルパス (例: `../components/index.tsx`) に更新**されます。
    - リネーム操作前にパスの衝突チェック（既存パスや操作内での重複）も行います。
- **注意 (実行時間):** 多数のファイルやフォルダを一度に操作する場合や、非常に大きなプロジェクトでは、参照解析と更新に時間がかかる可能性があります。
- **注意 (既知の制限):** 現在、`export default Identifier;` 形式のデフォルトエクスポートの参照は正しく更新されない場合があります。

### 参照箇所の検索 (`find_references_by_tsmorph`)

- **機能**: 指定されたファイル内の特定の位置にあるシンボルの定義箇所と、プロジェクト全体でのすべての参照箇所を検索して一覧表示します。
- **ユースケース**: ある関数や変数がどこで使われているかを把握したい場合。リファクタリングの影響範囲を調査したい場合。
- **必要な情報**: プロジェクトの `tsconfig.json` パス、対象ファイルのパス、シンボルの位置 (行・列)。

### パスエイリアスの削除 (`remove_path_alias_by_tsmorph`)

- **機能**: 指定されたファイルまたはディレクトリ内の `import`/`export` 文に含まれるパスエイリアス (`@/components` など) を、相対パス (`../../components` など) に置換します。
- **ユースケース**: プロジェクトの移植性を高めたい場合や、特定のコーディング規約に合わせたい場合。
- **必要な情報**: プロジェクトの `tsconfig.json` パス、処理対象のファイルまたはディレクトリのパス。

### シンボルのファイル間移動 (`move_symbol_to_file_by_tsmorph`)

- **機能**: 指定されたシンボル（関数、変数、クラス、インターフェース、型エイリアス、Enum）を現在のファイルから指定された別のファイルに移動します。移動に伴い、プロジェクト全体の参照（インポート/エクスポートパスを含む）を自動的に更新します。
- **ユースケース**: コードの構成を変更するために、特定の機能を別のファイルに切り出したい場合。
- **必要な情報**: プロジェクトの `tsconfig.json` パス、移動元のファイルパス、移動先のファイルパス、移動するシンボルの名前。必要に応じてシンボルの種類 (`declarationKindString`) を指定すると、同名シンボルの曖昧性を解消できます。
- **備考**: シンボルの内部依存関係（そのシンボル内でのみ使用される他の宣言）も一緒に移動します。移動元ファイルに残る他のシンボルからも参照されている依存関係は移動元に残り、必要に応じて `export` が追加され、移動先ファイルでインポートされます。
- **注意**: デフォルトエクスポート (`export default`) されたシンボルはこのツールでは移動できません。

## 環境構築

### 利用者向け (npm パッケージとして利用する場合)

`mcp.json` に以下のように設定を追加します。`npx` コマンドを使用することで、インストール済みの最新バージョンが自動的に利用されます。

```json
{
  "mcpServers": {
    "mcp-tsmorph-refactor": { // 任意のサーバー名
      "command": "npx",
      "args": ["-y", "@sirosuzume/mcp-tsmorph-refactor"],
      "env": {} // 必要に応じてロギング設定などを追加
    }
  }
}
```

### 開発者向け (ローカルで開発・実行する場合)

ローカルでソースコードからサーバーを起動する場合は、まずビルドが必要です。

```bash
# 依存関係のインストール (初回のみ)
pnpm install

# TypeScript コードのビルド
pnpm run build
```

ビルド後、`mcp.json` で以下のように設定して `node` で直接実行できます。

```json
{
  "mcpServers": {
    "mcp-tsmorph-refactor-dev": { // 開発用など、別の名前を推奨
      "command": "node",
      // プロジェクトルートからの相対パスまたは絶対パス
      "args": ["/path/to/your/local/repo/dist/index.js"],
      "env": {
        // 開発時のデバッグログ設定など
        "LOG_LEVEL": "debug"
      }
    }
  }
}
```

### ロギング設定 (環境変数)

サーバーの動作ログは、以下の環境変数で出力レベルや出力先を制御できます。`mcp.json` の `env` ブロックで設定します。

-   `LOG_LEVEL`: ログの詳細度を設定します。
    -   利用可能なレベル: `fatal`, `error`, `warn`, `info` (デフォルト), `debug`, `trace`, `silent`
    -   例: `"LOG_LEVEL": "debug"`
-   `LOG_OUTPUT`: ログの出力先を指定します。
    -   `console` (デフォルト): 標準出力にログを出力します。開発環境 (`NODE_ENV !== 'production'`) で `pino-pretty` がインストールされている場合は、見やすい形式で出力されます。
    -   `file`: 指定されたファイルにログを出力します。MCP クライアントへの影響を避ける場合に設定します。
    -   例: `"LOG_OUTPUT": "file"`
-   `LOG_FILE_PATH`: `LOG_OUTPUT` が `file` の場合に、ログファイルの絶対パスを指定します。
    -   デフォルト: `[プロジェクトルート]/app.log`
    -   例: `"LOG_FILE_PATH": "/var/log/mcp-tsmorph.log"`

設定例 (`mcp.json` 内):

```json
// ... (mcp.json の他の設定)
      "env": {
        "LOG_LEVEL": "debug", // デバッグレベルのログを
        "LOG_OUTPUT": "file",  // ファイルに出力
        "LOG_FILE_PATH": "/Users/yourname/logs/mcp-tsmorph.log" // ログファイルのパス指定
      }
// ...
```

## 開発者向け情報

### 前提条件

- Node.js (バージョンは `.node-version` または `package.json` の `volta` フィールドを参照)
- pnpm (バージョンは `package.json` の `packageManager` フィールドを参照)

### セットアップ

リポジトリをクローンし、依存関係をインストールします。

```bash
git clone https://github.com/sirosuzume/mcp-tsmorph-refactor.git
cd mcp-tsmorph-refactor
pnpm install
```

### ビルド

TypeScript コードを JavaScript にコンパイルします。

```bash
pnpm build
```

ビルド成果物は `dist` ディレクトリに出力されます。

### テスト

ユニットテストを実行します。

```bash
pnpm test
```

### リンティングとフォーマット

コードの静的解析とフォーマットを行います。

```bash
# Lintチェック
pnpm lint

# Lint修正
pnpm lint:fix

# フォーマット
pnpm format
```

### デバッグ用ラッパーの使用

開発中に MCP サーバーの起動シーケンスや標準入出力、エラー出力を詳細に確認したい場合、プロジェクトの `scripts` ディレクトリに配置されている `mcp_launcher.js` を使用できます。

このラッパースクリプトは、本来の MCP サーバープロセス (`npx -y @sirosuzume/mcp-tsmorph-refactor`) を子プロセスとして起動し、その起動情報や出力をプロジェクトルートの `.logs/mcp_launcher.log` ファイルに記録します。

**使用方法:**

1.  `mcp.json` ファイルで、`mcp-tsmorph-refactor` サーバーの設定を以下のように変更します。
    *   `command` を `"node"` にします。
    *   `args` に、`scripts/mcp_launcher.js` へのパス (例: `["path/to/your_project_root/scripts/mcp_launcher.js"]`) を指定します。プロジェクトルートからの相対パス (`["scripts/mcp_launcher.js"]`) も使用できます。

    設定例 (`mcp.json`):
    ```json
    {
      "mcpServers": {
        "mcp-tsmorph-refactor": {
          "command": "node",
          // scripts/mcp_launcher.js へのパス (プロジェクトルートからの相対パス or 絶対パス)
          "args": ["path/to/your_project_root/scripts/mcp_launcher.js"],
          "env": {
            // 元の環境変数設定はそのまま活かせます
            // 例:
            // "LOG_LEVEL": "trace",
            // "LOG_OUTPUT": "file",
            // "LOG_FILE_PATH": ".logs/mcp-ts-morph.log"
          }
        }
        // ... 他のサーバー設定 ...
      }
    }
    ```

2.  MCP クライアント (例: Cursor) を再起動またはリロードします。

3.  プロジェクトルートの `.logs/mcp_launcher.log` にログが出力されるのを確認してください。
    また、MCP サーバー自体のログも、設定されていれば (例: `.logs/mcp-ts-morph.log`) 確認できます。

このラッパーを使用することで、MCP サーバーが期待通りに起動しない場合の原因究明に役立ちます。

## npm への公開

このパッケージは、GitHub Actions ワークフロー (`.github/workflows/release.yml`) を介して npm に自動的に公開されます。

### 前提条件

*   NPM トークン: 公開権限を持つ npm アクセストークンが、リポジトリの Actions secrets (`Settings` > `Secrets and variables` > `Actions`) に `NPM_TOKEN` という名前で設定されていることを確認してください。
*   バージョン更新: 公開前に、`package.json` の `version` フィールドをセマンティックバージョニング (SemVer) に従って更新してください。

### 公開方法

リリースワークフローをトリガーするには、Git タグのプッシュを使用します。

**方法: Git タグのプッシュ (リリース時に推奨)**

*   **想定される用途:** 通常のバージョンリリース（メジャー、マイナー、パッチ）。Git の履歴とバージョンが明確に対応するため、標準的なリリースプロセスとして推奨されます。

1.  バージョン更新: `package.json` の `version` を変更します (例: `0.3.0`)。
2.  コミット & プッシュ: `package.json` の変更をコミットし、main ブランチにプッシュします。
3.  タグ作成 & プッシュ: バージョンに一致する Git タグ (`v` プレフィックス付き) を作成し、プッシュします。
    ```bash
    git tag v0.3.0
    git push origin v0.3.0
    ```
4.  自動化: タグをプッシュすると `Release Package` ワークフローがトリガーされ、パッケージのビルド、テスト、npm への公開が行われます。
5.  確認: Actions タブでワークフローのステータスを確認し、npmjs.com でパッケージを確認します。

### 注意事項

*   バージョンの一貫性: タグプッシュでトリガーする場合、タグ名 (例: `v0.3.0`) は `package.json` の `version` (例: `0.3.0`) と**完全に一致する必要があります**。一致しない場合、ワークフローは失敗します。
*   事前チェック: CI ワークフローにはビルドとテストのステップが含まれていますが、潜在的な問題を早期に発見するために、バージョンを更新する前にローカルで `pnpm run build` と `pnpm run test` を実行することをお勧めします。

## ライセンス

このプロジェクトは MIT ライセンスの下で公開されています。詳細は [LICENSE](LICENSE) ファイルをご覧ください。