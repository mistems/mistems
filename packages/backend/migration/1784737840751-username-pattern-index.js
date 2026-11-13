/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

const isConcurrentIndexMigrationEnabled = process.env.MISSKEY_MIGRATION_CREATE_INDEX_CONCURRENTLY === '1';

// 1783062429920-optimize-note-and-relation-indexes.js と同じ流儀の冪等ヘルパー。
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

// ユーザー検索 (UserSearchService / メンション補完) の
// `usernameLower LIKE 'prefix%'` は、既存の UNIQUE (usernameLower, host) が
// C ロケール以外の照合順序 (en_US.UTF-8 等) では前方一致に使えないため、
// 別インデックスの全走査 + フィルタになっていた
// (実測: 34万ユーザーで 1 キーストロークあたり 320ms〜6.5秒)。
// text_pattern_ops 付きインデックスを追加して前方一致を範囲シークにする。
// 既存の機能インデックス前例: 1767169026317-birthday-index.js
// (エンティティ側で表現できないインデックスは migration のみで管理する)。
export class UsernamePatternIndex1784737840751 {
	name = 'UsernamePatternIndex1784737840751';
	transaction = isConcurrentIndexMigrationEnabled ? false : undefined;

	async up(queryRunner) {
		await createIndex(queryRunner, 'IDX_user_usernameLower_pattern', 'ON "user" ("usernameLower" text_pattern_ops)');
	}

	async down(queryRunner) {
		await dropIndex(queryRunner, 'IDX_user_usernameLower_pattern');
	}
}
