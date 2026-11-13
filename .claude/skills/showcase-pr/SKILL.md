---
name: showcase-pr
description: MISTEMS に統合した機能ブランチを、mistems/mistems の develop 向けショーケース PR として出す。タイトルと短い一言だけの簡素な PR にし、画面が変わる機能ならスクリーンショットか GIF を添える。squash-prep で統合に入れたあと、または "/showcase-pr"、"ショーケース PR を出して"、"mistems に PR を出して"、"systems に PR" 等の発話で起動する。
---

# showcase-pr

統合に入れた機能を見せるための PR を、mistems/mistems に作る。レビューや経緯は riin の PR に残し、ショーケース PR には書かない (CLAUDE.md の「PR の使い分け」)。

## 書式

初期のショーケース PR (mistems/mistems #36、#44、#45) にならう。

- **タイトル**: 機能を言い表す日本語の短い文。`feat:` などの接頭辞や `[Merged]` は付けない
  - 例: 「リアクションビューアに読み仮名などを表示」「チャンネル一覧」
- **本文**: 次のどちらか、または両方だけを書く。見出し、確かめ方、検証の結果、既知の制限、設計書のパスは書かない
  - 画面が変わるなら、スクリーンショットか GIF を 1〜3 枚
  - 画面で伝わらないことだけを 1〜3 行 (何ができるようになるか、なぜ欲しいか)
- 本文の最後の行は `🤖 Generated with [Claude Code](https://claude.com/claude-code)` とする
- 他のリポジトリ (misskey-dev や MisskeyIO などのフォーク) の PR / Issue 番号や URL は書かない (CLAUDE.md の禁止事項 8)。riin のレビュー用 PR へのリンクも書かない
- draft にしない。マージもしない

## 手順

### 1. 前提を確かめる

- `git log origin/develop..riin/<branch> --oneline` に、他の MISTEMS 機能のコミットや `Version updated to:` が混ざっていないこと。混ざっていれば mistems-main から派生しているので、PR を作らず、先に `rebase-to-develop` か `develop-review-pr` で載せ直すよう報告する
- `riin/release/*` は、まとめて 1 本の PR にしてよい (互いにコンフリクトする機能を束ねたものなので、統合と同じ単位で見せる)
- `party/*` など riin に無いローカルのブランチは、同じ名前で riin に push してから head に指定する
- 他の開発者のフォーク (`kakkokari-gtyih` など) のブランチは、そのフォークを head に指定し、`--no-maintainer-edit` を付ける (付けないと権限のエラーで作れない)
- `gh pr list -R mistems/mistems --head <branch> --state open` で、同じ head の PR が無いこと。あれば作らず、番号を報告する

### 2. systems の develop をそろえる

差分に上流のコミットが混ざらないよう、PR を作る前にそろえる。

```bash
git fetch origin develop && git fetch systems develop
git rev-list --count origin/develop..systems/develop   # 0 であること。0 でなければ上書きせずに尋ねる
git push systems origin/develop:refs/heads/develop
```

### 3. 画面を撮る (画面が変わる機能のとき)

- riin のレビュー用 PR にスクリーンショットがあれば、その URL を流用する
- 無ければ、`orb-dev-server` スキルでブランチの環境を起動し、Playwright で撮る。統合済みの機能は、mistems-main の環境でまとめて撮れる。どちらも枠の URL (`http://devN.localhost:3080/`。`orb-dev.sh slots` で確かめる) で開き、`admin` / `admin1234` でログインする。シードに無いデータ (お知らせなど) は、ブラウザから管理 API で作ってから撮る。動きのある変更 (アニメーション、ドラッグ、画面遷移) は GIF にする
- 撮った画像は `--attach` で PR に添付する (手順 4)。リポジトリにコミットしたり、別のブランチに置いたりしない

### 4. PR を作る

head は riin のブランチを指す。mistems/mistems と fruitriin/misskey は同じフォークネットワークに入っているので、ブランチを systems へ push し直さなくてよい。

```bash
gh pr create -R mistems/mistems --base develop --head fruitriin:<branch> --title "<タイトル>" --body-file <本文> \
  --attach '<画像>#<代替テキスト>'
```

- `--attach` は gh 2.103 以降で使える。画像と動画を添付でき、1 回に 50 個まで添付できる
- 本文に `![<代替テキスト>](./<画像>)` と書いておくと、その参照がアップロード先の URL に書き換えられる。本文で参照しない添付は、本文の末尾に足される。`--body-file` の中のパスは、そのファイルのあるディレクトリからの相対パスになる
- 一部の添付が失敗しても PR は作られ、終了コードが 0 以外になる。そのときは `gh pr edit <番号> -R mistems/mistems --attach ...` で足す

### 5. 報告

PR の URL を報告する。画面を撮らなかったときは、その理由 (画面が変わらない、など) を書く。

## 統合から外したとき

コメントアウトや「栄誉の殿堂」への移動で統合から外したブランチのショーケース PR は、閉じるかどうかをユーザーに尋ねる。指示なしに閉じない。

## スキル修正時の反映

このスキルの本籍は claudeImplement worktree (`misskey-worktrees/claudeImplement`、ブランチ `add-claude-github-actions-1762310148415`) である。修正したらそこでコミットし、riin へ push する。

## 経験の記録

- 2026-11-12: 統合中のブランチ全部 (44 本) のショーケース PR を作り直した (mistems/mistems #62〜#105)。それまでの旧形式の PR (#33〜#60) は閉じた
  - 画面が変わる機能でも、手元で再現しにくいもの (複数アカウントが要るログアウト、外部サービスの埋め込み、空のホームタイムライン、ドラッグの動き) は一言だけにした
  - zsh では `$b:r` のような変数の後ろの `:` が修飾子として解釈され、`read -a` も使えない。ループは `${b}` と書くか、bash で実行する

- 2026-11-11: `feat/image-menu-copy-link-emoji-preview` で初めて実行した (mistems/mistems #62)。`--attach` の画像は `user-attachments` の URL に書き換えられ、差分は機能のコミットだけになった
  - 開発モードの環境 (`pnpm dev`) は `*.localhost:3080` から開くと初期化に失敗した。2026-11-12 に orb-dev-server が枠 (`devN.localhost:3080`) で開く形になり、開発モードでも開けるようになった
  - Playwright MCP が別のセッションで使用中のときは、アプリ内蔵のブラウザで撮った。`zoom` で切り抜いた画像は PNG で tool-results に保存されるので、それを添付した
