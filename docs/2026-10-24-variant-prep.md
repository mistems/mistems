# variant-prep: 統合待ちブランチをまとめて動かして確認する

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

作成日: 2026-10-24
置き場所: claudeImplement (`add-claude-github-actions-1762310148415`) の `.claude/skills/variant-prep/` と `.claude/skills/orb-dev-server/`

## 目的

main-統合.sh の台帳で `[統合待ち（要チェック）]` になっているブランチを、起動したり止めたりせずに、すべて同時に開いて確認できるようにする。

ブランチは、develop との差分で次の 3 種類に分ける。

| 種類 | 判定 (develop との差分 `origin/develop...<branch>`) | 確認の方法 |
| --- | --- | --- |
| 1. frontend | `packages/frontend*` だけを変える | main-統合.sh の frontend-variants.yml の echo に追記し、本番の variant 切り替えで確認する |
| 2. backend | `packages/backend/src` を変える (misskey-js の autogen の変更も backend とみなす)。migration の追加は無い | OrbStack の別ドメインのコンテナを、ベース環境の DB に繋いで起動する |
| 3. migration | `packages/backend/migration` にファイルを追加する | ベース環境のスナップショットから戻した、専用の DB を持つコンテナを起動する |

## 決定事項

- ベース (土台) は mistems-main。variant のソースは「mistems-main + そのブランチの変更」とする
- ベース環境の DB は、フェーズ 1 の seed を入れたもの (`orb-dev.sh up <mistems-main> --seed`) を使う
- Redis はベース環境のものを共有する
- files/ はベース環境のものを共有する
- variant のコンテナでは定期ジョブを止める
- pnpm install / build は 1 つずつ実行し、前のコンテナが応答してから次を起動する
- 最終的に、種類 2・3 のコンテナはすべて同時に動かしたままにする
- リソースが足りないときは止めて報告する。一部のコンテナを勝手に止めて空けることはしない
- orb-dev.sh に `variant up|down|status <branch>` と、まとめて操作するコマンドを足す。variant-prep は「分類 → yml → 1 つずつ起動 → URL 一覧」を行う薄いスキルにする

## 調査で分かったこと (2026-10-24)

### 統合待ちの 5 本の分類

| ブランチ | develop との差分による分類 | ブランチ固有の差分 |
| --- | --- | --- |
| fix-clips-pagination | 1. frontend (yml に追記済み) | frontend 1 ファイル |
| claude/issue-26-20260510-1119 | 2. backend | frontend とロケールだけ |
| claude/misskey-pr-34-continue-5YwvL | 2. backend | frontend と CHANGELOG だけ |
| claude/renote-lock-feature-7J0NA | 3. migration (`1780190369217-noteRenoteLock.js`) | 同左 |
| claude/remote-emoji-refetch-2nbU9 | 3. migration (`1780148745000-AddNoteLastFetchedAt.js`) | 同左 |

issue-26・pr-34・remote-emoji-refetch の 3 本は、古い mistems-main (`Version updated to: … MISTEMS.88` / `.91` のコミット) から派生している。develop との差分には、そのとき統合されていた他の MISTEMS 機能の古い版が混ざる。分類は決定事項どおり develop との差分で行う (issue-26・pr-34 は backend のコンテナで動かす。frontend だけの変更でも backend のコンテナで正しく確認できる)。

### mistems-main への載せ方

ブランチ全体を mistems-main に squash merge すると、古い MISTEMS 機能の版がぶつかって数十ファイルがコンフリクトする。ブランチ固有のコミットだけを載せる。

- 起点: `origin/develop..<branch>` の中で件名が `Version updated to:` の最新のコミット。無ければ `git merge-base origin/develop <branch>`
- 起点からブランチ先端までの差分を、mistems-main の HEAD に 3-way で当てる

起点からの差分でも、4 本とも数ファイルがコンフリクトする (2026-10-24 の `git merge-tree` で確認)。

| ブランチ | コンフリクトするファイル |
| --- | --- |
| issue-26 | `page-editor.el.text.vue` |
| pr-34 | `CHANGELOG.md`, `MkPostForm.vue`, `MkUploaderItems.vue` |
| remote-emoji-refetch | `CHANGELOG.md`, `queue/types.ts` |
| renote-lock | `CHANGELOG.md`, `MkNote.vue`, `MkNoteDetailed.vue`, `locale.ts`, misskey-js の `types.ts` / `entities.ts` |

