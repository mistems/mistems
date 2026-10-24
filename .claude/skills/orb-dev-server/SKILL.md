---
name: orb-dev-server
description: Use whenever starting, stopping, or checking a Misskey dev server (`pnpm dev`) for a worktree on this machine — runs pnpm dev, PostgreSQL and Redis inside OrbStack containers per worktree so ports 3000 / 5173 / 5432 / 6379 never collide with other worktrees or projects. Prefer this over running `pnpm dev` on the host. "開発サーバー起動して"、"dev サーバー"、"動作確認したい"、"pnpm dev"、"検証環境を止めて" 等の発話で起動する。
---

# orb-dev-server

worktree ごとに独立した Misskey 開発サーバーを OrbStack 上で立てる。
ホストにポートを公開せず、`http://web.<project>.orb.local:3000/` でアクセスする (`--lan` のときだけ、LAN 内の端末向けにポートを公開する)。

## コマンド

```bash
.claude/skills/orb-dev-server/scripts/orb-dev.sh up     [worktree] [--prod] [--seed] [--lan | --lan-mdns]  # 起動して URL を表示 (初回は管理者も作成)
.claude/skills/orb-dev-server/scripts/orb-dev.sh status [worktree]
.claude/skills/orb-dev-server/scripts/orb-dev.sh logs   [worktree]   # web のログを追う
.claude/skills/orb-dev-server/scripts/orb-dev.sh down   [worktree] [-v]  # -v で DB・node_modules の volume も消す
.claude/skills/orb-dev-server/scripts/orb-dev.sh seed     [worktree]          # 開発用データを入れてスナップショットを取る
.claude/skills/orb-dev-server/scripts/orb-dev.sh snapshot [worktree] [名前]   # 今の DB と files/ を保存する (名前の既定は seed)
.claude/skills/orb-dev-server/scripts/orb-dev.sh restore  [worktree] [名前]   # 保存した状態に戻す (名前の既定は seed)
```

- `up --prod` は `pnpm dev` の代わりに本番ビルド (`pnpm build` → `pnpm migrate` → `pnpm start`) で起動する。初回はビルドがあるので待ち時間の上限を 30 分にしている (開発モードは 15 分)
- `up --seed` は起動と管理者作成のあとに、キーの合う `seed` のスナップショットがあれば確認なしで `restore` する。現在のデータは上書きされる。無ければ `seed` を実行する
- `up --lan` は、LAN 内の端末 (スマホの実機など) から `http://<Mac の LAN の IP アドレス>:<ポート>/` で開けるようにする。ポートは 3000 から順に、ホストで空いているものを使う。`--lan` なしで `up` し直すと orb.local に戻る (詳しくは「LAN 内の端末から開く」)
- `seed` は管理者以外のユーザーがいない環境にだけ入れる。データが既にあるときは何も変えずに止まるので、`down -v` してから入れ直すか、`restore` で戻す
- `worktree` を省略するとカレントディレクトリの worktree を対象にする
- スクリプトはこのブランチ (skill の本籍) にしか無いことがある。対象 worktree に無ければ、mistems-main か claudeImplement worktree のものをフルパスで呼ぶ
- 初回の `up` は依存のインストールで数分かかる。`run_in_background` で実行して完了通知を待つとよい
- 管理者アカウントは `admin` / `admin1234`。ユーザーが 1 人もいないときだけ作る
- 動作確認は Playwright MCP で上記 URL を開く

## 仕組み

