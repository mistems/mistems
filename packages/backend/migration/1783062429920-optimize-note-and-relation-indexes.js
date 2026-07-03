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
// ACCESS EXCLUSIVE ロックを避ける (1780059833698-NoteIdIndexForPinAndFavorite.js と同じ流儀)。
async function dropIndex(queryRunner, name) {
	await queryRunner.query(`DROP INDEX ${concurrently(queryRunner)}IF EXISTS "public"."${name}"`);
}

// 1. note の NULL が支配的なカラム (replyId / renoteId / threadId / channelId) の単独インデックスを
//    部分インデックス (WHERE ... IS NOT NULL) へ置き換える。これらのカラムへの索引アクセスは
//    等値 / IN のみで、NULL 側は常にフィルタ処理されるため、NULL エントリは索引上の死荷重になっている。
//    channelId はチャンネルタイムライン (channelId = ? ORDER BY id DESC LIMIT n) のために
//    ("channelId", "id" DESC) 複合として復活させる (1651224615271 で単独列に退化していた)。
// 2. 複合 (ユニーク) インデックスの先頭列と重複する単独インデックスを削除する。
//    B-tree は複合インデックスの先頭列だけの検索にも使えるため、これらは構造的に全冗長。
//
// 本番規模 (数千万行) の note に対しては MISSKEY_MIGRATION_CREATE_INDEX_CONCURRENTLY=1 での
// 実行がほぼ必須。非 CONCURRENTLY の場合、CREATE INDEX が SHARE ロック (note への書き込みが
// ビルド完了まで全停止) を取り、さらに DROP INDEX が ACCESS EXCLUSIVE ロックを migration
// トランザクション終了 (commit) まで保持するため、その間 note の読み書きが全停止する。
// また入れ替え中は新旧インデックスが併存するため、対象インデックスサイズぶんのディスク余裕も必要。
export class OptimizeNoteAndRelationIndexes1783062429920 {
	name = 'OptimizeNoteAndRelationIndexes1783062429920';
	transaction = isConcurrentIndexMigrationEnabled ? false : undefined;

	async up(queryRunner) {
		// 新しい部分インデックスを作ってから旧インデックスを落とす (索引なしの窓を作らない)
		await createIndex(queryRunner, 'IDX_note_on_replyId', 'ON "note" ("replyId") WHERE "replyId" IS NOT NULL');
		await createIndex(queryRunner, 'IDX_note_on_renoteId', 'ON "note" ("renoteId") WHERE "renoteId" IS NOT NULL');
		await createIndex(queryRunner, 'IDX_note_on_threadId', 'ON "note" ("threadId") WHERE "threadId" IS NOT NULL');
		await createIndex(queryRunner, 'IDX_note_on_channelId_and_id_desc', 'ON "note" ("channelId", "id" DESC) WHERE "channelId" IS NOT NULL');

		await dropIndex(queryRunner, 'IDX_17cb3553c700a4985dff5a30ff'); // note (replyId)
		await dropIndex(queryRunner, 'IDX_52ccc804d7c69037d558bac4c9'); // note (renoteId)
		await dropIndex(queryRunner, 'IDX_d4ebdef929896d6dc4a3c5bb48'); // note (threadId)
		await dropIndex(queryRunner, 'IDX_f22169eb10657bded6d875ac8f'); // note (channelId)

		await dropIndex(queryRunner, 'IDX_6516c5a6f3c015b4eed39978be'); // following (followerId) ⊂ UNIQUE (followerId, followeeId)
		await dropIndex(queryRunner, 'IDX_24e0042143a18157b234df186c'); // following (followeeId) ⊂ (followeeId, followerHost, isFollowerHibernated)
		await dropIndex(queryRunner, 'IDX_93060675b4a79a577f31d260c6'); // muting (muterId) ⊂ UNIQUE (muterId, muteeId)
		await dropIndex(queryRunner, 'IDX_0627125f1a8a42c9a1929edb55'); // blocking (blockerId) ⊂ UNIQUE (blockerId, blockeeId)
		await dropIndex(queryRunner, 'IDX_13761f64257f40c5636d0ff95e'); // note_reaction (userId) ⊂ UNIQUE (userId, noteId)
		await dropIndex(queryRunner, 'IDX_47f4b1892f5d6ba8efb3057d81'); // note_favorite (userId) ⊂ UNIQUE (userId, noteId)
		await dropIndex(queryRunner, 'IDX_6d8084ec9496e7334a4602707e'); // channel_following (followerId) ⊂ UNIQUE (followerId, followeeId)
		await dropIndex(queryRunner, 'IDX_a27b942a0d6dcff90e3ee9b5e8'); // user (usernameLower) ⊂ UNIQUE (usernameLower, host)

		// 部分インデックス化・インデックス削除後のプラン選択のために統計を取り直す。
		// トランザクション内 (非 CONCURRENTLY モード) では DROP INDEX の ACCESS EXCLUSIVE ロックを
		// commit まで保持したまま ANALYZE が走り停止時間を無駄に延ばすだけなので、
		// ロックフリーな CONCURRENTLY モードでのみ実行する (通常は autoanalyze が追随する)。
		if (!queryRunner.isTransactionActive) {
			await queryRunner.query(`ANALYZE "note", "following", "muting", "blocking", "note_reaction", "note_favorite", "channel_following", "user"`);
		}
	}

	async down(queryRunner) {
		await createIndex(queryRunner, 'IDX_17cb3553c700a4985dff5a30ff', 'ON "note" ("replyId")');
		await createIndex(queryRunner, 'IDX_52ccc804d7c69037d558bac4c9', 'ON "note" ("renoteId")');
		await createIndex(queryRunner, 'IDX_d4ebdef929896d6dc4a3c5bb48', 'ON "note" ("threadId")');
		await createIndex(queryRunner, 'IDX_f22169eb10657bded6d875ac8f', 'ON "note" ("channelId")');

		await dropIndex(queryRunner, 'IDX_note_on_replyId');
		await dropIndex(queryRunner, 'IDX_note_on_renoteId');
		await dropIndex(queryRunner, 'IDX_note_on_threadId');
		await dropIndex(queryRunner, 'IDX_note_on_channelId_and_id_desc');

		await createIndex(queryRunner, 'IDX_6516c5a6f3c015b4eed39978be', 'ON "following" ("followerId")');
		await createIndex(queryRunner, 'IDX_24e0042143a18157b234df186c', 'ON "following" ("followeeId")');
		await createIndex(queryRunner, 'IDX_93060675b4a79a577f31d260c6', 'ON "muting" ("muterId")');
		await createIndex(queryRunner, 'IDX_0627125f1a8a42c9a1929edb55', 'ON "blocking" ("blockerId")');
		await createIndex(queryRunner, 'IDX_13761f64257f40c5636d0ff95e', 'ON "note_reaction" ("userId")');
		await createIndex(queryRunner, 'IDX_47f4b1892f5d6ba8efb3057d81', 'ON "note_favorite" ("userId")');
		await createIndex(queryRunner, 'IDX_6d8084ec9496e7334a4602707e', 'ON "channel_following" ("followerId")');
		await createIndex(queryRunner, 'IDX_a27b942a0d6dcff90e3ee9b5e8', 'ON "user" ("usernameLower")');
	}
}
