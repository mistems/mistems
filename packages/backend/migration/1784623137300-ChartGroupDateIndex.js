/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

const isConcurrentIndexMigrationEnabled = process.env.MISSKEY_MIGRATION_CREATE_INDEX_CONCURRENTLY === '1';

// 1783062429920-optimize-note-and-relation-indexes.js と同じ流儀。
// CONCURRENTLY はトランザクション内では実行できないため、実際のトランザクション状態を見て判断する。
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

// 冪等な CREATE INDEX。INVALID 残骸は落としてから作り直すため、途中失敗後の再実行に耐える。
async function createIndex(queryRunner, name, ddl) {
	if (await hasValidIndex(queryRunner, name)) return;
	const c = concurrently(queryRunner);
	await queryRunner.query(`DROP INDEX ${c}IF EXISTS "public"."${name}"`);
	await queryRunner.query(`CREATE INDEX ${c}"${name}" ${ddl}`);
}

async function dropIndex(queryRunner, name) {
	await queryRunner.query(`DROP INDEX ${concurrently(queryRunner)}IF EXISTS "public"."${name}"`);
}

// grouped チャートの「特定 group の最新行」取得 (Chart.getLatestLog:
// WHERE "group" = ? ORDER BY "date" DESC LIMIT 1) は、既存の UNIQUE (date, group)
// だとインデックスを日付降順に後方走査しながら group を照合するため、最終更新が
// 古い group (非アクティブユーザー等) でインデックスほぼ全走査になる。
// 実測 (__chart__per_user_notes 1,500 万行): アクティブ group 0.8ms に対し
// 非アクティブ group は 78,000 ブロック読取で 0.8〜11.8 秒。
// (group, date) を先頭列 group で張ることで全 group が直接シークになる。
//
// 大規模インスタンスでは MISSKEY_MIGRATION_CREATE_INDEX_CONCURRENTLY=1 での実行を推奨
// (非 CONCURRENTLY はビルド中チャート書き込みが待たされる)。
export class ChartGroupDateIndex1784623137300 {
	name = 'ChartGroupDateIndex1784623137300';
	transaction = isConcurrentIndexMigrationEnabled ? false : undefined;

	static indexes = [
		['IDX_chart_instance_group_date', '__chart__instance'],
		['IDX_chart_day_instance_group_date', '__chart_day__instance'],
		['IDX_chart_per_user_notes_group_date', '__chart__per_user_notes'],
		['IDX_chart_day_per_user_notes_group_date', '__chart_day__per_user_notes'],
		['IDX_chart_per_user_pv_group_date', '__chart__per_user_pv'],
		['IDX_chart_day_per_user_pv_group_date', '__chart_day__per_user_pv'],
		['IDX_chart_per_user_reaction_group_date', '__chart__per_user_reaction'],
		['IDX_chart_day_per_user_reaction_group_date', '__chart_day__per_user_reaction'],
		['IDX_chart_per_user_following_group_date', '__chart__per_user_following'],
		['IDX_chart_day_per_user_following_group_date', '__chart_day__per_user_following'],
		['IDX_chart_per_user_drive_group_date', '__chart__per_user_drive'],
		['IDX_chart_day_per_user_drive_group_date', '__chart_day__per_user_drive'],
	];

	async up(queryRunner) {
		for (const [name, table] of ChartGroupDateIndex1784623137300.indexes) {
			await createIndex(queryRunner, name, `ON "${table}" ("group", "date")`);
		}
	}

	async down(queryRunner) {
		for (const [name] of ChartGroupDateIndex1784623137300.indexes) {
			await dropIndex(queryRunner, name);
		}
	}
}
