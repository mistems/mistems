---
name: mistems-readme
description: mistems-readme ブランチの README.md と main-統合.sh を最新状態に更新する。mistems-main worktree の main-統合.sh を mistems-readme worktree にコピーし、README.md の変更点リスト・埋め込みスクリプトを現在の統合スクリプトの内容に合わせて更新し、commit & push する。"/mistems-readme"、"READMEを更新"、"mistems-readme更新" 等の発話で起動する。
---

# mistems-readme

mistems-readme ブランチの README.md と `main-統合.sh` を最新の MISTEMS の状態に同期するスキル。

## 前提

- worktree パス: `/Users/riin/workspace/misskey-worktrees/misskey/worktrees/mistems-readme`
  - ブランチ `mistems-readme` がチェックアウトされている
  - `README.md` と `main-統合.sh` の 2 ファイルだけが存在する
- ソース: `/Users/riin/workspace/misskey-worktrees/mistems-main/main-統合.sh` (mistems-main worktree の最新版)

## 処理フロー

### 1. main-統合.sh のコピー

mistems-main worktree の `main-統合.sh` を mistems-readme worktree にそのままコピーする。

```bash
cp /Users/riin/workspace/misskey-worktrees/mistems-main/main-統合.sh \
   /Users/riin/workspace/misskey-worktrees/misskey/worktrees/mistems-readme/main-統合.sh
```

### 2. README.md の更新

README.md の以下のセクションを最新の `main-統合.sh` の内容に基づいて更新する。

#### 変更点リスト (`## 変更点` セクション)

`main-統合.sh` 内の有効な `squash_merge` + `git commit` エントリからリストを生成する。コメントアウトされたエントリは含めない。

リストの構成:
- 各コミットメッセージから機能の概要を読み取り、カテゴリごとにグルーピングする
- カテゴリ例: セキュリティ / 投稿フォーム / チャンネル / ノート周辺 / リアクションピッカー / 検索 / UI・UX / バグ修正 / 開発・運用
- 新しく追加されたエントリは見落とさずにリストに反映する
- 既存の説明文が適切であればそのまま使う。コミットメッセージだけでは内容が不明な場合、ブランチの変更内容を確認して説明を補足する

#### 埋め込みスクリプト (`# 開発者向けドキュメント` > `## MISTEMSの作り方` セクション)

README.md 内のコードブロックに埋め込まれているスクリプト例を、最新の `main-統合.sh` の内容で置き換える。ただしバージョン番号セクション (`set MISVER` 以降) は含める。

### 3. commit & push

mistems-readme worktree 内で:

```bash
cd /Users/riin/workspace/misskey-worktrees/misskey/worktrees/mistems-readme
git add -A
git commit -m "README.md と main-統合.sh を最新に更新"
git push riin mistems-readme
```

## 注意

- README.md の構造（ヘッダー、管理用ブランチの説明、ブランチの取り込み方の説明など）は維持する。更新するのは「変更点リスト」と「埋め込みスクリプト」のみ
- push 前にユーザーに diff を見せて確認を取る

## 経験の記録
（実行時に任意で追記）
