# リモートノート TTL 再フェッチ 設計書

リモートの絵文字（およびノート差分）が「一度取り込まれると二度と更新されない」問題を、
**ノートを主キーとした TTL 付き遅延再フェッチ**で解消する。

- 対象: `packages/backend`（ActivityPub 取り込み + DB 保存）
- ステータス: 実装済み（PR #35）
- ブランチ: `claude/remote-emoji-refetch-2nbU9`

---

## 1. 大局判断

### 何が問題か

リモート絵文字の情報（画像 URL / ライセンス等）は、**そのリモート絵文字を含むノート・プロフィール・リアクションが新規に届いたときにしか更新されない**。
既存ノートを表示しても再取得は走らないため、リモート側で絵文字が差し替えられてもローカルには古い情報が残り続ける。能動的な再取得手段は存在しない。

### どう解くか

絵文字単体を AP で取りに行くことは**原理的にできない**（後述 2-3）。
絵文字情報は常にノート/プロフィールの `tag` に埋め込まれて配信されるため、

> **「古くなったリモートノートを、参照を契機に再フェッチし、`tag` から絵文字を upsert する」**

という**ノート粒度の再検証**で解く。これは Misskey が既にリモート**ユーザー**に対して実装済みの
「`lastFetchedAt` による 24h TTL 遅延再フェッチ」（後述 2-4）とまったく同じパターンであり、
アーキテクチャ上の前例がある。

### スコープと判断

- **主キー = ノート**（`uri != null` のリモートノート）。
- コアは「**TTL ガード付き再フェッチメソッド 1 本**」。**いつ呼ぶか（実行タイミング）は規定しない** =
  トリガー非依存。自動表示フックは本設計では配線しない。
- 絵文字は**無条件 upsert**（リモート絵文字はめったに変わらず、量はノート単位 TTL で律速されるため、
  条件判定を省いて常に上書きしてよい）。
- 将来 UI に「更新ボタン」を置く場合も、同じコアを `force:false` で呼ぶだけ
  （TTL 内なら無視 / TTL 外なら再フェッチ、が自然に満たされる）。
- **TTL = 4 時間**（決定）。短めにして即応性を確保しつつ、**再取得回数 `refetchedCount` を表示**して
  無駄押しを抑止・透明化する。24h 単純版へ倒す場合は定数 1 行の変更 + `refetchedCount` 不使用で済む。

---

## 2. 調査内容

### 2-1. 絵文字の取り込み・保存の入口

すべて `ApNoteService.extractEmojis()` に集約。呼び出し元は「何かが届いたとき」の 3 経路のみ。

| 経路 | ファイル:行 |
| --- | --- |
| リモートノート受信時 (`note.tag`) | `src/core/activitypub/models/ApNoteService.ts:307` |
| リモートユーザー作成時 (`person.tag`) | `src/core/activitypub/models/ApPersonService.ts:359` |
| リモートユーザー更新時 (`person.tag`) | `src/core/activitypub/models/ApPersonService.ts:512` |
| リアクション(Like)受信時 (`activity.tag`) | `src/core/activitypub/ApInboxService.ts:203` |

### 2-2. DB エンティティ

`src/models/Emoji.ts`
- `@Index(['name', 'host'], { unique: true })` … `name`+`host` で一意（`Emoji.ts:10`）
- `host: string | null` … **null=ローカル / 非null=リモート**（`Emoji.ts:31`）
- 主なカラム: `originalUrl` / `publicUrl` / `uri`(= AP `tag.id`) / `updatedAt` / `license`

`src/models/Note.ts`
- リモートノートは `uri`（`Note.ts:143`, unique index）を持つ。
- **`updatedAt` / `fetchedAt` / `lastFetchedAt` カラムは存在しない**（再フェッチ判定の足場が無い）。

### 2-3. 既存の更新判定ロジック（絵文字）

`src/core/activitypub/models/ApNoteService.ts:383-441` `extractEmojis()`。
既存絵文字は以下 4 条件のいずれかが真のときのみ update（`ApNoteService.ts:400-405`）:

```ts
if ((exists.updatedAt == null)                 // ① updatedAt 未設定
  || (tag.id != null && exists.uri == null)    // ② 初めて uri 取得
  || (new Date(tag.updated) > exists.updatedAt)// ③ リモートの updated が新しい
  || (tag.icon.url !== exists.originalUrl)) {  // ④ 画像 URL が変わった
```

