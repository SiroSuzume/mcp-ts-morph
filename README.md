# MCP ts-morph Refactoring Tools

## 概要

この MCP サーバーは、[ts-morph](https://ts-morph.com/) を利用して TypeScript および JavaScript のコードベースに対するリファクタリング操作を提供します。
Cursor などのエディタ拡張機能と連携し、シンボル名の変更、ファイル/フォルダ名の変更、参照箇所の検索などを AST (Abstract Syntax Tree) ベースで行うことができます。

<a href="https://glama.ai/mcp/servers/@SiroSuzume/mcp-ts-morph">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@SiroSuzume/mcp-ts-morph/badge" alt="ts-morph Refactoring Tools MCP server" />
</a>

## 環境構築

`mcp.json` に以下のように設定を追加します。

```json
{
  "mcpServers": {
    "mcp-tsmorph-refactor": {
      // 任意のサーバー名
      "command": "node",
      // TODO: ビルド後のエントリポイントへのパスを指定してください
      "args": ["/path/to/this/repo/dist/index.js"],
      "env": {}
    }
  }
}
```

## 提供される機能

この MCP サーバーは以下のリファクタリング機能を提供します。各機能は `ts-morph` を利用して AST を解析し、プロジェクト全体の整合性を保ちながら変更を行います。

### シンボル名の変更 (`rename_symbol_by_tsmorph`)

- **機能**: 指定されたファイル内の特定の位置にあるシンボル (関数、変数、クラス、インターフェースなど) の名前を、プロジェクト全体で一括変更します。
- **ユースケース**: 関数名や変数名を変更したいが、参照箇所が多く手作業での変更が困難な場合。
- **必要な情報**: プロジェクトの `tsconfig.json` パス、対象ファイルのパス、シンボルの位置 (行・列)、現在のシンボル名、新しいシンボル名、シンボルの種類。

### ファイル/フォルダ名の変更 (`rename_filesystem_entry_by_tsmorph`)

- **機能**: 指定されたファイルまたはフォルダの名前を変更し、プロジェクト内のすべての `import`/`export` 文のパスを自動的に更新します。
- **ユースケース**: ファイル構成を変更し、それに伴って import パスを修正したい場合。
- **必要な情報**: プロジェクトの `tsconfig.json` パス、変更前のパス、変更後のパス。
- **注意**: パスエイリアスや相対的なインデックスインポートの更新は不完全な場合があります。変更後に手動確認が必要な場合があります。`"."` や `".."` 、`@/*`等のパスで import している場合、更新されないことがあります。

### 参照箇所の検索 (`find_references_by_tsmorph`)

- **機能**: 指定されたファイル内の特定の位置にあるシンボルの定義箇所と、プロジェクト全体でのすべての参照箇所を検索して一覧表示します。
- **ユースケース**: ある関数や変数がどこで使われているかを把握したい場合。リファクタリングの影響範囲を調査したい場合。
- **必要な情報**: プロジェクトの `tsconfig.json` パス、対象ファイルのパス、シンボルの位置 (行・列)。

### パスエイリアスの削除 (`remove_path_alias_by_tsmorph`)

- **機能**: 指定されたファイルまたはディレクトリ内の `import`/`export` 文に含まれるパスエイリアス (`@/components` など) を、相対パス (`../../components` など) に置換します。
- **ユースケース**: プロジェクトの移植性を高めたい場合や、特定のコーディング規約に合わせたい場合。
- **必要な情報**: プロジェクトの `tsconfig.json` パス、処理対象のファイルまたはディレクトリのパス。

(その他の機能があれば追記)

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

## ライセンス

このプロジェクトは MIT ライセンスの下で公開されています。詳細は [LICENSE](LICENSE) ファイルをご覧ください。