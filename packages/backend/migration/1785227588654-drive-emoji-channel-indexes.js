/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

const isConcurrentIndexMigrationEnabled = process.env.MISSKEY_MIGRATION_CREATE_INDEX_CONCURRENTLY === '1';

// CONCURRENTLY はトランザクション内では実行できない。migration:run は per-migration の
// transaction = false を尊重するが、migration:revert は常にトランザクションで包む
// (TypeORM MigrationExecutor.undoLastMigration はオーバーライド非対応) ため、
// フラグだけでなく実際のトランザクション状態を見て判断する。revert 時は自動的に
// 非 CONCURRENTLY (ロックあり) にフォールバックする。
function concurrently(queryRunner) {
	return isConcurrentIndexMigrationEnabled && !queryRunner.isTransactionActive ? 'CONCURRENTLY ' : '';
}

// インデックスが現在のスキーマに「存在して有効 (indisvalid)」かを確認する。
// CREATE INDEX IF NOT EXISTS は CONCURRENTLY 途中失敗の INVALID 残骸も「存在する」と
// みなしてスキップしてしまうため、CREATE 側は必ずこの検査を通す。
async function hasValidIndex(queryRunner, name) {
	const rows = await queryRunner.query(
		`SELECT i.indisvalid FROM pg_class c
		 JOIN pg_namespace n ON n.oid = c.relnamespace
		 LEFT JOIN pg_index i ON i.indexrelid = c.oid
		 WHERE n.nspname = current_schema() AND c.relname = $1`,
		[name],
	);
	return rows.length > 0 && rows[0].indisvalid === true;
}

// 冪等な CREATE INDEX。INVALID 残骸は落としてから作り直すため、途中失敗後の再実行に耐える。
// 注意: 同名で「有効だが定義が異なる」インデックスが残っている環境ではそれを正としてスキップする。
async function createIndex(queryRunner, name, ddl) {
	if (await hasValidIndex(queryRunner, name)) return;
	const c = concurrently(queryRunner);
	await queryRunner.query(`DROP INDEX ${c}IF EXISTS "public"."${name}"`);
	await queryRunner.query(`CREATE INDEX ${c}"${name}" ${ddl}`);
}

// 冪等な DROP INDEX。CONCURRENTLY モードでは DROP も CONCURRENTLY にして
// ACCESS EXCLUSIVE ロックを避ける (1783062429920-optimize-note-and-relation-indexes.js と同じ流儀)。
async function dropIndex(queryRunner, name) {
	await queryRunner.query(`DROP INDEX ${concurrently(queryRunner)}IF EXISTS "public"."${name}"`);
}

// 本番 (gamelore) で手動追加され使用実績が確認できたインデックスをブランチに正式採用する。
//
// 1. note ("userId", "channelId") WHERE "channelId" IS NOT NULL
//    チャンネル内投稿数の COUNT (userId = ? AND channelId = ?) 対策。既存の ("userId", "id") では
//    ユーザーの全ノートを走査してから channelId をフィルタするため、投稿数の多いユーザーで
//    数百 ms〜秒級になっていた。channelId は大半 NULL のため部分インデックスで小さく保てる。
// 2. drive_file ("userId", "isLink")
//    ドライブ使用量集計 SUM(size) WHERE userId = ? AND isLink = ? 対策 (本番実測 mean 494 ms × 5,039 回/週)。
// 3. emoji ("category", "name") WHERE "host" IS NULL
//    ローカル絵文字一覧のカテゴリ・名前順ソート (本番実測 44,000 scan/週)。
//
// あわせて drive_file の単独 ("userId") を削除する。("userId", "folderId", "id") と
// 今回の ("userId", "isLink") の先頭列に包含され構造的に全冗長 (1783062429920 の方針 2 と同じ)。
//
// 採用を見送ったもの (本番の手動インデックスのうち):
// - drive_file ("userId", "folderId"): 既存 ("userId", "folderId", "id") の先頭一致で冗長
// - note ("replyId", "userHost"): scan 元はリモートノート掃除ジョブの再帰 JOIN で、
//   既存の部分インデックス IDX_note_on_replyId と等価の仕事しかしていなかった
export class DriveEmojiChannelIndexes1785227588654 {
	name = 'DriveEmojiChannelIndexes1785227588654';
	transaction = isConcurrentIndexMigrationEnabled ? false : undefined;

	async up(queryRunner) {
		await createIndex(queryRunner, 'IDX_note_on_userId_and_channelId', 'ON "note" ("userId", "channelId") WHERE "channelId" IS NOT NULL');
		await createIndex(queryRunner, 'IDX_drive_file_on_userId_and_isLink', 'ON "drive_file" ("userId", "isLink")');
		await createIndex(queryRunner, 'IDX_emoji_on_category_and_name_local', 'ON "emoji" ("category", "name") WHERE "host" IS NULL');

		await dropIndex(queryRunner, 'IDX_860fa6f6c7df5bb887249fba22'); // drive_file (userId) ⊂ (userId, folderId, id) / (userId, isLink)

		// インデックス追加・削除後のプラン選択のために統計を取り直す。
		// トランザクション内 (非 CONCURRENTLY モード) ではロックを commit まで保持したまま
		// ANALYZE が走り停止時間を延ばすだけなので、CONCURRENTLY モードでのみ実行する。
		if (!queryRunner.isTransactionActive) {
			await queryRunner.query(`ANALYZE "note", "drive_file", "emoji"`);
		}
	}

	async down(queryRunner) {
		await createIndex(queryRunner, 'IDX_860fa6f6c7df5bb887249fba22', 'ON "drive_file" ("userId")');

		await dropIndex(queryRunner, 'IDX_note_on_userId_and_channelId');
		await dropIndex(queryRunner, 'IDX_drive_file_on_userId_and_isLink');
		await dropIndex(queryRunner, 'IDX_emoji_on_category_and_name_local');
	}
}