無ければ `insertOne`（`ApNoteService.ts:428`）。
→ いずれにせよ**新規ノート等が届かない限りこの関数自体が呼ばれない**のが問題の本質。

### 2-4. 前例: リモートユーザーの TTL 再フェッチ

`src/core/RemoteUserResolveService.ts:98`（および `ApInboxService.ts:132`）:

```ts
// ユーザー情報が古い場合は、WebFingerからやりなおして返す
if (user.lastFetchedAt == null || Date.now() - user.lastFetchedAt.getTime() > 1000 * 60 * 60 * 24) {
  // 繋がらないインスタンスに何回も試行するのを防ぐ ため 試行前にも更新する
  await this.usersRepository.update(user.id, { lastFetchedAt: new Date() });
  // → resolveSelf / updatePerson → extractEmojis(person.tag) 再実行
}
```

- `MiUser.lastFetchedAt`（`src/models/User.ts:26`）に最終取得時刻、**24h** 超過で再フェッチ。
- 試行**前**に `lastFetchedAt` を先行更新 → 死活不明な鯖への連打・同時多発を抑止。
- 本設計はこれをノートへ写像する。

### 2-5. 既存の再フェッチ手段は無いことの確認

- `ApNoteService.resolveNote()`（`ApNoteService.ts:352`）は `if (exist) return exist;`（`ApNoteService.ts:366`）で即返し、**既存ノートを再取得しない**。
- `ApInboxService.update()`（`ApInboxService.ts:780-804`）は `Update` activity を **Person / Question のみ**処理。**`Update(Note)` ハンドラは無い**（ノート本体の更新ロジックが存在しない）。
- 表示経路 `notes/show`（`src/server/api/endpoints/notes/show.ts:64`）は `getterService.getNoteWithRelations`（DB 読み）→ `pack` で返すだけ。**表示時に AP を叩かない**。
- 絵文字単体の AP オブジェクト URL は dereference 不可: `ApRendererService.renderEmoji()`（`ApRendererService.ts:180`）は `id: ${config.url}/emojis/${name}` を付与するが、`/emojis/:name` を AP オブジェクトとして配信するルートは**存在しない**（確認済み）。→ 絵文字は必ず親（ノート/プロフィール）の `tag` 経由でしか取得できない。

---

## 3. 方針

### 3-1. 設計原則

1. **ノート粒度**の TTL 再検証（主キー = ノート）。
2. コア = **TTL ガード付き再フェッチメソッド 1 本**。トリガー非依存（呼ぶ場所を規定しない）。
3. TTL ガードの意味:
   - `lastFetchedAt` が **TTL 内 → 何もしない（無視）**
   - `lastFetchedAt` が **null / TTL 超過 → 再フェッチ＆更新**
4. 絵文字は **`force` で無条件 upsert**（4 条件をスキップ）。既存呼び出しは挙動不変。
5. 試行前に `lastFetchedAt` 先行更新 + `acquireApObjectLock` で連打・重複を抑止（ユーザー版と同作法）。
6. 再フェッチ・更新は副作用が大きいので**バックグラウンド前提**（同期フェッチ禁止）。
7. 差分反映スコープは**初版は絵文字のみ**。本文/CW/添付は拡張余地として口だけ用意。

### 3-2. 要件との対応

| 要件 | 実現箇所 |
| --- | --- |
| TTL 付き | `NOTE_REFETCH_TTL` 定数 + コアのガード |
| 実行タイミング指定なし | コア `updateNoteIfStale` は呼び出し元を規定しない。自動フックは未配線 |
| 将来ボタン: TTL 外なら再フェッチ / TTL 内なら無視 | ボタンは `updateNoteIfStale(force:false)` を呼ぶだけ。分岐はガードに内包 |

---

## 4. どのファイルのどこをどう直すか

> 凡例: 【新規】= 新規追加 / 【改修】= 既存改修 / 【任意】= 拡張余地（初版で必須ではない）

### 4-1. 【改修】`src/models/Note.ts` — 最終取得時刻カラム追加

`MiUser.lastFetchedAt`（`User.ts:26`）と対称に、`MiNote` へ追加する。
あわせて再取得回数カウンタも追加する。