- compose プロジェクト名は worktree のディレクトリ名を小文字化したもの。生成物は `~/.cache/misskey-orb-dev/<project>/` に置き、worktree には何も書かない
- `web` は `.node-version` の Node 公式イメージで動かす。開発モードでは `pnpm install` → `pnpm build-pre` → (バックエンドのビルドが無いときだけ) `pnpm --filter backend... build` → `pnpm migrate` → `pnpm dev` を実行する。`--prod` では `pnpm install` → `pnpm build` → `pnpm migrate` → `pnpm start` を実行する。worktree はマウントするので、開発モードではファイル保存がそのまま HMR で反映される
- `.config/default.yml` は `.config/example.yml` から生成し (URL・DB / Redis の接続先・setupPassword・allowedPrivateNetworks を差し替え)、コンテナ内の同じパスに重ねてマウントする。ホストの `.config/default.yml` は変更しない
- `allowedPrivateNetworks` には OrbStack のコンテナが使う private IP の範囲 (`192.168.0.0/16` など) を入れる。本番モードの Misskey は private IP への取得を遮断するので、これが無いと seed のリモートのアバター・絵文字・添付・インスタンスのアイコン (この環境自身の orb.local の URL を proxy 経由で取る) が表示されない

## ハマりどころ

- **ホストで `pnpm dev` を動かさない理由**: vite のポート (5173 / 5174) は環境変数で変えられない。backend は `VITE_PORT` を読んでプロキシするが vite 側は読まないので、他の vite が 5173 にいると別プロジェクトへプロキシしてしまう
- **node_modules はホストと分ける**: ホストの node_modules は macOS 向けのネイティブモジュール (sharp, re2 など) を含み、Linux コンテナでは動かない。ルートと `packages/*/node_modules` を名前付き volume にしている
- **Node 25 以降は corepack が無い**: 公式イメージに同梱されなくなったので、`package.json` の `packageManager` のバージョンを `npm i -g` で入れている
- **vite は `.config/default.yml` を固定パスで読む**: `allowedHosts` を URL のホスト名から作るので、URL を orb.local のものにしないと vite が接続を拒否する
- **seed は web コンテナの中で実行する**: ホストの Node.js は `*.orb.local` を引けないことがある。そのため seed の API の段は web コンテナ内から `http://localhost:<Misskey が待ち受けるポート>` (通常は 3000、`--lan` では選んだポート) に対して実行する
- **`files/` もスナップショットに含める**: 添付画像・アバターなどの実体は worktree の `files/` にあり、DB だけ戻すと参照先が無くなる。`files/` の tar はホスト側で作り、戻す
- **新しい worktree でも migrate が動くように、開発モードでは起動のたびに `pnpm build-pre` を実行する**: `pnpm migrate` は `built/meta.json` を読む。バックエンドのビルドは `packages/backend/built/config.js` が無いときだけ行う。`--prod` では `pnpm build` がこれらを作るので実行しない

## LAN 内の端末から開く (`--lan`)

`*.orb.local` は Mac の中でしか名前を引けないので、スマホなどの実機からは開けない。`up --lan` は次のように切り替える。

- `url` を `http://<Mac の LAN の IPv4 アドレス>:<ポート>/` にする。IP アドレスは既定ルートのインターフェースのもの (`route -n get default` の interface → `ipconfig getifaddr <interface>`) を使う
- `--lan-mdns` は、IP アドレスの代わりに `<Mac のホスト名>.local` (`scutil --get LocalHostName`) を使う。Android の Chrome は mDNS の `.local` を引けない (`DNS_PROBE_FINISHED_NXDOMAIN` になる) ので、既定は IP アドレスにしている
- ポートは 3000〜3099 のうち、ホストで待ち受けているプロセスがない最初の番号にする。Misskey もコンテナの中でその番号で待ち受け、同じ番号でホストに公開する。この環境が既に公開しているポートは、そのまま使い続ける
- 選んだホストとポートは `~/.cache/misskey-orb-dev/<project>/lan` に残し、`status` や `seed` もその URL を使う
- vite の HMR 用に 5173 番 (埋め込みは 5174 番) も同じ番号で公開する。vite の HMR は、ページを開いた端末から 5173 番へ直接つなぐ (`hmr.clientPort` が固定) ためで、つながらないと Misskey の起動処理が「読み込みに失敗しました」になる。ホストの 5173 番がほかに使われているときは `--lan` で起動しない。このため `--lan` の環境は同時に 1 つしか動かせない
- backend は vite への中継先を「`url` のホスト名:5173」で作る。IP アドレスのときは、コンテナの中から Mac の 5173 番へ中継し、公開した 5173 番を経由して自分の vite に戻ってくる。`--lan-mdns` のときは、コンテナの中だけ `extra_hosts` でその名前を 127.0.0.1 に向ける
- **IP アドレスが変わったら (別のネットワークにつないだときなど)、`up --lan` し直す**。URL が作り直される
- **`url` を変えたら、データも入れ直す**。アップロードしたファイル・アバター・絵文字などの URL は絶対 URL で DB に残るので、古いホストのままだと画像が出ない。スナップショットも古い URL を持っているので `restore` では直らない。この環境で作ったデータしかないなら、web を止めて DB を作り直し (`dropdb` → `createdb`)、`files/` を空にし、Redis を `flushall` してから `up --lan` → `seed` する
- 開けないときは、端末が同じネットワークにいるかを確かめる。macOS のファイアウォールでは、ポートを待ち受ける「OrbStack Helper」の受信が許可されている必要がある (`/usr/libexec/ApplicationFirewall/socketfilterfw --listapps` で確認できる)

