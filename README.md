# MCP ts-morph Refactoring Tools

[ts-morph](https://ts-morph.com/) を利用して、TypeScript / JavaScript コードベースに対する AST ベースのリファクタリング操作を提供する MCP サーバーです。シンボル名の変更、ファイル/フォルダ名の変更、参照検索などを、プロジェクト全体の整合性を保ちながら行えます。

## 目次

- [クイックスタート](#クイックスタート)
- [提供されるツール](#提供されるツール)
- [ロギング設定](#ロギング設定)
- [開発](#開発)
- [リリース](#リリース)
- [ライセンス](#ライセンス)

## クイックスタート

MCP クライアントの設定ファイル（`mcp.json` 等）に以下を追加します。`npx` を使うことで、公開済みの最新バージョンが自動的に利用されます。

```json
{
  "mcpServers": {
    "mcp-tsmorph-refactor": {
      "command": "npx",
      "args": ["-y", "@sirosuzume/mcp-tsmorph-refactor"],
      "env": {}
    }
  }
}
```

ロギングをカスタマイズする場合は [ロギング設定](#ロギング設定) を参照してください。ローカルのソースから起動する場合は [開発](#開発) を参照してください。

## 提供されるツール

各ツールは `ts-morph` で AST を解析し、プロジェクト全体の参照を保ちながら変更を行います。すべてのツールはプロジェクトの `tsconfig.json` パスを必要とします。

| ツール | 概要 |
| --- | --- |
| [`rename_symbol_by_tsmorph`](#rename_symbol_by_tsmorph) | シンボル名をプロジェクト全体で一括変更 |
| [`rename_filesystem_entry_by_tsmorph`](#rename_filesystem_entry_by_tsmorph) | ファイル/フォルダ名を変更し import パスを更新 |
| [`find_references_by_tsmorph`](#find_references_by_tsmorph) | シンボルの定義・参照箇所を一覧表示 |
| [`remove_path_alias_by_tsmorph`](#remove_path_alias_by_tsmorph) | パスエイリアスを相対パスに置換 |
| [`move_symbol_to_file_by_tsmorph`](#move_symbol_to_file_by_tsmorph) | シンボルを別ファイルに移動し参照を更新 |
| [`change_signature_by_tsmorph`](#change_signature_by_tsmorph) | 関数の引数を追加/削除/並べ替え、全呼び出し箇所を更新 |
| [`get_type_at_position_by_tsmorph`](#get_type_at_position_by_tsmorph) | 指定位置の推論された型情報を取得 |
| [`find_unused_exports_by_tsmorph`](#find_unused_exports_by_tsmorph) | 未使用 export 候補を列挙 |

### `rename_symbol_by_tsmorph`

指定ファイル内の特定位置にあるシンボル（関数・変数・クラス・インターフェースなど）の名前を、プロジェクト全体で一括変更します。

- **ユースケース**: 参照箇所が多く手作業での変更が困難な場合。
- **必要な情報**: 対象ファイルのパス、シンボルの位置（行・列）、現在のシンボル名、新しいシンボル名。

### `rename_filesystem_entry_by_tsmorph`

複数のファイルおよび/またはフォルダの名前を変更し、プロジェクト内のすべての `import` / `export` 文のパスを自動的に更新します。

- **ユースケース**: ファイル構成の変更に伴う import パスの修正。複数のファイル/フォルダを一度にリネーム/移動したい場合。
- **必要な情報**: リネーム操作の配列 `renames: { oldPath: string, newPath: string }[]`。
- **挙動**:
  - 参照解決には主にシンボル解析を用います。
  - パスエイリアス（`@/` など）を含む参照は更新されますが、**相対パスに変換**されます。
  - ディレクトリのインデックスを参照するインポート（例: `../components`）は、**明示的なファイルパス**（例: `../components/index.tsx`）に更新されます。
  - 操作前にパスの衝突（既存パス・操作内の重複）をチェックします。
- **注意**: 多数のファイル/フォルダや非常に大きなプロジェクトでは、解析と更新に時間がかかる場合があります。`export default Identifier;` 形式のデフォルトエクスポートの参照は正しく更新されない場合があります（既知の制限）。

### `find_references_by_tsmorph`

指定ファイル内の特定位置にあるシンボルの定義箇所と、プロジェクト全体でのすべての参照箇所を検索して一覧表示します。

- **ユースケース**: ある関数や変数の使用箇所の把握。リファクタリングの影響範囲の調査。
- **必要な情報**: 対象ファイルのパス、シンボルの位置（行・列）。

### `remove_path_alias_by_tsmorph`

指定したファイルまたはディレクトリ内の `import` / `export` 文に含まれるパスエイリアス（`@/components` など）を、相対パス（`../../components` など）に置換します。

- **ユースケース**: プロジェクトの移植性を高めたい、特定のコーディング規約に合わせたい場合。
- **必要な情報**: 処理対象のファイルまたはディレクトリのパス。

### `move_symbol_to_file_by_tsmorph`

指定したシンボル（関数・変数・クラス・インターフェース・型エイリアス・Enum）を別ファイルに移動し、プロジェクト全体の参照（import/export パスを含む）を自動的に更新します。

- **ユースケース**: 特定の機能を別ファイルに切り出してコード構成を変更したい場合。
- **必要な情報**: 移動元・移動先のファイルパス、移動するシンボルの名前。同名シンボルがある場合は種類（`declarationKindString`）を指定して曖昧性を解消できます。
- **挙動**: そのシンボル内でのみ使用される内部依存も一緒に移動します。移動元の他シンボルからも参照される依存は移動元に残り、必要に応じて `export` が追加されて移動先でインポートされます。
- **注意**: デフォルトエクスポート（`export default`）されたシンボルは移動できません。

### `change_signature_by_tsmorph`

関数・メソッド・アロー関数の引数を追加・削除・並べ替えし、プロジェクト内のすべての呼び出し箇所の引数を合わせて更新します。

- **ユースケース**: 呼び出し元が多い関数に必須引数を追加したい、import / 再エクスポート / メソッドチェーン経由で参照される関数の引数を削除・並べ替えたい場合。LLM の単発編集では取りこぼしが起きやすい更新を、型チェッカー経由で確実に反映します。
- **必要な情報**: 対象ファイルのパス、関数名識別子の位置（行・列）、関数名、適用する操作の配列 `operations`。
- **操作（`operations`）**:
  - `add`: `index`（省略時は末尾）に引数を挿入。`argumentForCallers` を指定すると各呼び出し箇所の同じ位置にそのテキストを挿入。省略時は呼び出し側を変更しない（末尾の optional / デフォルト引数専用）。
  - `remove`: `index` の引数を削除。その数以上の引数を渡している呼び出しから対応分を削除。
  - `reorder`: `newOrder` に従って引数リストと各呼び出しを再構築。引数の数が一致しない呼び出しがあると失敗します。
  - 操作は順に適用され、後続の操作は先行操作適用後の引数リストを参照します。
- **注意**: スプレッド引数（`fn(...args)`）を含む呼び出しは、引数を変更する操作で失敗します。呼び出し元が多い場合は `dryRun: true` で影響ファイルを先に確認してください。引数のリネームは `rename_symbol_by_tsmorph`、関数の移動は `move_symbol_to_file_by_tsmorph` を使ってください。

### `get_type_at_position_by_tsmorph`

TypeScript / JavaScript ファイルの指定位置における、TypeChecker が推論した型・シンボル・宣言箇所を返します。

- **ユースケース**: `tsc` を起動せずに「この変数 / 式 / 関数の実際の推論型は何か」を素早く確認したい場合。宣言ファイルを `Read` するより安価に型シグネチャを得たいとき。リファクタリング前に値の実際の形状を確認したいとき。
- **必要な情報**: 対象ファイルのパス、検査する位置（行・列）。
- **注意**: 空白やコメント行を指す場合はファイルレベルの推論型（例: `typeof import("...")`）が返り、通常は意図した結果ではありません。レスポンスの `nodeKind` を確認して識別子に再ターゲットしてください。多数の位置を一括で解析したい場合は `tsc` を直接使ってください。

### `find_unused_exports_by_tsmorph`

プロジェクト全体を走査し、宣言ファイルの外から参照されていない `export` を候補として列挙します。

- **検出対象**: インライン `export`（`export function/class/const/let/var/enum/interface/type`）、`export default`（識別子・関数・クラス）、`export = <Identifier>`。
- **判定方法**: `findReferencesAsNodes()` の結果から、同一ファイル内の参照・`ExportDeclaration` 配下の参照（`export { x } from "./y"` 等の純粋な再エクスポート）・`node_modules` 内の参照を除外し、残り 0 件なら未使用候補とします。
- **ユースケース**: デッドコード掃除、モジュールの公開面の棚卸し。**削除前には必ず `find_references_by_tsmorph` でダブルチェックしてください。**
- **`sameFileRefs`（削除 vs unexport の判断）**: 各候補に、同一ファイル内での参照数（宣言自身と再エクスポートサイトは除外）を添えます。報告される候補は定義上「宣言ファイルの**外**では未参照」なので、削除アクションはこの値で決まります。
  - `sameFileRefs=0`: 同一ファイル内でも未使用 → **真のデッド。宣言ごと削除して安全**（`textHits=0` も併せるとより確実）。
  - `sameFileRefs=1+`: 同一ファイル内では使用中 → **`export` キーワードだけ不要**。宣言は残すこと（消すと同一ファイル内参照が壊れる）。報告された宣言を一律削除するとビルドが壊れます。
- **`textOccurrences`（textHits）**: 宣言ファイル**以外**のソース内で `\b<name>\b` が出現する回数。`0` は「他ファイルに名前が無い」だけで、同一ファイル内使用の有無は別途 `sameFileRefs` を見ること（このフィールド単独では「削除して安全」を判断できない）。`1+` なら文字列リテラル / JSX / 動的参照の可能性があるため `find_references_by_tsmorph` で要確認。
- **default export の偽陽性**: `[default]` タグの付く候補（`export default <Identifier>` / `export = <Identifier>`）は、`findReferencesAsNodes` が `import Foo from "./mod"` の default import と結びつかず偽陽性になりやすい。`textHits` が 0 より十分大きい default export はほぼ使用中。低信頼として必ず `find_references_by_tsmorph` で確認してください。
- **`responseFormat`**: `"list"`（デフォルト、1 候補 1 行）/ `"summary"`（プロジェクト全体の集計＝総数・削除安全性の内訳・kind 別・ディレクトリ別）。大規模リポでは全件列挙が応答サイズ上限を超えやすいので、まず `"summary"` でデッドコードの偏りを把握し、`entryPoints` / `excludeFilePatterns` で絞ってから `"list"` で正確な位置を取得する運用が安全（`summary` は `maxResults` に関わらず全体をスキャン）。
- **オプション**: `entryPoints`（絶対パス配列。公開 API として常に使用扱い）、`excludeFilePatterns`（部分一致でスキャン対象外に）、`maxResults`（list モードの上限。デフォルト 100）、`expandNamespaceImports`（デフォルト ON）。
- **既知の限界**: 動的 `require` / `import()`、ファイルシステム規約に依存するルーティング（Next.js の `page.tsx` 等）、文字列リフレクション越しの参照は検出できません。`entryPoints` / `excludeFilePatterns` で候補を絞り込んでください。

## ロギング設定

サーバーの動作ログは環境変数で制御します。`mcp.json` の `env` ブロックで設定します。

| 環境変数 | 説明 | デフォルト |
| --- | --- | --- |
| `LOG_LEVEL` | ログの詳細度。`fatal` / `error` / `warn` / `info` / `debug` / `trace` / `silent` | `info` |
| `LOG_OUTPUT` | 出力先。`console` または `file` | `console` |
| `LOG_FILE_PATH` | `LOG_OUTPUT=file` 時のログファイルの絶対パス | `[プロジェクトルート]/app.log` |

`LOG_OUTPUT=console` かつ開発環境（`NODE_ENV !== 'production'`）で `pino-pretty` がインストールされている場合は、見やすい形式で出力されます。MCP クライアントへの標準出力の影響を避けたい場合は `file` を指定してください。

設定例:

```json
{
  "mcpServers": {
    "mcp-tsmorph-refactor": {
      "command": "npx",
      "args": ["-y", "@sirosuzume/mcp-tsmorph-refactor"],
      "env": {
        "LOG_LEVEL": "debug",
        "LOG_OUTPUT": "file",
        "LOG_FILE_PATH": "/Users/yourname/logs/mcp-tsmorph.log"
      }
    }
  }
}
```

## 開発

### 前提条件

- Node.js（バージョンは `package.json` の `volta` フィールドを参照）
- pnpm（バージョンは `package.json` の `packageManager` フィールドを参照）

### セットアップとビルド

```bash
git clone https://github.com/sirosuzume/mcp-tsmorph-refactor.git
cd mcp-tsmorph-refactor
pnpm install
pnpm build      # dist/ に出力
```

### 主なコマンド

```bash
pnpm test       # テスト実行
pnpm test:watch # ウォッチモードでテスト
pnpm check-types # 型チェック（コンパイルなし）
pnpm lint       # Lint チェック
pnpm lint:fix   # Lint 修正
pnpm format     # フォーマット
pnpm inspector  # MCP Inspector でデバッグ
```

### ローカルビルドを MCP クライアントから使う

ビルド後、`node` で `dist/index.js` を直接起動できます。

```json
{
  "mcpServers": {
    "mcp-tsmorph-refactor-dev": {
      "command": "node",
      "args": ["/path/to/your/local/repo/dist/index.js"],
      "env": {
        "LOG_LEVEL": "debug"
      }
    }
  }
}
```

### デバッグ用ランチャー

サーバーの起動シーケンスや標準入出力を詳細に確認したい場合は、`scripts/mcp_launcher.js` を使います。本来のサーバープロセスを子プロセスとして起動し、起動情報や出力を `.logs/mcp_launcher.log` に記録します。

`mcp.json` の `command` を `"node"`、`args` を `scripts/mcp_launcher.js` へのパスに変更してクライアントを再起動すると、`.logs/mcp_launcher.log`（およびサーバー自身のログ）が確認できます。

```json
{
  "mcpServers": {
    "mcp-tsmorph-refactor": {
      "command": "node",
      "args": ["scripts/mcp_launcher.js"],
      "env": {
        "LOG_OUTPUT": "file",
        "LOG_FILE_PATH": ".logs/mcp-ts-morph.log"
      }
    }
  }
}
```

## リリース

このパッケージは GitHub Actions ワークフロー（`.github/workflows/release.yml`）を介して npm に自動公開されます。

**Git タグがバージョンの単一の真実の source です。** `package.json` の `version` と `src/version.ts` の `VERSION` はどちらも `0.0.0-development` に固定されており、リリースワークフローが tag から値を取り出して焼き込みます。**手動で bump する必要はありません。**

### 公開手順

```bash
git checkout main && git pull --ff-only
git tag v1.2.0
git push origin v1.2.0
```

タグ push でワークフローがトリガーされ、以下を順に実行します。

1. tag（`v1.2.0`）から VERSION（`1.2.0`）を抽出（strict SemVer のみ。プレリリース未サポート）
2. placeholder バージョンのまま `pnpm test`
3. `node scripts/release-version.mjs --bake 1.2.0` で `src/version.ts` と `package.json` の `version` を書き換え
4. `pnpm build`
5. `dist/version.js` に `exports.VERSION = "1.2.0";` が含まれることを `grep -F` で確認
6. `_version_note` を package.json から除去
7. `pnpm publish --provenance` で npm へ公開（Trusted Publishing / OIDC）

完了後、`npm view @sirosuzume/mcp-tsmorph-refactor version` で反映を確認してください。

> npm Trusted Publishing が前提です。`NPM_TOKEN` は廃止済みで、GitHub Actions の OIDC を介して publish されます（`release.yml` の `id-token: write` 参照）。

### なぜ tag を真実の source にしているか

旧運用では「`package.json` の version を bump」「`src/mcp/config.ts` の `serverInfo.version` を bump」「タグを打つ」の 3 手順のいずれかを忘れると不整合がリリースされていました（実際にズレた履歴あり）。新運用では開発中はずっと `0.0.0-development` のままで、リリース時に CI が tag を見て全箇所を更新するため、**bump 忘れが構造的に発生しません**。

CI（`.github/workflows/ci.yml`）は PR / main push のたびに `node scripts/release-version.mjs --check` を実行し、両ファイルが placeholder のままであることを確認します。手で bump した PR はここで失敗します。

### 失敗時の復旧

- ワークフロー途中で失敗した場合は **tag を削除せず**、main に修正をマージしてから次のパッチタグ（`vX.Y.(Z+1)`）を打ってください（fix-forward）。
- 同じタグでの再 publish は npm の immutability により不可能なため、tag の上書きは無意味です。

## ライセンス

このプロジェクトは MIT ライセンスの下で公開されています。詳細は [LICENSE](LICENSE) ファイルをご覧ください。