```ts
// 既存カラム群に追記（例: uri 付近）
@Column('timestamp with time zone', { nullable: true })
public lastFetchedAt: Date | null;

// リモート再フェッチに成功した回数（試行のみ・失敗・クールダウン skip は数えない）
// 既存の denormalize カウンタ (renoteCount/repliesCount/clippedCount/pageCount) と同じ smallint default 0
@Column('smallint', { default: 0 })
public refetchedCount: number;
```

#### fetch 回数をどこに・どう保存するか（保存方針）

**決定（確定）: `note` テーブルに `refetchedCount smallint NOT NULL DEFAULT 0` カラムを 1 本足す。**
別テーブル / Redis 案は不採用。以下はその根拠と、不採用案の記録。

根拠（= これが idiomatic である理由）:

- `note` テーブルには既に **denormalize された smallint カウンタが複数存在する**:
  `renoteCount` / `repliesCount` / `clippedCount` / `pageCount`（`Note.ts:102-122`、すべて `smallint default 0`）。
  `refetchedCount` はこれらと完全に同列の「そのノートに紐づくカウンタ」であり、**既存パターンに従うだけ**。
- 値はノート 1 件に 1 個・上限も小さい（再取得回数が smallint 上限 32767 を超えることは非現実的）。
  → 別テーブルに切り出す必然性がなく、JOIN も増やさない。pack でそのまま返せる。
- 更新は TypeORM の **`repository.increment({ id }, 'refetchedCount', 1)`** で
  アトミックな `UPDATE ... SET refetchedCount = refetchedCount + 1`。競合に強い。
- migration コスト: PostgreSQL 11+ では **定数デフォルト (`DEFAULT 0`) のカラム追加は metadata-only で即時**
  （全行書き換えが走らない）。巨大な `note` テーブルでも実用上問題にならない。

代替案と不採用理由:

| 案 | 内容 | 評価 |
| --- | --- | --- |
| **A: note にカラム追加**（★採用・確定） | `refetchedCount smallint` | 既存カウンタと同型・同パターン。最小で一貫 |
| B: 別テーブル | `note_refetch_stat(noteId, count)` 等 | リモートノートのみ行を持てるが、JOIN/エンティティが増える。1 整数のために過剰 → 不採用 |
| C: Redis カウンタ | ephemeral な INCR | 永続しない＝再起動/expire で消える。「これまで N 回」を恒久表示したいので不適 → 不採用 |
| D: 保存しない（lastFetchedAt のみ） | 回数は出さない | TTL=24h 単純版に倒す場合の選択肢。4h+回数表示の方針では不採用 |

### 4-2. 【新規】migration — `lastFetchedAt` 追加

`packages/backend/migration/{unixMs}-AddNoteLastFetchedAt.js`

- `node -e "console.log(Date.now())"` で UNIX ms を採番、ファイル名に使用。
- クラス名は `AddNoteLastFetchedAt{13桁ms}`、SPDX ヘッダー付与。
- `up`: `ALTER TABLE "note" ADD "lastFetchedAt" TIMESTAMP WITH TIME ZONE` /
  `ALTER TABLE "note" ADD "refetchedCount" smallint NOT NULL DEFAULT 0`
  （定数デフォルトなので PG11+ では metadata-only / 即時）
- `down`: 上記 2 カラムの `DROP COLUMN`
- 生成は `create-migration` skill 推奨。`pnpm --filter backend check-migrations` を通す。

### 4-3. 【改修】`src/core/activitypub/models/ApNoteService.ts` — `extractEmojis` に force

`extractEmojis(tags, host)`（`ApNoteService.ts:383`）のシグネチャに `opts?: { force?: boolean }` を追加し、
既存絵文字の更新判定（`ApNoteService.ts:400-405`）の先頭に `opts?.force ||` を足す。

```ts
public async extractEmojis(tags: IObject | IObject[], host: string, opts?: { force?: boolean }): Promise<MiEmoji[]> {
  ...
  if (exists) {
    if (opts?.force
      || (exists.updatedAt == null)
      || (tag.id != null && exists.uri == null)
      || (new Date(tag.updated) > exists.updatedAt)
      || (tag.icon.url !== exists.originalUrl)) {
      // 既存の update 処理そのまま
    }
    return exists;
  }
  // 既存の insertOne そのまま
}
```

