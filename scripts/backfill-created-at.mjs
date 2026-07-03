/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * note テーブルの createdAt を AID から埋め戻すバッチスクリプト
 *
 * ⚠️ お蔵入り (2026-07 考察) — 実行前に以下を読むこと
 *
 * ## createdAt 列はたぶん不要
 *
 * AID から埋める createdAt は id と完全に同じ情報の物質化 (新しい情報は 1 ビットも増えない)。
 * 用途別の結論:
 *
 * - **アプリ内クエリ / 検索**: 不要。既存コードは日付→ID 変換 (idService.gen(date)) で対応済み。
 *   検索高速化は pgroonga + インデックス最適化で対応する
 *   (PGroonga検索Indexブラッシュアップ計画.md / migration 1783062429920)。
 * - **インデックス用途**: 列なしで可能。IMMUTABLE 関数 + 式インデックスで足りる。
 *   フォーク内前例: user_profile.birthday の get_birthday_date() 式インデックス
 *   (packages/backend/migration/1767169026317-birthday-index.js)。
 * - **パーティション分割用途**: createdAt は不要どころか罠。
 *   - 生成列 (GENERATED ALWAYS AS) はパーティションキーに使えない (試して弾かれたのはこれ)。
 *   - 式キー PARTITION BY RANGE ((note_created_at(id))) は IMMUTABLE 関数なら可能だが、
 *     既存クエリは生 id 範囲 (makePaginationQuery) で絞るためプルーニングが一切効かない。
 *   - 正解は **PARTITION BY RANGE (id)**。aid は辞書順 = 時系列順なので id 自体が時間キー。
 *     境界値: (Date.parse('2024-01-01T00:00:00Z') - 946684800000).toString(36).padStart(8, '0') + '00'
 *   - ただし UNIQUE(uri) がグローバル維持できない (ユニーク制約はパーティションキーを含む必要がある)
 *     というブロッカーがあり、フェデレーションの重複排除が DB 制約から消える。
 *     検索目的なら pgroonga + インデックス最適化の実測後に必要性を再考する。
 *
 * ## 「時間型特有の最適化」はなぜ効かないか
 *
 * timestamptz の型としての利点は実在する:
 *   - 固定長 8 バイト (varchar(32) の aid は実体 16B + varlena ヘッダ)。B-tree のエントリも
 *     比較コストも段違い (int64 比較 1 命令 vs 可変長文字列 + collation 処理)
 *   - BRIN との相性 (追記型テーブルの時間列は物理順と強相関 → GB 級 B-tree を KB 級 BRIN に)
 *   - 区間演算 (date_trunc / interval / パーティション境界計算が SQL で素直に書ける)
 *   - エコシステム (pg_partman / TimescaleDB 等は時間列前提)
 *
 * しかしこれらは全部「時間でデータを引く**経路**」に付く利点。Misskey は aid の設計により
 * その経路の役目を id (= PK、最熱インデックス) が先に取っている:
 *   - 既存クエリは 1 本も createdAt を使わない (使わせるには全クエリの書き換えが要る)
 *   - 型の利点は新しい並行アクセス経路を作って初めて発生するが、旧経路 (PK) は消せないので
 *     維持費 (列 + インデックスで GB 級) だけが純増する
 *   - BRIN は text でも動く (min/max はどの順序型でも取れる) ので、欲しければ id に張ればよい
 *
 * 唯一実利が残るのは「2025 年 3 月の投稿数を集計」のような分析系フルスキャン
 * (timestamptz + BRIN が最適) だが、それも上記の id 境界値変換や view で代替できるため、
 * BI 需要が本格化した時点で関数/view で吸収すれば十分。
 *
 * ## それでも実行する場合の注意
 *
 * - 45M 行の UPDATE は non-HOT 更新となり、note の全インデックス (pgroonga 含む) に
 *   新エントリが挿入される → 大規模なブロート + WAL。pgroonga 張り直しの**前**に実行し、
 *   完走後に VACUUM ANALYZE note を実施すること。
 * - 末尾のインデックス再作成は "IDX_note_createdAt" 固定名。落としたインデックスが
 *   別定義 (複合・部分など) だった場合は復元されない。途中クラッシュ時はインデックスが
 *   落ちたままになる (droppedIndexes はプロセス内にしか無い) ので、再実行前に pg_indexes を確認。
 *
 * 使い方:
 *   node scripts/backfill-created-at.mjs
 *
 * 環境変数で接続先を指定（省略時は .config/default.yml を読む）:
 *   PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD
 */

import fs from 'node:fs';
import pg from 'pg';
import * as yaml from 'js-yaml';

