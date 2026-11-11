---
name: develop-review-pr
description: 機能ブランチを最新の origin/develop に載せ直して riin に push し、riin の develop を origin/develop にそろえたうえで、riin の中に develop 向けの人間レビュー用 PR を作る。mistems-main から派生した古いブランチも、固有の変更だけを develop に載せる。"/develop-review-pr"、"develop 向けの PR を作って"、"人間レビュー用の PR"、"riin/develop と PR"、"develop を pull して PR" 等の発話で起動する。
---

# develop-review-pr

機能ブランチを、人がレビューできる形の PR にするスキル。PR は riin (fruitriin/misskey) の中で `develop` ← `<機能ブランチ>` として作る。差分がそのブランチ固有の変更だけになるよう、ブランチを最新の `origin/develop` から作り直す。

## 守ること

- origin (misskey-dev) へは push も PR も作らない。コミットメッセージや PR の本文に misskey-dev の PR / Issue 番号を書かない
- riin の自分のブランチへの force push は許可不要。ただし `--force-with-lease=<branch>:<push 前の SHA>` を使い、push 前にバックアップの ref を作る
- 既存の PR は、ユーザーの指示なしに閉じたり base を変えたりしない
- 他の開発環境や variant のコンテナを止めない。OrbStack の環境は、自分で作ったものだけを片付ける
- `packages/backend` / `packages/frontend` を触る前に `working-on-backend` / `working-on-frontend` を読む。コミットの前に `shipping-misskey-change` の検査を通す

## 手順

### 1. riin の develop を origin/develop にそろえる

```bash
git fetch origin develop && git fetch riin
git rev-list --count origin/develop..riin/develop   # 0 であること (riin/develop に独自のコミットが無い)
git push riin origin/develop:refs/heads/develop      # fast-forward
```

`origin/develop..riin/develop` が 0 でなければ、riin/develop に独自のコミットがある。上書きせずにユーザーに尋ねる。

### 2. バックアップと起点の確認

- push 前の SHA を記録し、`git branch backup/<名前>-<YYYYMMDD> riin/<branch>` を作る
- 機能の起点を決める
  - develop から派生したブランチ: 起点は `git merge-base origin/develop riin/<branch>`
  - 古い mistems-main から派生したブランチ: `origin/develop..riin/<branch>` の中で件名が `Version updated to:` の最新のコミットを起点にする。それより前のコミットは、他の MISTEMS 機能である (`classify.mjs` の `forkPoint` と同じ決め方)
- `git log --oneline <起点>..riin/<branch>` で固有のコミットを確かめる。merge コミットが無いこと

### 3. develop に載せ直す

develop から派生したブランチなら、`rebase-to-develop` スキルの rebase 方式でよい。mistems-main から派生したブランチは、固有の差分だけを当てる。

```bash
git worktree add -b <branch> <misskey-worktrees>/<名前>-rebase origin/develop
git diff --binary <起点> riin/<branch> > <scratchpad>/<名前>.diff
git -C <worktree> -c rerere.enabled=false apply --3way --index <scratchpad>/<名前>.diff
git -C <worktree> status --short   # U の付いたファイルがコンフリクト
```

- `apply --3way` のコンフリクトでは、ours が作業ツリー (develop)、theirs がパッチ (機能) である。develop の側を取るときは `git checkout HEAD -- <file>` が確実である (`--theirs` は機能の側になる)
- CHANGELOG.md は develop の側を取る
- 自動生成物 (`packages/i18n/src/autogen/locale.ts`、`packages/misskey-js` の autogen) は手でマージせず、手順 5 で生成し直す
- きれいに当たったファイルも、develop で消えた API (例: Sentry) や置き換わった仕組み (例: キューの生成) を使っていないか見る。最後は型検査で確かめる
- rerere は無効にしておく。rerere のキャッシュは全ワークツリーで共有されるので、ここでの解消が main-統合.sh で自動的に当たらないようにする

### 4. 規約違反を直してコミットする

- リポジトリのルートにある計画書・設計書を、日付付きの日本語の名前で `docs/` (未完了なら `docs/planning/`) へ `git mv` する。中のリンクも直す
- `locales/ja-JP.yml` 以外の locale を変えていたら、起点の内容に戻す
- `git -c rerere.enabled=false commit` でコミットする

### 5. コンテナで生成と検証を行う

ホストに node_modules が無いワークツリーでは、OrbStack の開発環境を使う。