- 既存呼び出し（`ApNoteService.ts:307` / `ApPersonService.ts:359,512` / `ApInboxService.ts:203`）は
  第 3 引数なし = **挙動不変**。再フェッチ経路だけ `{ force: true }`。

### 4-4. 【新規】`src/core/activitypub/models/ApNoteService.ts` — コア `updateNoteIfStale`

TTL ガード付き再フェッチ本体。**トリガー非依存**。

```ts
// 定数（ファイル先頭 or config）
const NOTE_REFETCH_TTL = 1000 * 60 * 60 * 4; // 4h（決定）。24h 版にする場合はここだけ変更

@bindThis
public async updateNoteIfStale(
  note: MiNote,
  opts?: { force?: boolean; resolver?: Resolver },
): Promise<MiNote | null> {
  if (note.uri == null) return note;                          // ローカルは対象外
  if (!this.utilityService.isFederationAllowedUri(note.uri)) return note;

  // --- TTL ガード ---
  if (!opts?.force) {
    const fresh = note.lastFetchedAt != null
      && Date.now() - note.lastFetchedAt.getTime() < NOTE_REFETCH_TTL;
    if (fresh) return note;                                   // TTL 内 → 何もせず現状ノートを返す（黙って返す）
  }

  const unlock = await acquireApObjectLock(this.redisClient, note.uri); // 分散ロック(Redis SET NX)・重複防止
  try {
    // double-checked locking: ロック取得待ちの間に別プロセスが更新済みかもしれないので DB を再読込して再判定
    // （ロックは TTL チェックの後に取るため、これが無いとロック直列化で N 回実フェッチが出得る）
    const current = await this.notesRepository.findOneBy({ id: note.id });
    if (current == null) return null;
    if (!opts?.force && current.lastFetchedAt != null
      && Date.now() - current.lastFetchedAt.getTime() < NOTE_REFETCH_TTL) {
      return current; // 直前に他プロセスが取得済み → 実フェッチしない
    }

    // 連打防止: 試行前に lastFetchedAt のみ先行更新（RemoteUserResolveService.ts:99-102 と同作法）。
    // refetchedCount は「再フェッチ成功時のみ」加算するため、ここでは触らない（PR #35 レビュー反映）。
    await this.notesRepository.update({ id: note.id }, { lastFetchedAt: new Date() });

    const resolver = opts?.resolver ?? await this.apResolverService.createResolver();
    const object = await resolver.resolve(note.uri);          // resolve 成功 = 再フェッチ成功
    await this.notesRepository.increment({ id: note.id }, 'refetchedCount', 1);
    const updated = await this.updateNote(note, object);      // 4-5
    // 購読中クライアントへ通知。クライアントは 'updated' を受けて notes/show を取り直す（§7-2 streaming 化）。
    this.globalEventService.publishNoteStream(note.id, 'updated', { cw: updated.cw, text: updated.text });
    return updated;
  } catch (e) {
    // 失敗種別で分岐（§7-4 デッドゾーン対策）。resolve が throw した場合 refetchedCount は加算されない。
    //  - 恒久失敗(404/410/403): そのまま（必要なら削除追従。lastFetchedAt は進んだまま）
    //  - 一時失敗(5xx/timeout/接続不能): lastFetchedAt を「短い再試行猶予」まで巻き戻す
    //    （= now - (TTL - RETRY_BACKOFF) にして次回試行を RETRY_BACKOFF 後に許可。死活鯖への連打は防ぐ）
    this.logger.debug(`updateNoteIfStale failed: ${e}`);
    return note;
  } finally {
    unlock();
  }
}
```

> 注（PR #35 レビュー反映）: `refetchedCount` は **再フェッチ成功時のみ** 加算する（`resolver.resolve` 成功後に
> `increment`）。失敗時は加算されないため、`refetchedCount` は「成功した再フェッチ回数」を正しく表す。
> `lastFetchedAt` は連打防止のため試行前に先行更新する（成功・失敗を問わず進める。一時失敗時のみ catch で巻き戻す）。
> このため先行更新と count 加算は別 UPDATE に分かれる（旧版の 1 文統合は廃止）。

