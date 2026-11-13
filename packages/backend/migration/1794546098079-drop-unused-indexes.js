/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

const isConcurrentIndexMigrationEnabled = process.env.MISSKEY_MIGRATION_CREATE_INDEX_CONCURRENTLY === '1';

// 1783062429920-optimize-note-and-relation-indexes.js と同じ流儀の冪等ヘルパー。
// migration:revert は常にトランザクションで包まれるため、実際のトランザクション状態を見て
// CONCURRENTLY を付けるかを決める。
function concurrently(queryRunner) {
	return isConcurrentIndexMigrationEnabled && !queryRunner.isTransactionActive ? 'CONCURRENTLY ' : '';
}

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

async function createIndex(queryRunner, name, ddl) {
	if (await hasValidIndex(queryRunner, name)) return;
	const c = concurrently(queryRunner);
	await queryRunner.query(`DROP INDEX ${c}IF EXISTS "public"."${name}"`);
	await queryRunner.query(`CREATE INDEX ${c}"${name}" ${ddl}`);
}

async function dropIndex(queryRunner, name) {
	await queryRunner.query(`DROP INDEX ${concurrently(queryRunner)}IF EXISTS "public"."${name}"`);
}

// 本番 3 台 (gamelore / systems / favskey) の pg_stat_user_indexes で、どの台でもほぼ使われて
// おらず、コード上もこのインデックスで引くクエリがないものを消す。
// 理由の詳細は計画書 2026-11-12-使われていないインデックスの整理.md の「A. 消す」。
// 定義は本番の pg_get_indexdef() と同じで、down() はこの定義で作り直す。
//
// hashtag の件数の列は、hashtags/search の前方一致が IDX_hashtag_name_pattern
// (1794493981000) を使うようになってから消す必要がある。この migration はそれより後の
// タイムスタンプなので、必ずそのあとに適用される。
const INDEXES = [
	// drive_file
	['IDX_e5848eac4940934e23dbc17581', 'ON "drive_file" ("uri")'],
	['IDX_a7eba67f8b3fa27271e85d2e26', 'ON "drive_file" ("isSensitive")'],
	['IDX_3b33dff77bb64b23c88151d23e', 'ON "drive_file" ("maybeSensitive")'],
	['IDX_8bdcd3dd2bddb78014999a16ce', 'ON "drive_file" ("maybePorn")'],
	['IDX_a40b8df8c989d7db937ea27cf6', 'ON "drive_file" ("type")'],
	['IDX_315c779174fe8247ab324f036e', 'ON "drive_file" ("isLink")'],
	// note
	['IDX_note_on_threadId', 'ON "note" ("threadId") WHERE "threadId" IS NOT NULL'],
	// user / user_profile
	['IDX_fa99d777623947a5b05f394cae', 'ON "user" ("tags")'],
	['IDX_3befe6f999c86aff06eb0257b4', 'ON "user_profile" ("enableWordMute")'],
	// hashtag
	['IDX_2710a55f826ee236ea1a62698f', 'ON "hashtag" ("mentionedUsersCount")'],
	['IDX_4c02d38a976c3ae132228c6fce', 'ON "hashtag" ("mentionedRemoteUsersCount")'],
	['IDX_d57f9030cd3af7f63ffb1c267c', 'ON "hashtag" ("attachedUsersCount")'],
	['IDX_0e206cec573f1edff4a3062923', 'ON "hashtag" ("mentionedLocalUsersCount")'],
	// emoji / antenna / clip / channel
	['IDX_EMOJI_CATEGORY', 'ON "emoji" ("category")'],
	['IDX_084c2abb8948ef59a37dce6ac1', 'ON "antenna" ("lastUsedAt")'],
	['IDX_a3eac04ae2aa9e221e7596114a', 'ON "clip" ("lastClippedAt")'],
	['IDX_0f58c11241e649d2a638a8de94', 'ON "channel" ("notesCount")'],
	['IDX_094b86cd36bb805d1aa1e8cc9a', 'ON "channel" ("usersCount")'],
	// gallery_post / page / flash
	['IDX_05cca34b985d1b8edc1d1e28df', 'ON "gallery_post" ("tags")'],
	['IDX_3ca50563facd913c425e7a89ee', 'ON "gallery_post" ("fileIds")'],
	['IDX_f2d744d9a14d0dfb8b96cb7fc5', 'ON "gallery_post" ("isSensitive")'],
	['IDX_f631d37835adb04792e361807c', 'ON "gallery_post" ("updatedAt")'],
	['IDX_af639b066dfbca78b01a920f8a', 'ON "page" ("updatedAt")'],
	['IDX_90148bbc2bf0854428786bfc15', 'ON "page" ("visibleUserIds")'],
	['IDX_3aa8ea9a8f15214ad91638c0a7', 'ON "flash" ("updatedAt")'],
];

export class DropUnusedIndexes1794546098079 {
	name = 'DropUnusedIndexes1794546098079';
	transaction = isConcurrentIndexMigrationEnabled ? false : undefined;

	async up(queryRunner) {
		for (const [name] of INDEXES) {
			await dropIndex(queryRunner, name);
		}
	}

	async down(queryRunner) {
		for (const [name, ddl] of INDEXES) {
			await createIndex(queryRunner, name, ddl);
		}
	}
}
