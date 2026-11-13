/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

const isConcurrentIndexMigrationEnabled = process.env.MISSKEY_MIGRATION_CREATE_INDEX_CONCURRENTLY === '1';

// 1785227588654-drive-emoji-channel-indexes.js と同じ流儀の冪等ヘルパー。
// CONCURRENTLY はトランザクション内では実行できないため、実際のトランザクション状態を見て判断する
// (migration:revert は常にトランザクションで包むので、revert 時は非 CONCURRENTLY にフォールバックする)。
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

// 冪等な CREATE INDEX。同名の有効なインデックスがあれば何もしない (本番で手動作成済みの環境で
// 作り直さない)。INVALID 残骸だけは落としてから作り直すため、途中失敗後の再実行に耐える。
async function createIndex(queryRunner, name, ddl) {
	if (await hasValidIndex(queryRunner, name)) return;
	const c = concurrently(queryRunner);
	await queryRunner.query(`DROP INDEX ${c}IF EXISTS "public"."${name}"`);
	await queryRunner.query(`CREATE INDEX ${c}"${name}" ${ddl}`);
}

async function dropIndex(queryRunner, name) {
	await queryRunner.query(`DROP INDEX ${concurrently(queryRunner)}IF EXISTS "public"."${name}"`);
}

// ドライブ使用量の集計 (DriveFileEntityService.calcDriveUsageOf:
// SUM(size) WHERE "userId" = ? AND "isLink" = FALSE) を index-only scan にする。
// 既存の ("userId", "isLink") では対象行をすべてヒープから読んで size を取り出していた。
// size を INCLUDE し、isLink = false の部分インデックスにすることで、ヒープを読まずに集計できる。
//
// 本番 (gamelore) で 2026-11-08 に同名・同定義で手動作成し、効果を確認したものを正式採用する
// (ファイル 28,620 件の利用者で、読むバッファ 22,547 → 1,439、358ms → 118ms (コールド))。
// 手動作成済みの環境では createIndex が有効な同名インデックスを見つけてスキップする。
//
// 大規模インスタンスでは MISSKEY_MIGRATION_CREATE_INDEX_CONCURRENTLY=1 での実行を推奨
// (非 CONCURRENTLY ではビルド中 drive_file への書き込みが待たされる)。
export class DriveFileUsageCoveringIndex1794126500691 {
	name = 'DriveFileUsageCoveringIndex1794126500691';
	transaction = isConcurrentIndexMigrationEnabled ? false : undefined;

	async up(queryRunner) {
		await createIndex(queryRunner, 'IDX_drive_file_userId_size_notlink', 'ON "drive_file" ("userId") INCLUDE ("size") WHERE "isLink" = false');
	}

	async down(queryRunner) {
		await dropIndex(queryRunner, 'IDX_drive_file_userId_size_notlink');
	}
}