依存 import の確認（既存利用箇所あり）:
- `acquireApObjectLock` … `resolveNote`（`ApNoteService.ts:362`）で既に使用。
- `notesRepository` … DI 済みか確認、無ければ inject 追加。

### 4-5. 【新規】`src/core/activitypub/models/ApNoteService.ts` — `updateNote`（差分反映）

`Update(Note)` ハンドラが存在しないため新規。**初版は絵文字のみ無条件 upsert**。

```ts
@bindThis
private async updateNote(exist: MiNote, object: IObject): Promise<MiNote> {
  // host は exist 側から取る（actor.host 相当）
  const host = this.utilityService.extractDbHost(exist.uri!);
  // 絵文字を無条件 upsert（extractEmojis 内で DB 更新 + 後述のクラスタ全体キャッシュ無効化を行う）
  await this.extractEmojis(object.tag ?? [], host, { force: true }).catch(e => {
    this.logger.debug(`updateNote extractEmojis failed: ${e}`);
    return [];
  });

  // 【任意】本文/CW/添付の差分反映はここに追加（初版では入れない）

  // lastFetchedAt は updateNoteIfStale 側で更新済み
  return await this.notesRepository.findOneByOrFail({ id: exist.id });
}
```

> **重要（§7-1）**: `extractEmojis` の force update は DB の `emoji` 行を書き換えるだけでは UI に反映されない。
> `CustomEmojiService.emojisCache`（プロセスローカル・12h）を**クラスタ全体で無効化**しない限り、最大 12h
> 古い `publicUrl` が出続ける。これは本機能の主目的が達成されない致命的欠陥なので、§7-1 の対策を必須とする。

補足:
- 既存ノートの emoji 名リスト（`note.emojis`）に追従させたい場合は、ここで `note.emojis` 更新も検討（初版は任意）。
- host 取得は `UtilityService.extractDbHost` 等、リポジトリの既存ユーティリティに合わせる。

### 4-6. 【任意/将来】UI 更新ボタン用エンドポイント

本設計では**配線しない**が、将来像として:

- 新エンドポイント（例 `notes/refetch`、`add-api-endpoint` skill で追加）が
  対象ノートを取得 → `apNoteService.updateNoteIfStale(note, { force: false })` を呼ぶだけ。
- **TTL 内なら無視 / TTL 外なら再フェッチ**という要件はコアのガードでそのまま満たされる
  （ボタン側に分岐ロジック不要）。
- レスポンスで「再フェッチした / TTL 内でスキップした」を返すと UX 上わかりやすい。
- 権限・レート制限は他 `notes/*` に倣う。

### 4-7. エッジケース処理方針

| ケース | 初版の扱い |
| --- | --- |
| 410 Gone / 404 / 403（恒久失敗） | 更新せず `lastFetchedAt` は進めたまま（削除追従は将来検討）。次回は通常 TTL 後 |
| 5xx / timeout / 接続不能（一時失敗） | `lastFetchedAt` を `now - (TTL - RETRY_BACKOFF)` に巻き戻し、`RETRY_BACKOFF`(例 10分) 後に再試行可（デッドゾーン回避、§7-4） |
| フェデレーション禁止 / ブロック鯖 | `isFederationAllowedUri` で早期 return |
| ローカルノート (`uri == null`) | 対象外（早期 return） |

---

## 5. 影響範囲・検証

- **挙動不変**: `extractEmojis` の既存呼び出し（force 無し）はすべて従来通り。
- **新規挙動**: `updateNoteIfStale` を呼ぶ箇所を作らない限り何も起きない（トリガー非依存ゆえ安全に段階導入可能）。
- 検証:
  - `pnpm --filter backend check-migrations`（migration 整合）
  - `pnpm --filter backend typecheck` / `pnpm lint`
- API を追加する場合（4-6）は `pnpm build-misskey-js-with-types` で misskey-js 再生成 + CHANGELOG 追記。

## 6. テスト方針（PR #35 レビュー反映）

AP の実フェッチは **モック**（`resolver.resolve` をスタブ）。federation test（実 2 インスタンス）は難度・不安定さが高いため初版では行わない。

