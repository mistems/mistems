# HttpRequestService の abort タイマー起因 unhandled rejection 修正計画

作成: 2026-07-23。ブランチ `fix/http-request-abort-timer`（origin/develop 直系）。
最終的に upstream PR を出す（resync-charts と同じ方式: fix コミットのみを
cherry-pick した clean ブランチから提出）。

## 現象

```
ERR [core] Unhandled promise rejection {
  eventName: 'process.unhandled_rejection',
  error: { type: 'AbortError', message: 'The operation was aborted.',
    stack: ... at abortAndFinalize (node-fetch 内部)
           ... at Timeout._onTimeout ... }
}
```

- 3 インスタンス全部で **毎時 10〜16 件**、古いビルドでも発生 = 慢性の持病
- `boot/process-error-handler.ts` が捕捉してログするためプロセスは落ちないが、
  1 件あたり約 20 行のスタックダンプ。成功ログ削減（annoy フェーズ4）後の
  最大のノイズ源
- スタックの `abortAndFinalize` は node-fetch (3.3.2) 内部の abort リスナー

## 原因（コードレベルで確認済み）

`packages/backend/src/core/HttpRequestService.ts` の `send()`:

```ts
const controller = new AbortController();
setTimeout(() => {
    controller.abort();
}, timeout);                     // ★1 タイマーを一切 clearTimeout していない
                                 //    → リクエスト成否に関わらず必ず abort() が発火する
const res = await fetch(url, { ..., signal: controller.signal });

if (!res.ok && extra.throwErrorWhenResponseNotOk) {
    throw new StatusError(...);  // ★2 res.body を読み捨てたまま throw
}
```

さらに `send()` の呼び出し元には **body を消費しないもの**が複数ある:

- `ApRequestService`（AP 配送の signed POST — 応答 body 不使用）
- `UserWebhookDeliverProcessorService` / `SystemWebhookDeliverProcessorService`
  （status だけ見る）
- `FetchInstanceMetadataService`（favicon の存在チェック）

## メカニズム仮説（実装フェーズ冒頭にローカル再現で確定させること）

宙ぶらりんの body ストリーム（throw で捨てた / 呼び出し元が読まない）に対し、
遅れて発火したタイマーの `abort()` が node-fetch 内部でストリームを破棄し、
誰も待っていない Promise が AbortError で reject → unhandledRejection。

再現手順案: ローカルで「500 を返すサーバー」「body を返すが読まれないサーバー」
に `send()` を撃ち、`process.on('unhandledRejection')` の発火を観測する。
（timeout を 100ms 等に縮めると数秒で観測できるはず）

## 修正方針（再現結果を見て最小の組み合わせを選ぶ）

| 案 | 内容 | 論点 |
|---|---|---|
| A | `!res.ok` の throw 前に `res.body` を明示破棄 (`destroy()` / consume) | 最小・安全。throw パスの leak を塞ぐ |
| B | `fetch` 解決後に `clearTimeout`（try/finally） | タイマー leak の根治。ただし「body 読み取り中のタイムアウト保護」が消えるトレードオフに注意（node-fetch には body タイムアウトが無い。size 制限はある） |
| C | body を消費しない呼び出し元で明示的に破棄/消費 | 呼び出し元が多く漏れやすい。A/B で足りなければ |

有力: **A + B の折衷** — タイマーは残しつつ（body 保護維持）、
「もう誰も body を使わない」ことが確定した時点（throw 時・呼び出し元の
明示破棄）でストリームを畳む。再現テストで各案の効果を確認して決定する。

## テスト

- 再現テストを backend unit テストとして追加（mock サーバー +
  unhandledRejection リスナーで検出）。修正前に赤、修正後に緑であること
- 既存の HttpRequestService / ApRequest 系テストの回帰確認

## 検証（デプロイ後）

- Papertrail: `"Unhandled promise rejection"` の件数がゼロになること
  （計測は `--min-time` + `received_at` フィルタで。`-d` は時間窓として
  機能しないことが判明済み）

## upstream 提出

- 対象は upstream にそのまま存在するコード（fork 固有ではない）
- resync-charts PR と同じ流れ: 本ブランチで計画書込みで開発 →
  fix コミットのみを origin/develop から cherry-pick した clean ブランチ
  （例: `fix/http-request-abort-leak`）を作って PR
- 起票時は creating-issues-and-prs スキルを通す