// packages/backend/src/misc/id/aid.ts の TIME2000 / parseAid の写し (単体 .mjs のため import 不可)。
// aid.ts 側のフォーマット (現行: 先頭 8 桁 base36 + 2 桁ノイズ) を変更した場合はここも追従すること。
const TIME2000 = 946684800000;
const BATCH_SIZE = 10000;
const MAX_PLAUSIBLE_TS = Date.now() + 24 * 60 * 60 * 1000;

// aid 決め打ち。aidx/meid/ulid/objectid 等の採番方式では時刻を復元できないため、
// 導出結果が非現実的な id を見つけたら即座に中断してゴミ書き込みを防ぐ。
function parseAid(id) {
	const head = id.slice(0, 8);
	if (!/^[0-9a-z]{8}$/.test(head)) {
		throw new Error(`non-aid id encountered: ${id} (この DB の採番方式は aid ではない可能性)`);
	}
	const t = parseInt(head, 36) + TIME2000;
	if (t > MAX_PLAUSIBLE_TS) {
		throw new Error(`implausible timestamp ${new Date(t).toISOString()} for id ${id} (aid 以外の採番方式?)`);
	}
	return new Date(t);
}

function loadConfig() {
	if (process.env.PGDATABASE) {
		return {
			host: process.env.PGHOST ?? 'localhost',
			port: parseInt(process.env.PGPORT ?? '5432'),
			database: process.env.PGDATABASE,
			user: process.env.PGUSER,
			password: process.env.PGPASSWORD,
		};
	}

	for (const path of ['.config/default.yml', '.config/docker_example.yml']) {
		if (fs.existsSync(path)) {
			const cfg = yaml.load(fs.readFileSync(path, 'utf8'));
			return {
				host: cfg.db.host,
				port: cfg.db.port,
				database: cfg.db.db,
				user: cfg.db.user,
				password: cfg.db.pass,
			};
		}
	}

	throw new Error('DB config not found. Set PGDATABASE or create .config/default.yml');
}

async function main() {
	const client = new pg.Client(loadConfig());
	await client.connect();
	console.log('Connected to database.');

	// createdAt インデックスがあれば一時的に削除（UPDATE ごとのインデックス更新を省く）
	const { rows: idxRows } = await client.query(
		`SELECT indexname FROM pg_indexes WHERE tablename = 'note' AND indexdef LIKE '%createdAt%'`,
	);
	const droppedIndexes = [];
	for (const { indexname } of idxRows) {
		console.log(`Dropping index ${indexname} temporarily...`);
		await client.query(`DROP INDEX IF EXISTS "${indexname}"`);
		droppedIndexes.push(indexname);
	}

	let cursor = '0';
	let total = 0;
	let updated = 0;
	const startTime = Date.now();

	let selectMs = 0;
	let updateMs = 0;
	let batchCount = 0;

	for (;;) {
		// IS NULL なしの純粋な PK スキャン — 高速で安定
		const t0 = performance.now();
		const { rows } = await client.query(
			'SELECT id FROM note WHERE id > $1 ORDER BY id ASC LIMIT $2',
			[cursor, BATCH_SIZE],
		);
		const t1 = performance.now();

		if (rows.length === 0) break;

		const ids = rows.map(r => r.id);
		const timestamps = rows.map(r => parseAid(r.id));

		// IS NULL チェックは UPDATE 側で — 既に埋まっている行は書き込みスキップ
		const t2 = performance.now();
		const result = await client.query(
			`UPDATE note SET "createdAt" = v.ts
			 FROM unnest($1::text[], $2::timestamptz[]) AS v(id, ts)
			 WHERE note.id = v.id AND note."createdAt" IS NULL`,
			[ids, timestamps],
		);
		const t3 = performance.now();

		selectMs += t1 - t0;
		updateMs += t3 - t2;
		batchCount++;

		cursor = ids[ids.length - 1];
		total += rows.length;
		updated += result.rowCount;

		if (total % 100000 === 0) {
			const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
			const rate = Math.round(total / (elapsed / 60));
			const avgSelect = (selectMs / batchCount).toFixed(0);
			const avgUpdate = (updateMs / batchCount).toFixed(0);
			console.log(`${total.toLocaleString()} scanned / ${updated.toLocaleString()} updated | ${elapsed}s | ${rate.toLocaleString()}/min | SELECT avg ${avgSelect}ms | UPDATE avg ${avgUpdate}ms`);
			selectMs = 0;
			updateMs = 0;
			batchCount = 0;
		}
	}

	const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
	console.log(`Done. Scanned: ${total.toLocaleString()}, Updated: ${updated.toLocaleString()} in ${elapsed}s`);

	// インデックス再作成
	if (droppedIndexes.length > 0) {
		console.log('Recreating indexes (CONCURRENTLY)...');
		await client.query(`CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_note_createdAt" ON note ("createdAt")`);
		console.log('Index recreated.');
	}

	await client.end();
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