コンフリクトは variant のワークツリーの中で解消し、そこにコミットする (main-統合.sh も mistems-main も変えない)。autogen (`locale.ts`, misskey-js の `types.ts`) は解消せずに生成し直す。CHANGELOG はどちらを取ってもよい (variant の確認には効かない)。

### 定期ジョブとキュー

- `MK_ONLY_SERVER=1` でキューのワーカーを起動しない。`MK_NO_DAEMONS=1` でデーモン (チャートの集計など) を起動しない
- Redis のキーの接頭辞は、既定で `url` のホスト名になる。variant はホスト名が違うので、Redis を共有しても接頭辞は分かれる
- 起動時に `QueueService` が `upsertJobScheduler` で定期ジョブを登録し、自分の定義に無いスケジューラーを消す。接頭辞をベース環境と同じにすると、variant のコードがベース環境の定期ジョブを書き換えたり消したりする。そのため接頭辞は分けたままにする
- 結果として、variant が積んだジョブ (配送・通知の後処理など) は処理されない。定期ジョブも動かない

### リソース (2026-10-24 時点)

- OrbStack の VM はメモリ 11.7GB・10 CPU
- 他の開発環境 4 つ (claudeimplement, emoji-search-more-and-and, frontend-variants, mistems-trial) で約 5GB を使っている。dev モードの web は 1 つ約 2.2GB
- dev モードで 5 つ (ベース + variant 4) 立てると収まらない。ベース環境と variant は本番モード (`NODE_ENV=production pnpm build` → `pnpm start`) で動かす
- ビルド中は一時的に多く使うので、起動の前ごとに空きメモリを確かめる

### スナップショットの絶対 URL (フェーズ 1 の最終レビュー Important 4)

seed のスナップショットには `http://web.<ベースのプロジェクト>.orb.local:3000/` の絶対 URL が入る (ドライブのファイル、アバター、絵文字、インスタンスのアイコン)。

- 種類 2 はベース環境の DB をそのまま使うので、URL はベース環境を指したままになる。ベース環境は動かし続けるので、画像は表示できる
- 種類 3 はベース環境のスナップショットを戻すので、URL はベース環境を指す。ベース環境と files/ を共有しているので、同じ画像を表示できる
- そのため URL の書き換えはしない。ベース環境を止めると、variant の画像も表示されなくなる (SKILL.md に書く)

## 設計

### 名前

- variant の名前 (slug): ブランチ名の最後の `/` 以降を小文字にし、`[a-z0-9-]` 以外を `-` にしたもの。例: `claude/renote-lock-feature-7J0NA` → `renote-lock-feature-7j0na`
- ワークツリー: `<mistems-main の親>/variant-<slug>`、ブランチは `variant/<slug>` (ローカルだけ。push しない)
- compose のプロジェクト: `variant-<slug>`
- URL: `http://web.variant-<slug>.orb.local:3000/`

### orb-dev.sh のサブコマンド

```
orb-dev.sh variant classify <branch>        # frontend / backend / migration を出力する
orb-dev.sh variant prepare <branch> [base]  # ワークツリーを作り、ブランチ固有の差分を当てる。コンフリクトしたら止める
orb-dev.sh variant up <branch> [base]       # ビルドして起動し、応答するまで待つ
orb-dev.sh variant down <branch> [-v]       # 止める。-v で種類 3 の DB も消す
orb-dev.sh variant status                   # 全 variant のブランチ・種類・URL・DB・応答を一覧する
orb-dev.sh variant up-all <branch>...       # prepare と up を 1 本ずつ順に行う
orb-dev.sh variant down-all [-v]
```

`base` はベース環境のワークツリー (既定は mistems-main)。

- `prepare`: ベース環境のワークツリーの HEAD から `variant/<slug>` を作る (既にあれば作り直さない)。起点からの差分を `git apply --3way` で当て、コンフリクトが無ければコミットする。コンフリクトがあれば、ファイル一覧を出して終了コード 2 で終わる。解消してコミットした後に、もう一度 `prepare` を実行すると「当て済み」と判断して先へ進む
- `up`:
  - ベース環境が動いていなければ止める
  - 空きメモリを確かめる (VM 全体からコンテナの使用量の合計を引いた値が 4GB 未満なら、起動せずに終了する)
  - compose.yml を生成して起動し、`wait_ready` で応答を待つ
