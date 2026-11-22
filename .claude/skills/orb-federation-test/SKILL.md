---
name: orb-federation-test
description: Use whenever running or adding the upstream federation tests (`packages/backend/test-federation`, `pnpm -F backend test:fed`) on this machine — boots two Misskey servers (a.test and b.test) in OrbStack with the upstream compose, builds with the pinned Node via mise, generates the certificates with Homebrew OpenSSL, runs the tests by name, registers b.test as an accepted relay to check relay delivery, and tears it all down. Must be consulted before running test:fed, because the upstream README path and macOS LibreSSL both fail silently and only one federation environment can run at a time. "連合テスト"、"test-federation"、"test:fed"、"2 台で連合を確かめたい"、"a.test と b.test"、"リレーを確かめたい" 等の発話で起動する。画面での確認や開発サーバーは orb-dev-server を使う。
---

# orb-federation-test

上流の `packages/backend/test-federation` を、compose をそのまま使って OrbStack で動かす。a.test と b.test は本番モード (`NODE_ENV=production`) で、自前の CA の https でつながる。ホストにポートは公開しない。

## コマンド

```bash
S=.claude/skills/orb-federation-test/scripts/fed.sh
$S up     [worktree] [--build]     # ビルド (built が無いとき・--build のとき)、証明書の用意、a.test / b.test の起動
$S test   [worktree] [テスト...]   # テストを実行する。省略すると全体
$S relay  [worktree]               # a.test に b.test の inbox を受理済みのリレーとして登録する
$S exec   [worktree] -- <引数...>  # docker compose をこの環境に対して実行する
$S status [worktree]
$S down   [worktree] [-v]          # -v で DB のデータ (test-federation/volumes) も消す
```

- `worktree` を省略すると、カレントディレクトリの worktree を対象にする。スクリプトが対象の worktree に無ければ、claudeImplement の worktree (`/Users/riin/workspace/misskey-worktrees/claudeImplement`) のものをフルパスで呼ぶ (mistems-main のものは前回の統合のときの写しで、古いことがある)
- `up` と全体の `test` は数分かかる。`run_in_background` で実行して完了の通知を待つ
- テストは名前だけ (`channel`)、ファイル名 (`channel.test.ts`)、パス (`packages/backend/test-federation/test/channel.test.ts`) のどれで渡してもよい。tester の作業ディレクトリは `packages/backend` なので、スクリプトが `test-federation/test/<名前>.test.ts` に直して渡す (上流の README のパスのままでは見つからない)
- compose のプロジェクト名は `fed-<worktree のディレクトリ名を小文字にしたもの>` (compose のプロジェクト名に大文字は使えないため。例: `mkPostformExtend` → `fed-mkpostformextend`)。ログは `$S exec -- logs misskey.a.test`、DB は `$S exec -- exec -T db.a.test psql -U postgres -d misskey -c '...'` で見る

## テストを足すとき

- テストは `packages/backend/test-federation/test/<名前>.test.ts` に置き、`./utils.js` の `createAccount`、`resolveRemoteUser`、`resolveRemoteNote`、`waitForFollowRelation`、`WAIT_FOR_FEDERATION` を使う。連合の反映は `vi.waitFor` で待ち、固定の `sleep` だけで待たない
- テストのファイルは tester に bind mount されるので、書き換えたら `up` し直さずに `test` だけ実行すればよい。backend のコードを変えたときは、`up --build` でビルドし直してから `down` → `up` する (misskey のコンテナは起動時の built を使う)
- lint は backend から `npx eslint --quiet test-federation/test/<名前>.test.ts`
- tester からは `https://a.test/...` を `fetch` で直接取れる。AP の応答の状態コードを見るときに使う

## 環境の注意

- **同時に動かせるのは 1 組だけ**。compose が固定サブネット (172.20.0.0/16 と 172.23.0.0/16) を使うためである。`up` は、別の連合テストの環境が動いていれば止まるので、先にそちらを `down` する
- **ホストの Node は `.node-version` の版を mise で使う**。Claude Code のシェルでは mise が有効になっていないことがあるので、スクリプトは `mise exec node@<版> --` でビルドする。その版が mise に入っていなければ、入れることをユーザーに提案する
- **証明書は Homebrew の OpenSSL で作る**。macOS の `/usr/bin/openssl` (LibreSSL) では `setup.sh` の `rootCA.crt` の作成が失敗し、そのまま先へ進んでしまう。スクリプトは Homebrew の OpenSSL を PATH の先頭に置いて `setup.sh` を実行し、`rootCA.crt` ができたかを確かめる
- **AP の応答は nginx に最長 180 秒キャッシュされる**。ノートの AP 応答には `Cache-Control: public, max-age=180` が付き、a.test・b.test の前の nginx が保存する。設定を変えて「以後は返さない」ことを確かめるテストでは、変える前の確認にクエリ文字列を付けた別の URL を使う (例: `fetch('https://a.test/notes/<id>?before')`)
- 管理者は `admin` / `admin` で、テストを初めて実行したときに `utils.ts` が作る。`relay` を使う前に、テストを一度実行しておく
- 証明書・`.config/*.yml`・`volumes/` は test-federation の `.gitignore` に入っている

## リレーの代わり (`relay`)

本物のリレーを立てずに、「リレーに乗るノート」を確かめる。

1. a.test の管理者が `admin/relays/add` で `https://b.test/inbox` をリレーとして登録する。b.test はリレーではないので Accept を返さず、状態は `requesting` のままになる
2. a.test の DB で `relay.status` を `accepted` にする
3. 受理済みのリレーの一覧はメモリに 10 分残るので、`misskey.a.test` を再起動する

これで a.test は、`visibility === 'public'` で `localOnly` でないノートを b.test の inbox にも送る。だれにもフォローされていない a.test のユーザーで投稿し、b.test の DB にノートが入ったかを見る。

```bash
$S exec -- exec -T db.b.test psql -U postgres -d misskey -c "SELECT uri, visibility FROM note WHERE uri LIKE 'https://a.test/notes/%' ORDER BY id DESC LIMIT 5;"
```

比べるために、同じユーザーで通常の公開ノートも投稿しておくと、リレーの経路そのものが動いているかを区別できる。b.test を相手にした Follow → Accept の往復と、リレーからの Announce の受信は、この方法では確かめられない。

## 片付け

- 終わったら `down` する。ほかの worktree で連合テストを動かすときの妨げになる
- DB のデータは `test-federation/volumes` に残る。作り直すときは `down -v`
- 依存の node_modules は compose の名前付きボリューム (`fed-<名前>_node_modules` など) に残る。消すときは `$S exec -- down -v`
