# ログノイズ抑制計画（annoy-logs-goneto-debuglevel）

連合（ActivityPub）由来の想定内イベントが WARN / ERR / INFO で大量に出力され、
Papertrail 上のノイズになっている。これらを debug レベルに落とし、本番ログを
「本当に見るべきもの」だけにする。

- 方針: **出力の削除ではなく debug 化**。Misskey の `Logger.debug` は
  `NODE_ENV=production` では `--verbose` 指定時以外出力されない
  (`packages/backend/src/logger.ts:101-104`)。調査時は `--verbose` で全量復活できる。
- 本計画書はブランチの**意図の正本**。upstream (misskey-dev) がログ基盤の改修を
  進めており、rebase 時に激しくコンフリクトする可能性が高い。コンフリクト解消が
  困難な場合は、develop 側のコードを正として**本計画書から変更を再適用**する。

## 評価方法（Papertrail CLI）

papertrail-cli（gem 版、`~/.papertrail.yml` に token 設定済み）で
before / after のログ件数を定量比較できる。**ただしデプロイは手動**のため、
評価は本番サーバーへ手動デプロイした後に実施する。

```bash
# パターン正規化して頻度集計（直近10分）
papertrail -d 10 | sed -E 's/^[A-Z][a-z]+ [0-9]+ [0-9:]+ +[^ ]+ +misskey: //; s/[0-9a-f]{8,}/<id>/g; s|https?://[^ ]+|<url>|g; s/[0-9]+/<n>/g' \
  | sort | uniq -c | sort -rn | head -30

# リアルタイム監視
papertrail -f
```

### ベースライン実測（2026-07-21、直近10分、本番環境。フェーズ0 が反映済みかは未確認 — after 計測時にビルド内容を確認すること）

| 件数/10分 | パターン | レベル |
|---:|---|---|
| 約515 | `Error in inReplyTo <url> - Error: hit recursion limit: <host>` | WARN |
| 約340 | `inbox activity ignored (maybe): reason=skip: target note not found / message not found / Unknown type` | WARN |
| 約400行 | ジョブ失敗時の `{ job, e }` オブジェクトダンプ（スタックトレース・job データが複数行で出る） | ERR |
| 約100 | `Deleting the Note` / `Publishing relay-delivered note` | INFO |
| 約40 | `Resolution failed: AbortError: The operation was aborted.` | ERR |
| 約50 | kernel `[UFW BLOCK]`（ホスト syslog 由来 → **対象外**、rsyslog / Papertrail 側フィルタで対応） | — |
| 約40 | `execution time: <n>`（src 内に出力元なし。依存ライブラリ由来の可能性 → 実装時に出所調査、無理なら見送り） | — |

## フェーズ0: 実装済み（コミット 48127b76fb「正常系ログをデバッグレベルに落とす」）

rebase でこのコミットが壊れた場合の再適用ガイド。

### 0-a. 正常系ログの info / succ → debug（機械的、約25箇所）

対象ファイルと代表例:

- `core/DownloadService.ts` — `Downloading…` / `Download finished` / `text file: Temp file is…`
- `core/DriveService.ts` — 保存系の正常ログ一式
- `core/activitypub/ApInboxService.ts` — `Create:` / `Announce:` / `Accept:` の受信ログ
- `core/activitypub/models/ApImageService.ts` — `Creating the Image:`
- `core/activitypub/models/ApNoteService.ts` — `Creating the Note:` / `Creating the (Re)Note:` / `extractEmojis:`
- `core/activitypub/models/ApPersonService.ts` — `Creating/Updating the Person:` / `Updating the featured:`
- `core/activitypub/models/ApQuestionService.ts` — `vote from AP:`
- `server/web/UrlPreviewService.ts` — `Got preview of…` ほか
- `queue/processors/InboxProcessorService.ts` — activity JSON ダンプ（`JSON.stringify(info)`）

判断基準: **正常系の処理経過報告はすべて debug**。エラー・異常系はこのフェーズでは触らない。
（例外: ApNoteService の「already inserted, reading again」は info → error に**格上げ**している）

### 0-b. InboxProcessorService の構造変更

- `process()` 本体を try/catch で包み、想定内の失敗を `Bull.UnrecoverableError`
  に変換（**リトライさせない** = リトライ毎の重複ログを根絶）
- ブロック済みホスト・削除済みユーザー等は `return`（正常スキップ扱い）に変換
- `JsonLdError` import の整理

## フェーズ1: 新規・機械的な debug 化（実装済み・2026-07-21）

rebase 後の develop では #5 の `failed(...)` ダンプが 3 箇所 → 10 箇所
（system / db / deliver / inbox / userWebhookDeliver / systemWebhookDeliver /
relationship ほか）に増えていたため、全 10 箇所に適用した。
エラー1行サマリは `error` のまま維持し、第2引数のダンプは
`logger.debug('failed job detail id=…', {…})` の別呼び出しに分離。

| # | ファイル:行（現時点） | 変更 |
|---|---|---|
| 1 | `core/activitypub/models/ApNoteService.ts:249` | `Error in inReplyTo…` を `warn` → `debug`（リプライチェーン深掘りの打ち切りは想定内） |
| 2 | `queue/processors/InboxProcessorService.ts:254` | `inbox activity ignored (maybe)` を `warn` → `debug`（skip 理由付きの想定内スキップ） |
| 3 | `core/activitypub/ApInboxService.ts:344` | `Publishing relay-delivered note` を `info` → `debug` |
| 4 | `core/activitypub/ApInboxService.ts:534` | `Deleting the Note` を `info` → `debug` |
| 5 | `queue/QueueProcessorService.ts:200,257,337` | ジョブ失敗ログの**1行サマリ（`failed(...) id=… attempts=…`）は `error` のまま維持**し、第2引数の `{ job: renderJob(job), e: renderError(err) }` ダンプを `logger.debug` の別呼び出しに分離 |

行番号は rebase 後にずれるため、メッセージ文字列で grep して特定すること。

## フェーズ2: 想定内エラーの条件付き debug 化（任意・後回し可）

`core/activitypub/ApInboxService.ts` の `Resolution failed: ${e}` ×7箇所:

- エラーが **AbortError**（タイムアウト由来）または **StatusError の 4xx**
  （相手サーバー都合）の場合のみ `debug`
- それ以外（バグの可能性があるもの）は `error` を維持
- 判定ヘルパーを 1 つ作って 7 箇所で共有する

## 検証チェックリスト

1. `pnpm lint`（typecheck + eslint）
2. API / entity / migration 変更なし → misskey-js 再生成・check-migrations は不要
3. `CHANGELOG.md` の `## Unreleased` → `### Server` に Enhance を1行追記
4. 手動デプロイ後、上記「評価方法」の集計コマンドで before / after 比較
   （目標: misskey 由来ノイズの 9 割減、ERR 1行サマリは残存していること）
