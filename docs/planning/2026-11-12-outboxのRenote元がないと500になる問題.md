# outbox で Renote の元のノートがないと 500 になる問題

作成: 2026-11-12。ブランチ案 `fix/outbox-missing-renote`（最新の `origin/develop` から切る）。

## 本番で起きていること

- 連合先が `/users/:id/outbox?page=true` を取ると、500 が返ることがある。2026-11-12 の 0 時〜15 時で、gamelore 44 件、systems 22 件、favskey 12 件（honban-ops の `logs/2026-11-12-アクセスログの点検.md`）
- 外から再現した。原因は 2 種類ある

  | 種類 | 応答 | 例 |
  |---|---|---|
  | (a) Renote の元のノートが DB にない | 0.07 秒で 500。`Could not find any entity of type "MiNote" matching: { "id": "..." }` | gamelore `/users/9e87lhda0n/outbox?page=true&until_id=9ih3psobcm` |
  | (b) クエリが statement timeout | 10.5 秒で 500。`canceling statement due to statement timeout`（code 57014） | gamelore `/users/9azvt07ry4/outbox?page=true` |

## (a) の原因

- `packages/backend/src/server/ActivityPubServerService.ts` の `packActivity()` が、Renote（引用でないもの）のとき `this.notesRepository.findOneByOrFail({ id: note.renoteId })` で元のノートを読む。元のノートがないと例外になり、ページ全体が 500 になる
- `MiNote.renote` には外部キーがない（`packages/backend/src/models/Note.ts` の `@ManyToOne(() => MiNote, { createForeignKeyConstraints: false })`）。元のノートを消しても Renote は消えずに残るので、元のない Renote が実際に DB にある
  - **（2026-11-12 の調査で訂正）** 外部キーを外したのは MISTEMS ではなく本家である。本家の develop のコミット `f2a23fb55e`「ノートの脱CASCADE削除」（2025-07-31）で、`reply`・`renote` の外部キーをやめ、ノートを消しても Renote や返信を連鎖して消さないようにした。したがって **本家のすべてのサーバーで起きる不具合** で、MISTEMS だけの問題ではない
  - 削除の配送（`NoteDeleteService.delete()`）は、元のノートを `findOneBy` で読み、ないときは `Undo(Announce)` の代わりに `Delete(Tombstone)` を送る。同じ考え方が outbox 側に入っていなかった
- 同じパターン（Renote の元を `findOneByOrFail` で読む）がほかにもないか、`grep -rn "renoteId" packages/backend/src | grep -i "OrFail"` で洗い出す。特に `/notes/:id` の Activity（`ActivityPubServerService` の 712 行目付近、`packActivity` を使う）と、配送で Announce を作る箇所

## (a) の直し方（案）

1. `packActivity()` は、元のノートがないとき `null` を返す（`findOneBy`）。outbox はページの `activities` から `null` を除いて返す
   - ページの件数が `limit` より少なくなるが、OrderedCollectionPage の `next`・`prev` はノートの ID で作っているので、ページ送りは壊れない
2. `/notes/:id` の Activity（単体の取得）で元がないときは、404 を返す（または `Tombstone`）。本家の扱い（削除されたノートに何を返すか）に合わせる
3. 元のない Renote をどう扱うか（消すのか、残すのか）は、外部キーを外した設計の判断に従う。この修正では表示（配信）側で飛ばすだけにする

## (a) の修正（2026-11-12 実装）

