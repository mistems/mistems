---
name: rebase-to-develop
description: ブランチを最新の origin/develop からの派生に作り直す。mistems-main ベースのブランチ（他機能が混入）を develop 派生に切り出す場合と、古い develop ベースのブランチを最新 develop にリベースする場合の両方に対応する。"/rebase-to-develop"、"develop に乗せ直す"、"develop 派生に"、"rebase して"、"ブランチを最新にしたい" 等の発話で起動する。
---

# rebase-to-develop

ブランチを最新の `origin/develop` からのクリーンな派生に作り直すスキル。本家 misskey へ PR を出せる状態にすることが目的。

## 入力

```
/rebase-to-develop riin/claude/awesome-volta-vljoz9
/rebase-to-develop riin/fix/some-old-branch
```

ブランチ名を引数で指定する。worktree が存在すればそこで作業し、なければ一時 worktree を作成する。

## ケース判定

`git fetch origin` で最新を取得した後、ブランチの状態を自動判定する。

```bash
git merge-base <branch> origin/develop
git merge-base <branch> mistems-main
git log origin/develop..<branch> --oneline
```

| ケース | 判定条件 | 操作 |
|--------|----------|------|
| A. mistems-main ベース | mistems-main との merge-base が develop との merge-base より新しい、または固有コミットに他の MISTEMS 機能のコミットメッセージが混在 | stash 方式 |
| B. 古い develop ベース | develop から派生しているが merge-base が古い | rebase 方式 |
| B'. B でコンフリクト頻発 | rebase 中に 2 回以上コンフリクトが発生 | 圧縮して再 rebase |

判定に自信がない場合はユーザーに確認する。

## ケース A: stash 方式（mistems-main ベース → develop 派生）

mistems-main 上に積まれたブランチから固有の変更だけを取り出して develop に載せる。

### 手順

1. **操作前のコミットハッシュを記録** — 復元用に報告する
2. **stash → reset → pop**
   ```bash
   git stash
   git reset --hard origin/develop
   git stash pop
   ```
3. **結果判定**
   - コンフリクトなし → diff を見せてユーザーに確認 → 承認後 force push
   - コンフリクトあり → コンフリクト分析へ（後述）

### stash の健全性チェック

stash pop 後の変更ファイル数が異常に多い場合（他ブランチの変更が混入している可能性）、ユーザーに警告してから続行する。目安として、元のブランチの固有コミットで変更されたファイル数と stash pop 後のファイル数を比較する。

## ケース B: rebase 方式（古い develop ベース → 最新 develop）

develop から派生しているが、ベースが古いブランチを最新 develop にリベースする。

### 手順

1. **操作前のコミットハッシュを記録**
2. **固有コミット数を確認**
   ```bash
   git log origin/develop..<branch> --oneline | wc -l
   ```
3. **rebase 実行**
   ```bash
   git rebase origin/develop
   ```
4. **結果判定**
   - 成功 → diff を見せてユーザーに確認 → 承認後 force push
   - コンフリクト 1 回 → 通常のコンフリクト解決フローへ
   - コンフリクト 2 回以上 → ケース B' へ遷移

## ケース B': 圧縮して再 rebase

複数コミットがあるブランチで rebase 中にコンフリクトが繰り返し発生する場合、コミットを 1 つに圧縮してから再 rebase する。コンフリクト解決が 1 回で済むようになる。

### 手順

1. **rebase を中止**
   ```bash
   git rebase --abort
   ```
2. **コミットを 1 つに圧縮**
   ```bash
   git reset --soft $(git merge-base HEAD origin/develop)
   git commit -m "<元のコミットメッセージを要約>"
   ```
3. **再 rebase**
   ```bash
   git rebase origin/develop
   ```
4. **結果判定**
   - 成功 → diff を見せてユーザーに確認 → 承認後 force push
   - コンフリクトあり → 今度は 1 回だけなので通常のコンフリクト解決フローへ

## コンフリクト分析

コンフリクトが発生した場合、以下の情報を報告する:

1. **コンフリクトしたファイル一覧**
2. **原因の推定** — `main-統合.sh` の squash_merge エントリを参照し、コンフリクトしたファイルを変更している他のブランチを特定する
   ```bash
   # 各 squash_merge ブランチについて
   git diff origin/develop..<other-branch> --name-only | grep <conflicted-file>
   ```
3. **選択肢の提示**
   - 手動でコンフリクトを解決して続行
   - コンフリクト元のブランチに統合する（基本概念が既存 MISTEMS の拡張である場合）
   - 中止して元のコミットハッシュに復元

## 特殊ケース

### 統合ブランチ (mistems-main) の作り直しで riin/release/* がコンフリクトした場合

mistems-main を最新 origin/develop から作り直す（main-統合.sh の実行・再実行に相当する）過程で `riin/release/*` ブランチの squash merge がコンフリクトしたら、その場しのぎで解決して終わりにせず **rebuild-release-branch スキル** を呼び出して release ブランチ自体を再構成する。

### 上流が大きく破壊的な変更を加えていた場合

rebase 対象ブランチが変更しているファイル・機能を、上流 (origin/develop) が削除・別実装への置き換えなどで大きく書き換えていた場合（例: MkImgPreviewDialog → MkLightbox 化）、その場でコンフリクトを解決し続けない。**そのブランチはスキップ（統合から除外）し、ユーザーとペアで統廃合の方針を決める**。

- main-統合.sh の該当エントリはコメントアウトし、理由と復帰条件をコメントで残す
- ローカルの rebase 途中成果は作り直しの素材として残してよい（push はしない）

## force push

force push は破壊的操作なので、実行前に必ず:
- 変更内容の diff を提示する
- 操作前のコミットハッシュを提示する（`git reset --hard <hash>` で復元可能）
- ユーザーの明示的な承認を得る

```bash
git push riin <branch> --force-with-lease
```

`--force-with-lease` を使い、他者の push を上書きしないようにする。

## 後処理

- 既存の PR がある場合は PR 番号とリンクを報告する
- 一時 worktree を使った場合は削除する
- mistems-readme メンテナンスの要否を判定する（下記）

### mistems-readme メンテナンスの要否

この作業の過程で `main-統合.sh` を変更したかを確認する。変更の典型例:

- ブランチ名の変更・作り直しに伴う squash_merge エントリの書き換え
- 統合から外したエントリのコメントアウト（「上流が大きく破壊的な変更を加えていた場合」）
- NOTE・コンフリクト解消方針コメントの追記

| main-統合.sh | 対応 |
|------|------|
| 変更あり | mistems-readme ブランチの README（変更点リスト・埋め込みスクリプト）が乖離するため、**mistems-readme スキル** を続けて実行するかユーザーに確認する |
| 変更なし | 何もしない（README は main-統合.sh にのみ追随する） |

続けて実行しない場合（複数ブランチをまとめて rebase している途中など）は、引き継ぎに「mistems-readme 未実行」と 1 行残す。

## スキル修正時の反映

このスキルを修正したら、**claudeImplement worktree** (`misskey/worktrees/claudeImplement`、ブランチ `add-claude-github-actions-1762310148415`) の同ファイルにも反映してコミットし、riin へ push する。mistems-main は統合のたびに origin/develop へ reset されるため、統合ブランチ側の `.claude/` 変更はコミットしても次回統合で消える（スキルの本籍はこのブランチで、main-統合.sh 経由で mistems-main に取り込まれる）。

## 経験の記録
（実行時に任意で追記）
