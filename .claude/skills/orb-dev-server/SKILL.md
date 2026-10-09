---
name: orb-dev-server
description: Use whenever starting, stopping, or checking a Misskey dev server (`pnpm dev`) for a worktree on this machine — runs pnpm dev, PostgreSQL and Redis inside OrbStack containers per worktree so ports 3000 / 5173 / 5432 / 6379 never collide with other worktrees or projects. Prefer this over running `pnpm dev` on the host. "開発サーバー起動して"、"dev サーバー"、"動作確認したい"、"pnpm dev"、"検証環境を止めて" 等の発話で起動する。
---

# orb-dev-server

worktree ごとに独立した Misskey 開発サーバーを OrbStack 上で立てる。
ホストにポートを公開せず、`http://web.<project>.orb.local:3000/` でアクセスする。

## コマンド

```bash
.claude/skills/orb-dev-server/scripts/orb-dev.sh up     [worktree]   # 起動して URL を表示 (初回は管理者も作成)
.claude/skills/orb-dev-server/scripts/orb-dev.sh status [worktree]
.claude/skills/orb-dev-server/scripts/orb-dev.sh logs   [worktree]   # web のログを追う
.claude/skills/orb-dev-server/scripts/orb-dev.sh down   [worktree] [-v]  # -v で DB・node_modules の volume も消す
```

- `worktree` を省略するとカレントディレクトリの worktree を対象にする
- スクリプトはこのブランチ (skill の本籍) にしか無いことがある。対象 worktree に無ければ、mistems-main か claudeImplement worktree のものをフルパスで呼ぶ
- 初回の `up` は依存のインストールで数分かかる。`run_in_background` で実行して完了通知を待つとよい
- 管理者アカウントは `admin` / `admin1234`。ユーザーが 1 人もいないときだけ作る
- 動作確認は Playwright MCP で上記 URL を開く

## 仕組み

- compose プロジェクト名は worktree のディレクトリ名を小文字化したもの。生成物は `~/.cache/misskey-orb-dev/<project>/` に置き、worktree には何も書かない
- `web` は `.node-version` の Node 公式イメージで `pnpm install → pnpm migrate → pnpm dev` を実行する。worktree はマウントするので、ファイル保存はそのまま HMR で反映される
- `.config/default.yml` は `.config/example.yml` から生成し (URL・DB / Redis の接続先・setupPassword を差し替え)、コンテナ内の同じパスに重ねてマウントする。ホストの `.config/default.yml` は変更しない

## ハマりどころ

- **ホストで `pnpm dev` を動かさない理由**: vite のポート (5173 / 5174) は環境変数で変えられない。backend は `VITE_PORT` を読んでプロキシするが vite 側は読まないので、他の vite が 5173 にいると別プロジェクトへプロキシしてしまう
- **node_modules はホストと分ける**: ホストの node_modules は macOS 向けのネイティブモジュール (sharp, re2 など) を含み、Linux コンテナでは動かない。ルートと `packages/*/node_modules` を名前付き volume にしている
- **Node 25 以降は corepack が無い**: 公式イメージに同梱されなくなったので、`package.json` の `packageManager` のバージョンを `npm i -g` で入れている
- **vite は `.config/default.yml` を固定パスで読む**: `allowedHosts` を URL のホスト名から作るので、URL を orb.local のものにしないと vite が接続を拒否する

# 経験の記録
（実施したときの注意点などを自由に記載）

- 2026-10-10: emojiDropUpload worktree で作成・動作確認。依存インストール込みで初回の起動は 1〜2 分だった