- 洗い出し: `renoteId` を `findOneByOrFail` で読む箇所は `packActivity()` の 1 か所だけだった。`renderAnnounce` を呼ぶほかの箇所は、`NoteDeleteService`（`findOneBy` で null を扱い済み）と `NoteCreateService`（作成時なので元のノートは手元にある）で、問題はない
- `packActivity()` は、元のノートがないとき `null` を返す
- outbox のページは、`activities` から `null` を除いて返す。件数が `limit` より少なくなることはあるが、`next`・`prev` はノートの ID で作るので、ページ送りは壊れない
- `/notes/:id/activity` は、元のノートがないとき 404 を返す。同じ URL のノートが見つからないときと同じ扱いにした（Tombstone にすると「ノート自体が消された」と読まれるが、Renote 自体は残っているため、404 のほうが実態に近い）
- 元のない Renote を DB から消すかどうかは、本家の設計（脱CASCADE）に従い、この修正では扱わない
- テスト: `test/e2e/fetch-resource.ts` に 2 件足した。Renote の元のノートを `notes/delete` で消したあと、(1) そのユーザーの outbox のページが 200 を返し、Announce を含まず、ほかの投稿の Create は含む、(2) `/notes/:renoteId/activity` が 404 を返す。修正前は 2 件とも失敗し、修正後は `fetch-resource.ts` 全体（86 件）が成功した

## (b) について

- `getUserNotesFromDb()` は `note.userId = :userId AND visibility IN (public, home) AND localOnly = FALSE ORDER BY id DESC LIMIT 20`。`IDX_note_userId_id`（`("userId", "id" DESC)`）が使われるはずだが、ノートの多いユーザーで条件に合う行がまばらだと、多くの行を読む可能性がある
- まず本番の DB で `EXPLAIN (ANALYZE, BUFFERS)` を取る（honban-ops 側で行う。実行するクエリを計画書に書いて、ユーザーに頼む）。この修正のブランチでは (a) を先に直し、(b) は計画書に調査結果を書くところまででよい
- `enableFanoutTimeline` が有効なら Redis から読むはずなので、(b) が DB に落ちる理由（Redis のタイムラインが切れている、`allowPartial: false` で足りない分を DB から読む）も確かめる

## テスト

- 単体テストか e2e で、「Renote の元のノートを消したあと（外部キーがないので Renote は残る）、そのユーザーの outbox が 200 を返し、その Renote を含まない」ことを確かめる。テストの DB は synchronize で作るので、`createForeignKeyConstraints: false` が効き、元を消せるはず
- `/notes/:id` で元のない Renote を取ったときの応答も確かめる

## 本家との関係

- `packActivity()` のコードは本家と同じ。本家でも、外部キーの削除が途中で失敗したときなどに起きうるので、本家に出せる修正にしておく（ただし misskey-dev への PR は作らない。MISTEMS の規約）

## (b) の調査結果（2026-11-12）

### DB に落ちる経路

- `enableFanoutTimeline` が有効でも、outbox は `allowPartial: false`、`useDbFallback: true` で `FanoutTimelineEndpointService.getMiNotes()` を呼ぶ
- Redis の `userTimeline:<userId>`・`userTimelineWithReplies:<userId>` から読んだノートを `noteFilter`（`public`・`home` で、`localOnly` でないもの）で絞り、**20 件に満たなければ、足りない分を `getUserNotesFromDb()` で DB から読む**（`untilId` は Redis で読んだ最後のノートの ID）。Redis が空なら、最初から DB で 20 件を読む
- つまり、次のユーザーでは毎回 DB に落ちる
  - 投稿が少ない、または Redis の保持件数（`perLocalUserUserTimelineCacheMax`）を超える前の古い投稿しかないユーザー
  - 投稿の多くがフォロワー限定・指名・ローカルのみで、公開・ホームの投稿が 20 件に満たないユーザー

### 遅くなる理由の仮説

DB で実行されるクエリは次の形である（`until_id` がないときは `id < ...` もない）。

```sql
SELECT "note".* FROM "note" "note"
WHERE "note"."id" < $1
  AND "note"."userId" = $2
  AND ("note"."visibility" = 'public' OR "note"."visibility" = 'home')
  AND "note"."localOnly" = FALSE
ORDER BY "note"."id" DESC
LIMIT 20;
```

