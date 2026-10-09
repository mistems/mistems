/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

const isConcurrentIndexMigrationEnabled = process.env.MISSKEY_MIGRATION_CREATE_INDEX_CONCURRENTLY === '1';

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

async function hasPgroonga(queryRunner) {
	const rows = await queryRunner.query(`SELECT 1 FROM pg_extension WHERE extname = 'pgroonga'`);
	return rows.length > 0;
}

// ノート検索 (本文+CW モード) 用の PGroonga 式インデックス。
//
// SearchService の textWithCw 検索は連結式 (COALESCE(cw, '')::text || text) &@~ :q を
// 発行し、この式インデックスのビットマップスキャンを前提とする (式は一字一句一致が必須)。
// OR 形 + 列単独索引の組み合わせはプランナーが PK 逆順スキャンを選んでしまい索引が
// 使われない (本番実測 23.7s → 本式で 1.2s) ため、この形に固定した。
//
// 既に同名・同式のインデックスが手動運用されている環境 (mistems.net) では
// hasValidIndex 検査によりビルドをスキップする。
// PGroonga 拡張が入っていない環境 (素の開発 DB 等) では何もしない。
// sqlPgroonga 以外の fulltextSearch provider で運用する場合もこの索引は不要。
export class PgroongaCwTextCombinedIndex1785395964596 {
	name = 'PgroongaCwTextCombinedIndex1785395964596';
	transaction = isConcurrentIndexMigrationEnabled ? false : undefined;

	async up(queryRunner) {
		if (!(await hasPgroonga(queryRunner))) return;
		if (await hasValidIndex(queryRunner, 'idx_note_cw_and_text_with_pgroonga')) return;
		const c = concurrently(queryRunner);
		await queryRunner.query(`DROP INDEX ${c}IF EXISTS "public"."idx_note_cw_and_text_with_pgroonga"`);
		await queryRunner.query(`CREATE INDEX ${c}"idx_note_cw_and_text_with_pgroonga" ON "note" USING pgroonga ((COALESCE("cw", '')::text || "text"))`);
	}

	async down(queryRunner) {
		if (!(await hasPgroonga(queryRunner))) return;
		await queryRunner.query(`DROP INDEX ${concurrently(queryRunner)}IF EXISTS "public"."idx_note_cw_and_text_with_pgroonga"`);
	}
}