## 開発用データ (seed / snapshot / restore)

タイムラインや検索、プロフィールなどの画面を実データに近い量で確認するために、開発用のデータを入れられる。

### データの中身

- ユーザーは約 50 人である。パスワードはローカルのユーザー全員 `admin1234` である
  - ローカルは 40 人である。`admin` (管理者) と `user01`〜`user39` で、`user38` と `user39` はボットである
  - リモートは 10 人である。`remote-a.example` (Misskey) に `akari`・`bunta`・`chihiro`・`daisuke`・`emi`、`remote-b.example` (Mastodon) に `fumi`・`gen`・`hana`・`iori`・`jun` がいる (例: `@akari@remote-a.example`)。リモートのユーザーではログインできない
- ノートは約 3.5 万件で、過去 180 日に散らしている。1 人あたり 600〜800 件で、リモートのノートは約 7 千件である。リプライ・リノート・添付・リアクション・アンケート・CW・MFM・ハッシュタグを含む
- カスタム絵文字はローカルが約 100 個、リモートが 8 個である
- フォロー関係は相互・片思い・被フォロー・孤立の 4 種類を用意している
- クリップ、お気に入り、リスト、アンテナ、チャンネル 3 つ、リモートのインスタンス情報 (名前・テーマカラー・アイコン) も入る
- シード用のロールを付けている。レート制限を外し、ノート検索 (`canSearchNotes`) とクリップ上限を広げるためである
- FTT (fanout timeline) は seed が無効にする。SQL で入れたリモートのノートをタイムラインに出すためである
- 全ユーザーの初期設定 (ログイン直後の「アカウントの作成が完了しました」のダイアログ) を完了済みにしている。アカウントのレジストリ (`client` / `base` の `accountSetupWizard`) に `-1` を入れる。「ヒントとコツ」は端末ごとの保存なので、seed では消せない

### 仕組みと保存先

- seed は 2 段で入れる。API の段 (`seed/seed.mjs`) で本物のコードを通して約 430 件を作り、SQL の段 (`seed/bulk.mjs`) で大量のノートとリモートのデータを 1 つのトランザクションで流し込む。どちらかが失敗したらスナップショットは取らない
- seed のスクリプトは `orb-dev.sh` 自身の場所にある `seed/` を web コンテナの `/orb-seed` に読み取り専用でマウントして使う。対象の worktree に seed のスクリプトが無くても動く
- スナップショットは `~/.cache/misskey-orb-dev/<project>/snapshots/<最新の migration 名>/<名前>.dump` (`pg_dump -Fc`) と `<名前>.files.tar` (worktree の `files/`) の 2 つである。取るときは一時ファイルに書いてから置き換えるので、途中で失敗しても前のものは壊れない
- キーは最新の migration 名である。migration が変わると古いスナップショットは使えなくなるので、`restore` は戻さずに止まり、手元の一覧を表示する。その場合は `down -v` してから `up --seed` で入れ直す
- 同じシード値なら、いつ実行しても内容 (ユーザー名・本文・CW・公開範囲・リプライやリノートの相手・リアクション・フォロー関係) は同じになる。ID と時刻は実行ごとに変わる。SQL の段のノートは、実行した日の JST の 0 時を基準に、その前日までの 179 日に置く
- seed の設定は環境変数で変えられる。`SEED` はシード値 (既定 `20261023`)、`SEED_LOCAL_NOTES` と `SEED_REMOTE_NOTES` は SQL の段で作る 1 人あたりのノート数の平均 (既定 700) である。`orb-dev.sh` は設定された変数だけを web コンテナに渡す (例: `SEED=1 orb-dev.sh seed`)
- 値を変えて `seed` しても、スナップショットは同じ名前 `seed` で上書きされる。既定の内容を残したいときは、名前を付けて取る (例: `SEED_LOCAL_NOTES=50 orb-dev.sh seed . small`)