1. **（本命）プランナーが `note` の主キーのインデックスを降順に読み、`userId` で絞るプランを選んでいる。** `ORDER BY id DESC LIMIT 20` は、条件に合う行が新しい側に十分あると見積もると、主キーを逆順に読んで 20 件で止めるプランが安く見える。ところが条件に合う行が 20 件に満たないユーザーでは、止まる行がなく、`note` を古い側の端まで読み続けて 10 秒を超える。上の「毎回 DB に落ちるユーザー」は、まさに条件に合う行が少ないユーザーなので、この形にはまりやすい（「条件に合う行が少ないと LIMIT で止まれない」という点で、`fix/timeline-dbfallback-lateral` で直したホームタイムラインの DB フォールバックと似ている。あちらはフォロー数の多いユーザーを LATERAL で直した）
2. `IDX_note_userId_id`（`("userId", "id" DESC)`）を使っていても、そのユーザーのノートの大半が公開・ホーム以外（またはローカルのみ）だと、ユーザーの全ノートを読んでから捨てる。ただしユーザー 1 人分なので、数万件程度なら 10 秒にはならないはず
3. `IDX_note_userId_id` が本番にない、または壊れている（テストの DB では `("userId", "id")` で作られる。Note.ts のコメント）

### 本番で取ってほしいもの（honban-ops 側。ユーザーに頼む）

対象は 10.5 秒で 500 になった gamelore のユーザー `9azvt07ry4`。重いクエリをもう一度実行させないよう、まず ANALYZE なしの `EXPLAIN` でプランだけを見て、ANALYZE はトランザクションの中で時間を区切って実行する。

```sql
-- 1. インデックスがあるか
SELECT indexname, indexdef FROM pg_indexes
WHERE tablename = 'note' AND indexdef ILIKE '%"userId"%';

-- 2. このユーザーのノートの内訳（IDX_note_userId_id を使うので軽い）
SELECT visibility, "localOnly", count(*) FROM note
WHERE "userId" = '9azvt07ry4' GROUP BY 1, 2;

-- 3. プランだけ（実行しない）。until_id なしの最初のページ
EXPLAIN
SELECT "note".* FROM "note" "note"
WHERE "note"."userId" = '9azvt07ry4'
  AND ("note"."visibility" = 'public' OR "note"."visibility" = 'home')
  AND "note"."localOnly" = FALSE
ORDER BY "note"."id" DESC
LIMIT 20;

-- 4. 3 が Index Scan Backward using "PK_..." on note（主キー）なら、時間を区切って実測する
BEGIN;
SET LOCAL statement_timeout = '15s';
EXPLAIN (ANALYZE, BUFFERS)
SELECT "note".* FROM "note" "note"
WHERE "note"."userId" = '9azvt07ry4'
  AND ("note"."visibility" = 'public' OR "note"."visibility" = 'home')
  AND "note"."localOnly" = FALSE
ORDER BY "note"."id" DESC
LIMIT 20;
ROLLBACK;
```

あわせて、Redis（タイムライン用）のこのユーザーの件数も見る。キーには設定の `redisForTimelines.prefix` が前に付く。

```
LLEN <prefix>:list:userTimeline:9azvt07ry4
LLEN <prefix>:list:userTimelineWithReplies:9azvt07ry4
```

### 結果に応じた直し方（案。EXPLAIN を見てから決める）

- 主キーを逆順に読むプランなら、`getUserNotesFromDb()` で `ORDER BY` を `("userId", "id")` のインデックスに合わせる（例: `ORDER BY "note"."userId", "note"."id" DESC` にして、プランナーに複合インデックスを選ばせる）。別ブランチ `perf/outbox-db-fallback` で扱う
- ユーザーの全ノートを読んで捨てているなら、部分インデックス（`WHERE visibility IN ('public','home') AND NOT "localOnly"`）を検討する。migration が要るので、件数と効果を見てから決める
