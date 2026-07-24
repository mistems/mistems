# リトライ不能な AP エラーの再試行抑止計画（構想・未実装）

[log-noise-reduction-plan.md](log-noise-reduction-plan.md) フェーズ3-c
（`DownloadSizeLimitExceededError` によるサイズ超過メディアのリトライ抑止）の一般化。
「リトライしても結果が変わらない」エラーは、ログ抑制ではなく
**リトライそのものを止める**方が根本的（無駄な再処理・キュー滞留・重複ログの根絶）。

## 現状整理

- inbox のリトライ回数: `inboxJobMaxAttempts ?? 8`（`core/QueueService.ts:235`）。
  本番観測では `attempts=2/2` なので運用側 config で 2 に制限済み
- 分類の既存実装（= 参考にすべき前例）:
  - **deliver 側は既に一般化済み**: `DeliverProcessorService.ts:141-153` で
    `StatusError && !isRetryable` → `Bull.UnrecoverableError`（410 Gone は
    ホスト suspend の特別扱い付き）
  - inbox 側は **actor 取得の 1 箇所だけ** 同じ分類をしている
    （`InboxProcessorService.ts:117-121`）。それ以外の経路
    （`performActivity` 内の resolver.resolve → Note/Person 解決等）で投げられた
    `StatusError` 4xx は分類されず**素通りでリトライされる**
  - `ApNoteService.ts:270` に `!isRetryable → 'permerror'` の分類例あり
- `StatusError.isRetryable` の定義: `!isClientError || statusCode === 429`
  （`misc/status-error.ts:18`）— 4xx（429 除く）= リトライ不能

## 提案

`InboxProcessorService.process` の catch（既に UnrecoverableError /
IdentifiableError / DownloadSizeLimitExceededError を分類している場所）に追加:

1. `e instanceof StatusError && !e.isRetryable` →
   `return \`skip: permanent error ${e.statusCode}\``
   （相手サーバーが 404/410/403 を返す = 対象オブジェクトがもう存在しない・
   アクセス不能。何度取りに行っても同じ）
2. （調査項目）DB 一意制約違反（重複配送による duplicate key）→ skip 候補。
   ただし既に上流で吸収されている可能性が高いので、Papertrail で
   `QueryFailedError` の頻度を確認してから判断
3. **対象外とするもの**: `AbortError`（タイムアウト）・`StatusError` 5xx・
   一時的なネットワーク断 — 相手サーバーの一時不調は回復し得るのでリトライ維持

## 方針・リスク

- 判断基準: **「恒久的失敗」と確信できるものだけ skip。迷ったらリトライ維持**
- リスク: 分類ミスで本来受信できたはずのアクティビティを落とす。
  ただし deliver 側で同じ分類が長期運用済みなので、inbox への適用は前例踏襲の範囲
- upstream 展開: 3-c（DownloadSizeLimitExceededError）と合わせて
  本家 PR 候補（`fix/inbox-jsonld-unrecoverable` とは別ブランチで）

## 検証

1. `pnpm lint`（typecheck + eslint）
2. 手動デプロイ後、Papertrail で `failed(...) attempts=` 系ログの before / after 比較
   （4xx 由来の inbox リトライが消え、5xx / タイムアウト由来のリトライは残ること）