### 対象外と注意

- 実際の連合はしない。リモートのユーザーとノートは DB に直接入れた表示用のデータである。ログインしていないと `users/show` はリモートユーザーを返さない (Misskey の仕様)
- API で作るノート (約 430 件) の時刻は実行時刻になる。過去 180 日に散らしているのは SQL の段のノートである
- `down -v` は worktree の `files/` (ローカルドライブの保存先) を消さない。残ったファイルはどこからも参照されないので害はないが、次のスナップショットには入る
- `restore` は web を止め、DB を消してから戻し、worktree の `files/` を丸ごと消してスナップショットの中身に置き換え、Redis を `FLUSHALL` で空にしてから web を起動し直す。`files/` に手で置いたファイルも消える
- `restore` が途中で失敗すると、DB が空のまま残ることがある。復旧は `up` → `restore`、または `up --seed` である。それでも失敗するなら `down -v` → `up --seed` で作り直す
- スナップショットの名前を指定するときは worktree も書く (例: `restore . before-x`)。1 つ目の位置引数は常に worktree として扱う

## variant (統合待ちのブランチの確認)

統合待ちのブランチを、ベース環境 (既定は mistems-main の worktree) の DB・Redis を使う別のコンテナで動かす。呼び出しの順序と報告の形は `variant-prep` スキルに書いてある。ここではコマンドと注意点だけを書く。

```bash
.claude/skills/orb-dev-server/scripts/orb-dev.sh variant classify <branch>        # frontend / backend / migration / other を表示する
.claude/skills/orb-dev-server/scripts/orb-dev.sh variant prepare  <branch> [base] # worktree を作り、ブランチ固有の差分を当てる (コンフリクトは終了コード 2)
.claude/skills/orb-dev-server/scripts/orb-dev.sh variant up       <branch> [base] # 本番ビルドで起動し、応答するまで待つ
.claude/skills/orb-dev-server/scripts/orb-dev.sh variant down     <branch> [-v]   # 止める。-v で vdb・node_modules の volume も消す (worktree とブランチは残る)
.claude/skills/orb-dev-server/scripts/orb-dev.sh variant status                    # ブランチ・種類・URL・DB・状態・応答を一覧する
.claude/skills/orb-dev-server/scripts/orb-dev.sh variant up-all   <branch>...      # prepare と up を 1 本ずつ順に行う (ベースは既定のものだけ)
.claude/skills/orb-dev-server/scripts/orb-dev.sh variant down-all [-v]
```

`<branch>` は riin のブランチ名 (例: `claude/renote-lock-feature-7J0NA`) である。