- compose.yml:
  - web はベース環境の network (`<base>_default`、external) に繋ぎ、Redis はベース環境の `redis` を使う
  - 種類 2 は DB にベース環境の `db` を使う
  - 種類 3 は自分の `vdb` サービス (postgres:18-alpine) を持つ。初回にベース環境の seed のスナップショット (`snapshots/<ベースの最新 migration>/seed.dump`) を `pg_restore` してから、web が `pnpm migrate` で自分の migration を当てる
  - `files/` はベース環境のワークツリーの `files/` をマウントする
  - pnpm のストアはベース環境の volume (`<base>_pnpm-store`) を external で共有する。node_modules の volume は variant ごとに分ける
  - web の環境変数に `MK_ONLY_SERVER=1`, `MK_NO_DAEMONS=1` を設定する
  - 本番モードでビルドする。生成する default.yml には、フェーズ 1 の `--prod` と同じ `allowedPrivateNetworks` を入れる
- `status` は、ラベル (`orb-dev.variant.branch` など) を付けたコンテナから一覧を作る

### variant-prep スキル

1. main-統合.sh の台帳から `[統合待ち（要チェック）]` の行のブランチを集める
2. `variant classify` で分ける
3. 種類 1 は main-統合.sh の frontend-variants.yml の echo に追記し (既にあれば追記しない)、`fish -n main-統合.sh` を実行する
4. ベース環境 (mistems-main) が動いていなければ、`up <mistems-main> --prod --seed` で起動する
5. 種類 2・3 を 1 本ずつ `variant prepare` → (コンフリクトしたら解消してコミット) → `variant up` する
6. `variant status` で URL 一覧を出し、ブランチ・種類・URL・DB の表で報告する

## Global Constraints

- mistems-main のブランチにはコミットしない。main-統合.sh は frontend-variants.yml の echo に追記する以外は変えない。変えたら `fish -n main-統合.sh` を実行する
- variant のブランチ (`variant/<slug>`) はローカルだけに置き、push しない
- 他の開発環境 (claudeimplement, emoji-search-more-and-and, frontend-variants, mistems-trial など variant でもベースでもないもの) を止めたり変えたりしない
- pnpm install / build を同時に 2 つ実行しない。`up-all` は 1 本ずつ、前の web が応答してから次へ進む
- 空きメモリが 4GB 未満なら起動せずに止まり、使用量の内訳を表示する。他のコンテナを止めて空けることはしない
- ベース環境の DB を壊す操作 (DROP、restore) を variant のコマンドから行わない。種類 3 は自分の `vdb` だけを作り直す
- orb-dev.sh の既存の書き方 (bash、日本語のメッセージ、`require_*` の検査、失敗したら終了コード 1) に合わせる。新しいファイルには SPDX ヘッダーを付ける (`node scripts/check-spdx.mjs`)
- ブランチの判定のような、git の結果から決める部分は、純粋な関数として `scripts/variant/` の `.mjs` に切り出し、`node:test` でテストする

## タスク

### Task 1: orb-dev.sh の variant サブコマンド

**Files:**
- Create: `.claude/skills/orb-dev-server/scripts/variant/classify.mjs` (判定の関数と CLI)
- Create: `.claude/skills/orb-dev-server/scripts/variant/classify.test.mjs`
- Modify: `.claude/skills/orb-dev-server/scripts/orb-dev.sh`