- **unit**（`packages/backend/test/unit/`）— `ApNoteService.updateNoteIfStale` を中心に:
  - TTL ガード: `lastFetchedAt` が TTL(4h) 内のノートを force なしで渡すと resolver が呼ばれず現状ノートが返る。
  - TTL 切れ: `lastFetchedAt` が null / 4h 超で resolver が 1 回呼ばれる。
  - `refetchedCount`: **成功時に +1 / 失敗（resolver throw）時は +0**（本 PR の修正点）。
  - ローカルノート（`uri == null`）は対象外でそのまま返る。
  - per-host バジェット枯渇時は resolve せず現状ノートを返す。
  - 成功時に `publishNoteStream(id, 'updated', ...)` が呼ばれる（streaming 化の検証）。
- **e2e**（`packages/backend/test/e2e/`）— `notes/refetch` エンドポイント:
  - ローカルノート → `IS_LOCAL_NOTE`。
  - 存在しない noteId → `NO_SUCH_NOTE`。
  - 認証なし → requireCredential で弾かれる。
  - （可能なら）リモートノートを用意し、即座に現状ノートが返ることを確認。難しければ unit に寄せる。

---

## 7. 敵対的レビュー反映（負荷・連合・整合性の対策）

AP 連合ネットワーク負荷 / 自サーバー負荷の観点で敵対的レビューを実施し、実コードで裏取りした結果の対策。
**7-1 / 7-2 / 7-3 は実装前に必ず潰すブロッカー。**

### 7-1. 【Critical】emojisCache のクラスタ全体無効化（これが無いと機能が動かない）

- 事実: `populateEmoji`（`CustomEmojiService.ts:389`）は `emojisCache`（`MemoryKVCache`, 12h, **プロセスローカルな Map**）に
  `(name, host)` → `publicUrl` をキャッシュ。`extractEmojis` の update は **このキャッシュを一切無効化しない**
  （`emojisCache.delete` は `cache.ts:241` に存在するが呼ばれていない。`localEmojisCache.refresh()` はローカル絵文字専用）。
- 影響: 再フェッチで DB の `publicUrl` を更新しても、populate は最大 12h 古い URL を返し続け、
  マルチワーカーでは更新を行っていないワーカーは**永遠に古いまま**。= 「ボタンを押しても変わらない」。
- 対策（必須）:
  1. `GlobalEventService` の `InternalEventTypes`（`GlobalEventService.ts:226`）に
     `remoteEmojiUpdated: { name: string; host: string; }` を追加。
  2. `extractEmojis` が force でリモート絵文字行を update した後、`publishInternalEvent('remoteEmojiUpdated', { name, host })` を発行。
  3. `CustomEmojiService` が `redisForSub` の `message` を購読し（先例: `CacheService.ts:120` が同手法で
     MemoryKVCache をクラスタ無効化している）、受信時に `this.emojisCache.delete(`${name} ${host}`)` を実行。
- これにより全ワーカーのプロセスローカルキャッシュが無効化され、次回 populate で新 URL が反映される。

### 7-2. 【High】再フェッチをジョブキューに逃がす（同期 await をやめる）

- 矛盾: Phase 1 原則「再フェッチはバックグラウンド前提（同期フェッチ禁止）」に対し、Phase 2 のエンドポイントは
  リクエスト内で `updateNoteIfStale` を **同期 await** していた。
- 負荷: リモート fetch timeout 5s + 分散ロック取得待機 **最大 5s**（`acquireApObjectLock` = retry 50×100ms, `distributed-lock.ts`）
  + HTML alternate 追加 GET ⇒ **最悪 10s 超、1 リクエストでコネクション/Promise を専有**。遅いリモート指定で連打されると
  API ワーカー枯渇（slow-loris 類似）。
- 対策（実装済み）: `notes/refetch` は TTL 切れ時に **ジョブを refetchNote キューに enqueue して即座に現状ノートを pack して返す**。
  再フェッチ完了時に `updateNoteIfStale` が `publishNoteStream(note.id, 'updated', ...)` を発行し、UI は
  既存の note capture（`useNoteCapture` の `noteUpdated` 購読）が `notes/show` を取り直して反映する
  （PR #35 レビュー反映: setTimeout ポーリングを廃止して streaming 化）。詳細・UX 反映は Phase 2 §3-2 参照。

### 7-3. 【High】リモートホスト単位のフェッチ・スロットル