- 種類は origin/develop との差分で決める。migration を追加するものは `vdb` (自分専用の DB)、backend を変えるものはベース環境の DB を使う。frontend だけのものは `prepare` / `up` を断る (frontend-variants.yml で確認する)
- variant の worktree は `<ベースの親>/variant-<slug>`、ブランチは `variant/<slug>` (ローカルのみ)、compose のプロジェクトは `variant-<slug>`、URL は `http://web.variant-<slug>.orb.local:3000/` である。slug はブランチ名の最後の `/` 以降を小文字にし、`[a-z0-9-]` 以外を `-` にしたものである
- `prepare` は、起点 (件名が `Version updated to:` の最新のコミット、無ければ merge-base) からブランチ先端までの差分を、ベースの HEAD に 3-way で当ててコミットする。コンフリクトの解消のコミットは、rerere の記録が `main-統合.sh` に影響しないよう `git -c rerere.enabled=false commit` で行う
- variant のコンテナは `MK_ONLY_SERVER=1` と `MK_NO_DAEMONS=1` で起動する。キューのワーカーとデーモンが動かないので、積まれたジョブ (配送・通知の後処理など) は処理されず、定期ジョブも動かない。配送や通知の後処理を伴う動作は確認できない
- Redis はベース環境のものを共有するが、キーの接頭辞は URL のホスト名から決まる (`packages/backend/src/config.ts` の `redis.prefix` の既定値) ので variant ごとに分かれる。接頭辞を揃えると、variant のコードがベース環境の定期ジョブを書き換えたり消したりするため、揃えてはならない
- `files/` と pnpm のストア (`<base>_pnpm-store`) はベース環境のものを共有する
- seed のスナップショットにはベース環境の URL (`http://web.<ベース>.orb.local:3000/`) が入っている。**ベース環境を止めると、variant の画像 (アバター・絵文字・添付・インスタンスのアイコン) も表示されなくなり、variant の起動もできない**。確認が終わるまでベース環境を止めない
- `vdb` の初回は、ベースの seed のスナップショットを restore してから migrate を当てる。seed が無いときは web を起動せずに止まる。やり直すときは `variant down <branch>` → `docker volume rm variant-<slug>_vdb-data` → `variant up <branch>` である (`-v` は node_modules の volume も消すので、依存のインストールからやり直しになる)
- `variant down` は worktree (`variant-<slug>`) とブランチ (`variant/<slug>`) を消さない。作り直すときは `git -C <ベース> worktree remove` と `git -C <ベース> branch -D` で消してから `prepare` する
- `prepare` (当て済みのとき) と `up` は、riin のブランチが当てた版より進んでいれば注意と作り直しの手順を表示する。止めはしない
- 種類 2 の `up` は、variant の worktree の最新の migration とベース DB の最新の migration が違えば起動しない。`main-統合.sh` で mistems-main を作り直したあとは、ベース環境を作り直す (`variant-prep` スキルの「main-統合.sh のあとの再実行」)
- `up` は、web が今回起動してからのログだけを見て応答を判断する。Mac や OrbStack の再起動で止まった web を `up` で起動し直したときも、ビルドが終わるまで待つ
- ベース環境の操作は variant にも及ぶ
  - ベースの `restore` (`up --seed` で restore に進む場合を含む) は、共有の Redis を `FLUSHALL` するので variant のキーも消える。`files/` も丸ごと置き換えるので、variant (特に種類 3) でアップロードしたファイルも消える。逆に、variant でアップロードしたファイルは、ベースの次のスナップショットに入る
  - 種類 2 はベースと DB を共有するが、Redis の接頭辞 (pub/sub のチャンネルを含む) は分かれる。片方で変えたユーザーなどのキャッシュが、もう片方では古いまま残ることがある
- variant の web はベースの network (`<base>_default`) と pnpm のストアの volume を使うので、variant が動いている間はベースの `down` / `down -v` が途中で失敗する。ベースを止めるときは、先に `variant down-all` を実行する
- `up` の前に空きメモリ (VM 全体からコンテナの使用量の合計を引いた値) を確かめ、4GB 未満なら起動せずに内訳を表示して止まる。他のコンテナを止めて空けることはしない
- pnpm install / build が重なるので、`up` は 1 本ずつ実行し、前の web が応答してから次へ進む

# 経験の記録
（実施したときの注意点などを自由に記載）

- 2026-10-10: emojiDropUpload worktree で作成・動作確認。依存インストール込みで初回の起動は 1〜2 分だった
