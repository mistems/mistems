# リノートロック機能 設計書

## 概要

ノート単位でリノートを制限する機能。投稿者によるセルフモデレーションと、管理人によるコミュニティモデレーションの両軸を想定する。

---

## 背景・動機

リノートには心理的に異なる二種類の動作がある。

| 種別 | 動作 | 心理的性質 |
|------|------|-----------|
| セルフリノート | 自分が自分のノートをリノートする | 能動的・自発的（笑わせる） |
| 他者によるリノート | 他人が自分のノートをリノートする | 受動的（笑われる） |

現状、他者のリノートを止める手段は **ノートの削除のみ** であり、ユーザーにとってコスト・ストレスが高い。告知や情報共有のようなリノートはありがたいが、意図せず拡散されたくない投稿を保護する手段が必要。

---

## 要件定義

### ユーザーロック（セルフモデレーション）

- 投稿者が自分のノートに設定できる
- **自分はリノート可能**、他者はリノート不可
- オプション: 投稿者が自らリノートしてから一定時間内は、他者のリノートも許可する（時間窓機能）

### 管理人ロック（コミュニティモデレーション）

- モデレーター以上の権限を持つユーザーが任意のノートに設定できる
- **投稿者を含め、誰もリノート不可**（治安維持・過度な拡散抑制）
- 管理人ロックの解除もモデレーター以上のみ可能

---

## データモデル

### `note` テーブルへの追加カラム

| カラム名 | 型 | デフォルト | 説明 |
|---------|---|-----------|------|
| `renoteLock` | `varchar(32)` | `'none'` | ロック種別（下記 enum 参照） |
| `renoteWindowDuration` | `integer` (nullable) | `null` | 時間窓の長さ（分）。`renoteLock = 'self'` 時のみ有効 |

### `renoteLock` の取りうる値

```
'none'   ... ロックなし（デフォルト、誰でもリノート可）
'self'   ... 投稿者のみリノート可（ユーザー設定）
'admin'  ... 全員リノート不可（モデレーター設定）
```

### マイグレーション

```
1780189658202-add-renote-lock.js
```

`up()`: 2カラムを追加  
`down()`: 2カラムを削除

---

## リノート可否の判定ロジック

`NoteCreateService.ts` 内、既存チェック（visibility / block / channel）の後に実行。

```
リノート対象ノートの renoteLock を確認
│
├─ 'admin' → 全員リノート禁止（投稿者自身も不可）
│                → IdentifiableError: 6cf4e0b5-...
│
├─ 'self' かつ リノート実行者 ≠ 投稿者
│    │
│    ├─ renoteWindowDuration が設定されている？
│    │    └─ YES: 投稿者が renoteWindowDuration 分以内にリノートしているか確認
│    │           （note テーブルを userId + renoteId + id（時刻比較）で検索）
│    │           ├─ YES: リノート許可
│    │           └─ NO:  リノート禁止 → IdentifiableError: 0ece2e1a-...
│    │
│    └─ renoteWindowDuration が null（未設定）
│         → リノート禁止 → IdentifiableError: 0ece2e1a-...
│
└─ 'none' → チェックなし（従来通り）
```

時刻比較には `IdService.gen(timestamp)` で生成した ID を使用（MiNote に `createdAt` カラムが存在しないため）。

---

## API

### `notes/update-renote-lock`

| 項目 | 値 |
|------|---|
| 認証 | 必須 |
| kind | `write:notes` |
| レート制限 | 100回/時 |

#### リクエストパラメータ

| パラメータ | 型 | 必須 | 説明 |
|-----------|---|------|------|
| `noteId` | string (misskey:id) | ✅ | 対象ノートの ID |
| `lock` | `'none'｜'self'｜'admin'` | ✅ | 設定するロック種別 |
| `renoteWindowDuration` | integer (0–10080) ｜ null | ❌ | 時間窓（分）。`lock='self'` 時のみ有効 |

#### 権限チェック

```
一般ユーザー:
  - 自分のノートにのみ操作可
  - 'none' / 'self' のみ設定可（'admin' は不可）

モデレーター以上:
  - 任意のノートに操作可
  - 'none' / 'self' / 'admin' すべて設定可
```

#### エラーコード

| コード | 説明 |
|--------|------|
| `NO_SUCH_NOTE` | 対象ノートが存在しない |
| `ACCESS_DENIED` | 他人のノートに操作しようとした（一般ユーザー） |
| `CANNOT_SET_ADMIN_LOCK` | `'admin'` を設定しようとしたが権限不足 |

### `notes/create`（既存エンドポイントへの追加エラー）

| エラーコード | 説明 |
|------------|------|
| `RENOTE_LOCKED` | リノートロックにより禁止 |

---

## フロントエンド

### リノートボタンの非表示条件

`canRenote` computed プロパティの判定ロジック（`MkNote.vue` / `MkNoteDetailed.vue`）:

```
1. visibility が public / home 以外 かつ 投稿者でない → false（従来通り）
2. renoteLock === 'admin' → false（全員非表示）
3. renoteLock === 'self' かつ 閲覧者 ≠ 投稿者 → false
4. それ以外 → true
```

> 注: セルフロック時の時間窓判定はフロントエンド側では行わない（サーバーに委ねる）。ボタンは非表示のまま。

### ノートメニュー（`get-note-menu.ts`）

投稿者またはモデレーター以上がノートメニューを開いた際に「リノートロック」サブメニューを表示。

```
リノートロック（サブメニュー）
├─ [✓] 誰でもリノート可            ← 現在の状態にチェック
├─ [ ] 自分のみリノート可
└─ [ ] リノート禁止（管理人）       ← モデレーター以上にのみ表示
```

選択時は `notes/update-renote-lock` API を即時呼び出し。

---

## misskey-js（型定義）

### `Note` 型への追加

```typescript
renoteLock: 'none' | 'self' | 'admin';
renoteWindowDuration: number | null;
```

### 新規型

```typescript
// entities.ts
export type NotesUpdateRenoteLockRequest = {
  noteId: string;
  lock: 'none' | 'self' | 'admin';
  renoteWindowDuration?: number | null;
};
```

### エンドポイント追加

```typescript
// endpoint.ts
'notes/update-renote-lock': { req: NotesUpdateRenoteLockRequest; res: EmptyResponse };
```

---

## 考慮事項・制約

### フェデレーション（ActivityPub）

- 現時点では `renoteLock` はフェデレーションに含まない（リモートサーバーに伝播しない）
- リモートユーザーによるリノートはサーバー受信時にチェックを挟む必要がある（今後の課題）

### 引用リノート（Quote）

- 引用リノートも純粋リノートと同じロック判定を適用
- 引用は一般にコメント付きのため、セルフロック時も本人の主体的意思が介在するが、一貫性のため制限対象とする

### 時間窓機能の実装詳細

- 時間窓判定は note テーブルへのクエリ 1 本で完結（専用テーブル不要）
- クエリ: `WHERE renoteId = {noteId} AND userId = {authorId} AND id > {sinceId}`
- `sinceId` は `IdService.gen(Date.now() - duration * 60000)` で生成

### 上書きルール

- ユーザーが `'self'` を設定した後、モデレーターが `'admin'` に上書き可
- `'admin'` を `'none'` / `'self'` に戻せるのはモデレーター以上のみ（投稿者は不可）

---

## 変更ファイル一覧

| ファイル | 種別 | 変更内容 |
|---------|------|---------|
| `packages/backend/src/models/Note.ts` | 変更 | `renoteLock`・`renoteWindowDuration` カラム追加 |
| `packages/backend/migration/1780189658202-add-renote-lock.js` | 新規 | DB マイグレーション |
| `packages/backend/src/core/NoteCreateService.ts` | 変更 | ロック判定チェック追加 |
| `packages/backend/src/core/entities/NoteEntityService.ts` | 変更 | packed Note に新フィールド追加 |
| `packages/backend/src/models/json-schema/note.ts` | 変更 | JSON スキーマ更新 |
| `packages/backend/src/server/api/endpoints/notes/update-renote-lock.ts` | 新規 | ロック設定 API エンドポイント |
| `packages/backend/src/server/api/endpoint-list.ts` | 変更 | エンドポイント登録 |
| `packages/backend/src/server/api/endpoints/notes/create.ts` | 変更 | エラー定義・マッピング追加 |
| `packages/backend/src/core/WebhookTestService.ts` | 変更 | ダミーノートに新フィールド追加 |
| `packages/frontend/src/components/MkNote.vue` | 変更 | `canRenote` にロック判定追加 |
| `packages/frontend/src/components/MkNoteDetailed.vue` | 変更 | 同上 |
| `packages/frontend/src/utility/get-note-menu.ts` | 変更 | リノートロックサブメニュー追加 |
| `packages/misskey-js/src/autogen/types.ts` | 変更 | Note 型に新フィールド追加 |
| `packages/misskey-js/src/autogen/entities.ts` | 変更 | 新リクエスト型追加 |
| `packages/misskey-js/src/autogen/endpoint.ts` | 変更 | エンドポイント型追加 |
| `locales/ja-JP.yml` | 変更 | i18n キー追加 |
| `CHANGELOG.md` | 変更 | Unreleased に記載 |

---

## スコープ外
- **フェデレーション対応**: ActivityPub 越しの操作はスコープ外

## 今後の課題

- **時間窓 UI の整備**: ロックをセルフに設定する際に時間窓を対話的に設定できるフォーム
- **管理人ロックの理由記録**: なぜロックしたか管理人側にメモを残せると管理がしやすい
- **ロック履歴**: 誰がいつロックしたかの監査ログ