- 事実: rate limit（`ApiCallService.ts:318`）は **ユーザー単位（`user.id`）**。リモートホスト単位の保護は無い。
  TTL ガードは**ノート単位**なので、別ノートを 30 個ずつ叩けば `30 × U req/h` が単一リモートに集中
  （U=1,000 で約 8.3 req/s 恒常、sockpuppet で青天井）。
- 対策（推奨）: ユーザー単位 rate limit に加え、**per-host のフェッチ予算**（トークンバケット or host 単位 TTL）を導入。
  実フェッチ直前（`updateNoteIfStale` のロック内）でホスト予算を消費し、枯渇時は skip（現状ノートを返す）。

### 7-4. 【Medium】失敗種別の区別とデッドゾーン回避

- 問題: 先行 `lastFetchedAt` 更新 + 失敗の握りつぶしで、一時障害でも「4h に 1 回しか試行できず毎回失敗 → 永遠に更新されない」。
- 対策: catch で **一時失敗（5xx/timeout/接続不能）** と **恒久失敗（404/410/403）** を区別。
  一時失敗時は `lastFetchedAt` を `now - (TTL - RETRY_BACKOFF)`（例 `RETRY_BACKOFF=10分`）に巻き戻し、短い猶予で再試行可に。
  恒久失敗時のみ通常 TTL を進める（§4-7 表に反映済み）。

### 7-5. 【Medium】TTL=4h の再評価

- ユーザー版 24h の **6 倍**。さらに本機能はユーザーがボタンで能動トリガー可能。連合負荷の定量根拠を添えて再評価する。
- 選択肢: ベース 24h・ボタン経由のみ短縮 / per-host スロットル（7-3）前提で 4h 維持。`refetchedCount` 表示は
  心理的抑止にとどまり技術的制約にはならない点に留意。

### 7-6. 【Medium】resolver の制限を明文化

- `signedGet` 経由は `size: 10MB`・`timeout: 5s`・HTML alternate link 追跡で**追加 GET 1 回**が発生し得る
  （AP の `getJson` は 256KB だが本経路は send デフォルトの 10MB）。遅延・サイズ攻撃の面がある。
- 対策: 設計書に制限を明記し、必要なら本経路専用に size 上限を 256KB へ絞る。

### 7-7. 【Low】その他

- **double-checked locking**: ロック取得後に `lastFetchedAt` を再 SELECT して二重フェッチを排除（§4-4 に反映済み）。
- **`lastFetchedAt` と `refetchedCount` の更新タイミング**: `lastFetchedAt` は試行前に先行更新（連打防止）、
  `refetchedCount` は **再フェッチ成功後にのみ** `increment`（PR #35 レビュー反映）。両者は別 UPDATE になる
  （旧版の 1 文統合は「失敗時もカウントされる」問題があったため廃止、§4-4 参照）。
- **`note.emojis` 名リスト追従**: 絵文字が**追加/改名**された場合、`note.emojis`（名前配列）が古いと新絵文字が pack されない。
  主目的（URL 差し替え）なら許容だが、追加/改名まで反映するなら `updateNote` で `note.emojis` も更新する（初版は任意・§4-5 補足）。
- **署名 GET の actor**: instance actor の鍵で取得＝リモートのアクセスログにタイミング相関が残る（既存の初回取得と同主体なので新規リスクは小）。

---

## 8. 実装順序（推奨）

1. `Note.ts` に `lastFetchedAt` / `refetchedCount` 追加 → migration 生成（`create-migration`）→ `check-migrations`。
2. `extractEmojis` に `force` 追加（既存挙動不変を確認）+ **§7-1 のキャッシュ無効化（InternalEvent 発行 + 購読）**。
3. `updateNote` / `updateNoteIfStale` 実装（double-checked locking・失敗種別分岐・**成功時のみ refetchedCount 加算**・
   成功時 `publishNoteStream('updated')` 込み、トリガー未配線）。
4. **§7-3 per-host スロットル**を実フェッチ経路に組み込み。
5. typecheck / lint / unit・e2e テスト（§6。AP はモック）。
6. （Phase 2）`notes/refetch` を **キュー化（§7-2）**して追加 + フロントは streaming で反映 + misskey-js 再生成 + CHANGELOG。
