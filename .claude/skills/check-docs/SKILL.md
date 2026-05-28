---
name: check-docs
description: 登録済み MCP ツール（src/mcp/tools/register-*.ts）と、README.md のツール表・CLAUDE.md のモジュール一覧の整合をチェックする。ツール追加後やドキュメント整理時に、記載漏れ・ドリフトを検出する。「ドキュメントの整合を確認」「README とコードがずれていないか」「ツール一覧チェック」等で使用。
---

# ドキュメント整合チェック

過去に README のツール表（6→8 のずれ）と CLAUDE.md のモジュール一覧が実態とドリフトした。登録済みツールとドキュメントの記載を機械的に突き合わせ、欠落・余剰を報告する。

このスキルは**読み取り専用の点検**。修正提案は出すが、勝手にファイルを書き換えない（ユーザーが確認してから直す）。

## 手順

### 1. 登録済みツール名を抽出

```bash
grep -rhoE '"[a-z_]+_by_tsmorph"' src/mcp/tools/ | tr -d '"' | sort -u
```

これが「真実の source」。`ts-morph-tools.ts` の `registerTsMorphTools` 内で実際に呼ばれている登録関数とも突き合わせる（import だけして呼んでいない／呼んでいるが import 漏れ、を検出）：

```bash
grep -E 'register[A-Za-z]+Tool' src/mcp/tools/ts-morph-tools.ts
```

### 2. README のツール表と照合

`README.md` の「提供されるツール」表（`| [\`xxx_by_tsmorph\`]... |`）と各詳細セクション（`### \`xxx_by_tsmorph\``）を抽出：

```bash
grep -oE '`[a-z_]+_by_tsmorph`' README.md | tr -d '`' | sort -u
```

- 表に載っているがコードに無い → 余剰（削除候補）
- コードにあるが表に無い → **記載漏れ**（追記が必要）
- 表にあるがアンカー先の `### ` セクションが無い → リンク切れ

### 3. CLAUDE.md のモジュール一覧と照合

`src/ts-morph/` の実ディレクトリ・ファイルと、CLAUDE.md「ts-morphレイヤー」「主要な機能と実装ファイル」の記載を突き合わせる：

```bash
ls src/ts-morph/
```

- 実在するモジュールが CLAUDE.md に無い → 記載漏れ
- CLAUDE.md にあるが実在しない → 古い記載（要削除）

### 4. 報告フォーマット

```
## ドキュメント整合チェック結果

### 登録済みツール（N 件）
- ...

### README
- [OK] 表・詳細セクションともに一致
- [欠落] xxx_by_tsmorph が表に無い
- [リンク切れ] yyy のアンカー先セクションが無い

### CLAUDE.md
- [欠落] src/ts-morph/zzz/ がモジュール一覧に無い
- [古い記載] aaa が実在しない

### 修正提案
（差分の要点。ユーザー確認後に適用）
```

ずれが無ければ「整合済み」と明言する。