**手順:**
- [x] テストを先に書く。`classifyFiles(paths)` は、変更ファイルの一覧から `frontend` / `backend` / `migration` / `other` を返す (`packages/backend/migration/` への追加があれば migration、`packages/backend/src` か `packages/misskey-js/src/autogen` の変更があれば backend、`packages/frontend*` だけなら frontend、どれでもなければ other)。migration の判定には「追加されたファイル」の一覧を別に渡す。`findForkPoint(commits)` は、`origin/develop..<branch>` のコミット (新しい順、件名つき) から、件名が `Version updated to:` で始まる最新のコミットを返し、無ければ null を返す。`slugOf(branch)` は設計の「名前」の規則どおりにする
- [x] `classify.mjs` の CLI: `node classify.mjs <repo> <branch-ref>` で `{"category":…,"forkPoint":…,"slug":…}` を出力する。git は `child_process.execFileSync` で呼ぶ。起点は `findForkPoint` の結果、無ければ `git merge-base origin/develop <branch-ref>`
- [x] orb-dev.sh に `variant` サブコマンドを足す (設計の「orb-dev.sh のサブコマンド」の 7 つ)。ブランチの指定は riin のブランチ名 (`claude/…`、`fix-…`)。実行前に `git fetch riin <branch>` する
- [x] `prepare`: 起点からの差分を `git diff --binary <起点> riin/<branch> | git apply --3way --index` で当てる。コンフリクトしたファイルを一覧して終了コード 2。当て済みかどうかは、variant ブランチの最新コミットの件名 `variant: <branch>` で判断する
- [x] `up`: 設計の「compose.yml」のとおり。web に `orb-dev.variant.branch` / `orb-dev.variant.category` / `orb-dev.variant.base` のラベルを付ける。種類 3 の vdb には、初回 (volume が空のとき) だけベース環境の seed のスナップショットを `pg_restore` する。ベースのスナップショットのキーは、ベース環境のワークツリーの最新 migration 名
- [x] 確認: `variant classify` を統合待ちの 5 本に実行し、「調査で分かったこと」の表と一致すること。`bash -n orb-dev.sh`、`node --test` が通ること。実際の起動は Task 3 で行う (この Task では compose.yml の生成結果を目で確かめる)
- [x] commit

### Task 2: SKILL.md

**Files:**
- Create: `.claude/skills/variant-prep/SKILL.md`
- Modify: `.claude/skills/orb-dev-server/SKILL.md`

**手順:**
- [x] variant-prep: 設計の「variant-prep スキル」の 6 つの手順。コンフリクトの解消の仕方 (autogen は生成し直す、CHANGELOG はどちらでもよい、解消したら variant ワークツリーでコミットしてから `prepare` をもう一度実行する)。報告の表の形
- [x] orb-dev-server: `variant` サブコマンドの一覧、variant ではキューのワーカーと定期処理が動かないこと、ベース環境を止めると variant の画像も出なくなること
- [x] commit

### Task 3: 実行と確認

- [x] ベース環境: `orb-dev.sh up <mistems-main> --prod --seed`
- [x] variant-prep の手順で、統合待ちの 4 本 (種類 2・3) を 1 本ずつ起動する。コンフリクトは variant ワークツリーで解消する
- [x] 全部が同時に動いた状態で、各 URL で次を確かめる: `admin` / `admin1234` でサインインできる、タイムラインにノートが出る、そのブランチの機能の画面が開く (種類 3 は追加された列が vdb にあること)
- [x] この計画書の「検証結果」に URL 一覧と確認結果を書く

## 完了条件

- 種類 2・3 のコンテナがすべて同時に動いていて、URL を確認してある
- 種類 1 のブランチが yml に追記してある
- URL 一覧 (ブランチ、種類、URL、DB の種類) を報告に載せる
- この計画書を更新し、docs/ に移す

## 検証結果

### 実行した結果 (2026-10-24)

ベース環境は mistems-main (MISTEMS.114、fb938700f2) を `up --prod --seed` で起動した。スナップショットのキーは `FollowApprovalByAccountAge1791109435844` である。

| ブランチ | 種類 | URL | DB |
| --- | --- | --- | --- |
| fix-clips-pagination | 1. frontend | 本番の variant `clips-pagination` (frontend-variants.yml に記載済み) | ― |
| claude/issue-26-20260510-1119 | 2. backend (固有の差分は frontend だけ) | 本番の variant `pages-mfm-toolbar` (`variant/issue-26-20260510-1119`、`mode: as-is`) | ― |
| claude/misskey-pr-34-continue-5YwvL | 2. backend (固有の差分は frontend だけ) | 本番の variant `uploader-drag-handle` (`variant/misskey-pr-34-continue-5ywvl`、`mode: as-is`) | ― |
| claude/issue-26-20260510-1119 | 2. backend | http://web.variant-issue-26-20260510-1119.orb.local:3000/ | ベース (mistems-main) |
| claude/misskey-pr-34-continue-5YwvL | 2. backend | http://web.variant-misskey-pr-34-continue-5ywvl.orb.local:3000/ | ベース (mistems-main) |
| claude/renote-lock-feature-7J0NA | 3. migration | http://web.variant-renote-lock-feature-7j0na.orb.local:3000/ | 専用 (vdb) |
| claude/remote-emoji-refetch-2nbU9 | 3. migration | http://web.variant-remote-emoji-refetch-2nbu9.orb.local:3000/ | 専用 (vdb) |

