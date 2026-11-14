-- DB の中の Misskey のオリジン (url から末尾の / を除いたもの) を書き換える。
-- 添付・アバター・絵文字などの URL は絶対 URL で残るので、環境の url を変えたら (枠を替えた、restore した) これで直す。
-- 書き換える列は決め打ちにせず、public スキーマの通常のテーブルの文字列・json・文字列の配列の列をすべて見る。
-- usage: psql -v ON_ERROR_STOP=1 -v old=<古いオリジン> -v new=<新しいオリジン> < rewrite-url.sql
BEGIN;
-- psql の変数は DO の本体の中では展開されないので、トランザクションの設定値で渡す
SELECT set_config('orb.old', :'old', true), set_config('orb.new', :'new', true) \gset
DO $$
DECLARE
	r record;
	o text := current_setting('orb.old');
	n text := current_setting('orb.new');
	-- アバターのプロキシの url= のように、URL エンコード (encodeURIComponent) された形でも残っている
	oe text := replace(replace(current_setting('orb.old'), ':', '%3A'), '/', '%2F');
	ne text := replace(replace(current_setting('orb.new'), ':', '%3A'), '/', '%2F');
	cnt bigint;
	total bigint := 0;
BEGIN
	IF o = '' OR n = '' OR o = n THEN
		RAISE NOTICE '書き換えません (old=%, new=%)', o, n;
		RETURN;
	END IF;
	FOR r IN
		SELECT c.relname AS tbl, a.attname AS col, format_type(a.atttypid, NULL) AS typ
		FROM pg_attribute a
		JOIN pg_class c ON c.oid = a.attrelid
		JOIN pg_namespace ns ON ns.oid = c.relnamespace
		WHERE ns.nspname = 'public' AND c.relkind = 'r'
			AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''
			AND a.atttypid IN ('text'::regtype, 'varchar'::regtype, 'json'::regtype, 'jsonb'::regtype, 'text[]'::regtype, 'varchar[]'::regtype)
	LOOP
		-- 長さ付きの型 (varchar(512) など) へ明示的にキャストすると、PostgreSQL は黙って切り詰める。
		-- 長さを外した型にキャストし、列への代入で長さを確かめさせる (超えたらエラーで全体が巻き戻る)
		EXECUTE format('UPDATE public.%I SET %I = replace(replace(%I::text, $1, $2), $3, $4)::%s WHERE strpos(%I::text, $1) > 0 OR strpos(%I::text, $3) > 0',
			r.tbl, r.col, r.col, r.typ, r.col, r.col) USING o, n, oe, ne;
		GET DIAGNOSTICS cnt = ROW_COUNT;
		total := total + cnt;
	END LOOP;
	RAISE NOTICE '% を % に書き換えました (% 行)', o, n, total;
END $$;
COMMIT;
