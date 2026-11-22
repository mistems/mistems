/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

const isConcurrentIndexMigrationEnabled = process.env.MISSKEY_MIGRATION_CREATE_INDEX_CONCURRENTLY === '1';

// 1784737840751-username-pattern-index.js と同じ流儀の冪等ヘルパー。
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

// ハッシュタグの検索 (hashtags/search) の `name LIKE 'prefix%'` は、
// 既存の UNIQUE (name) が C ロケール以外の照合順序 (en_US.UTF-8 等) では
// 前方一致に使えないため、hashtag の全件走査になっていた
// (本番 3 台の実測: 139〜169 万行の並列走査で 0.4〜5.7 秒)。
// text_pattern_ops 付きインデックスを追加して前方一致を範囲シークにする。
// 本番で先に手作業 (CREATE INDEX CONCURRENTLY) で作っていても、
// 同名の有効なインデックスがあれば何もしない。
export class HashtagNamePatternIndex1794493981000 {
	name = 'HashtagNamePatternIndex1794493981000';
	transaction = isConcurrentIndexMigrationEnabled ? false : undefined;

	async up(queryRunner) {
		await createIndex(queryRunner, 'IDX_hashtag_name_pattern', 'ON "hashtag" ("name" text_pattern_ops)');
	}

	async down(queryRunner) {
		await dropIndex(queryRunner, 'IDX_hashtag_name_pattern');
	}
}