### 本番の variant への追加 (2026-10-24、利用者の指示)

- issue-26 を frontend-variants.yml に加えた。pr-34 は、同じ目的の変更が本流 (origin/develop) に入っているかを確かめた。投稿フォームに添付済みのファイルの並べ替えは本流にもあるが、アップロード中の一覧 (MkUploaderItems) の並べ替えは本流に無いので、variant に加えた (mistems-main 114 には別のブランチ経由で入っている)
- どちらも HEAD に squash merge するとコンフリクトするので、コンフリクトを解消した variant のブランチを riin に push し、`mode: as-is` で載せた。main-統合.sh の除外のコメントから 2 本を外した
- `fish -n main-統合.sh` は通る。echo が書き出す yml を、本番と同じ `parseVariantList` で読み、3 件ともエラーが無いことを確かめた

### 確認したこと

- 4 本とベース環境が同時に動き、いずれも応答する。全コンテナのメモリの合計は 5.2GB (VM は 11.7GB) だった
- 4 本とも `admin` / `admin1234` でサインインでき、タイムラインにノートが出る
- 種類 3 の vdb には、それぞれの migration (`NoteRenoteLock1780190369217`、`AddNoteLastFetchedAt1780148745000`) が当たっている。ベース環境の DB には、どちらも当たっていない
- 各ブランチの機能の画面は次のとおりである
  - issue-26: ページエディタのテキストブロックに、既存のツールバー ($MFM、他MFM、#、絵文字) に続けて、MFM の書式のボタンが並ぶ
  - renote-lock: admin でノートのメニューを開くと「リノートをロックする (モデレーション)」が出る
  - remote-emoji-refetch: リモートのノートに「リモートで表示 または再取得」が出る。リモートのアバターとインスタンスのティッカーも表示される
  - pr-34: 機能は mistems-main にすでに入っていたので、variant は mistems-main と同じ動きになる
- 種類 1 の clips-pagination は frontend-variants.yml にすでに入っていた。`fish -n main-統合.sh` は通る

### コンフリクトの解消で手直ししたこと

- issue-26: mistems-main の別の機能が足したツールバーと 1 つにまとめた
- pr-34: 機能は mistems-main の a395976943 にすでに入っていたので、mistems-main の側を採用した (空のコミット)
- renote-lock: mistems-main では `canRenote` が `composables/use-note.ts` に移っていたので、ロックの条件をそこに入れた。メニューでロックを切り替えても、リノートのボタンは再描画するまで変わらない場合がある
- remote-emoji-refetch: `queue/types.ts` は両方の型を残した。ブランチが locale.ts を生成し直していなかったので、4 つのキーを足した

### 機能ブランチ側で直すとよいこと (今回は直していない)

- remote-emoji-refetch: misskey-js の自動生成をしていない (`notes/refetch` の型が無い)。frontend の型検査は失敗する
- ~~issue-26: `locales/en-US.yml` を変えている (Crowdin の配信先なので、手で変えない規約)~~ → 2026-10-24 に消し込んだ。機能ブランチ自身のコミットによるもので、origin から派生したことが原因ではなかった。`claude/issue-26-20260510-1119` に b2d3821251 を足して push し、variant のブランチからも取り除いた
- renote-lock・remote-emoji-refetch: 計画書をリポジトリのルートに置いている (`docs/planning/` に置く規約)

### 最終レビューのあとに直したこと

- 止まった web を起動し直すとき、前回のログの "Now listening" で起動済みと判定しないようにした
- riin のブランチが当てた版より進んだら、注意を表示するようにした
- 種類 2 は、ベース DB の migration と合わなければ起動しないようにした。main-統合.sh のあとにやり直す手順を SKILL.md に書いた
- other に分類されたブランチの扱い (利用者に尋ねる) を SKILL.md に書いた