1. 空きメモリを確かめる。`docker info` の Total Memory から、`docker stats --no-stream` の使用量の合計を引いて 4GB 以上あること。足りなければ止めて報告する
2. `bash <claudeImplement>/.claude/skills/orb-dev-server/scripts/orb-dev.sh up <worktree>` をバックグラウンドで実行する (起動時の `build-pre` で locale.ts も生成し直される)
3. コンテナの中で生成と検査を行う。compose のコマンドは毎回フルで書く (fish / zsh ではコマンドを変数に入れると単語分割されない)
   ```bash
   docker compose -p <project> -f ~/.cache/misskey-orb-dev/<project>/compose.yml exec -T web pnpm build-misskey-js-with-types
   docker compose -p <project> -f ~/.cache/misskey-orb-dev/<project>/compose.yml exec -T web pnpm --filter i18n generate
   docker compose -p <project> -f ~/.cache/misskey-orb-dev/<project>/compose.yml exec -T web pnpm --filter backend check-migrations   # migration があるとき
   ```
4. 型検査を行う。backend は `npx tsc --noEmit && npx tsc -p test --noEmit`、frontend は `NODE_OPTIONS=--max-old-space-size=3072 npx vue-tsc --noEmit` である。misskey-js の src を直したら `pnpm --filter misskey-js build && pnpm --filter misskey-js api` を実行する
5. テストを行う。`.config/test.yml` を作る (host は `db` / `redis`、ユーザーとパスワードは `~/.cache/misskey-orb-dev/<project>/docker.env`)。`exec -T db createdb -U <user> test-misskey` で DB を作る。`-w /workspace/packages/backend` で、unit は `pnpm build:unit && NODE_ENV=test pnpm compile-config && npx vitest run --config vitest.config.unit.ts <files>` を、e2e は `build:e2e` と `vitest.config.e2e.ts` を実行する
6. `check-shipping` を実行する。web コンテナの中には、ワークツリーの `.git` が指す共通の git ディレクトリが無いので、git が動かない。共通の git ディレクトリを同じパスでマウントした一時コンテナで実行する
   ```bash
   docker compose -p <project> -f ~/.cache/misskey-orb-dev/<project>/compose.yml run --rm --no-deps -T \
     -v <共通の git ディレクトリ>:<共通の git ディレクトリ> web \
     bash -c 'git config --global --add safe.directory "*" && npm i -g pnpm@<ver> >/dev/null 2>&1; node scripts/check-shipping.mjs --base origin/develop'
   ```
7. 生成物と修正をコミットする。API を変えたなら `misskey-api-reviewer`、`.vue` を変えたなら `vue-component-reviewer` を起動し、指摘は直すか PR の「既知の制限」に書く

### 6. push して PR を作る

```bash
git -C <worktree> push riin HEAD:<branch> --force-with-lease=<branch>:<push 前の SHA>
gh pr create -R fruitriin/misskey --base develop --head <branch> --title "<日本語のタイトル>" --body-file <本文>
```

PR の本文には、次のことを書く。最後の行は `🤖 Generated with [Claude Code](https://claude.com/claude-code)` とする。

- 何をする変更か
- 設計書のパス
- migration の有無
- 確かめ方
- 検証の結果 (PASS / FAIL / SKIPPED)
- 既知の制限

### 7. 後片付けと報告

- `.config/test.yml` を消し、`orb-dev.sh down <worktree> -v` で自分の環境だけを消す。`docker ps` で他の環境が残っていることを確かめる
- 同じブランチを head にした古い PR (base が mistems-main など) があれば、force push でその PR の中身も変わる。そのことと PR の番号を報告し、閉じるか base を変えるかをユーザーに尋ねる
- 同じブランチの variant のコンテナ (`variant-<slug>`) は古い版のまま残る。作り直すかどうかを報告に書く
- 報告には、PR の URL、push 前の SHA とバックアップの ref、新しい SHA、検証の結果を含める

## スキル修正時の反映

このスキルの本籍は claudeImplement worktree (`misskey-worktrees/claudeImplement`、ブランチ `add-claude-github-actions-1762310148415`) である。修正したらそこでコミットし、riin へ push する。mistems-main 側の `.claude/` は、統合のたびに作り直される。

## 経験の記録

- 2026-10-24: `claude/remote-emoji-refetch-2nbU9` で初めて実行した (PR #55)。古い mistems-main から派生していたので、固有の差分だけを develop に当てた。develop で Sentry が無くなり、キューの生成が `createQueue` に変わっていたため、きれいに当たったファイルも型検査で落ちた。misskey-js の `queueTypes` への追加も漏れていた
