#!/usr/bin/env bash
# rewrite-url.sql のテスト。使い捨ての postgres コンテナで行う。bash seed/rewrite-url.test.sh で実行する
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
name="orb-rewrite-url-test-$$"
docker run -d --rm --name "$name" -e POSTGRES_PASSWORD=x postgres:18-alpine >/dev/null
trap 'docker rm -f "$name" >/dev/null' EXIT
for _ in $(seq 1 60); do docker exec "$name" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1 && break; sleep 1; done
q() { docker exec -i "$name" psql -v ON_ERROR_STOP=1 -U postgres -Atq "$@"; }

q <<'EOF'
CREATE TABLE "user" (id text PRIMARY KEY, "avatarUrl" varchar(512), name varchar(128));
CREATE TABLE emoji (id text PRIMARY KEY, aliases varchar(128)[], "publicUrl" text);
CREATE TABLE user_profile (id text PRIMARY KEY, fields jsonb);
CREATE TABLE counts (id int PRIMARY KEY, n int);
INSERT INTO "user" VALUES ('u1', 'http://web.a.orb.local:3000/files/x.png', 'http://web.a.orb.local:3000 さん'), ('u2', NULL, 'other'), ('u3', 'http://web.a.orb.local:3000/proxy/avatar.webp?url=http%3A%2F%2Fweb.a.orb.local%3A3000%2Ffiles%2Fy&avatar=1', 'enc');
INSERT INTO emoji VALUES ('e1', ARRAY['http://web.a.orb.local:3000/e', 'plain'], 'http://web.a.orb.local:3000/emoji/e1.png');
INSERT INTO user_profile VALUES ('p1', '[{"name":"site","value":"http://web.a.orb.local:3000/@admin"}]');
INSERT INTO counts VALUES (1, 3);
EOF

q -v old=http://web.a.orb.local:3000 -v new=http://dev2.localhost:3080 < "$here/rewrite-url.sql"

fail=0
check() { if [ "$2" = "$3" ]; then echo "ok - $1"; else echo "not ok - $1: 期待 '$3' 実際 '$2'"; fail=1; fi; }
check "varchar" "$(q -c "SELECT \"avatarUrl\" FROM \"user\" WHERE id='u1'")" "http://dev2.localhost:3080/files/x.png"
check "文中の URL" "$(q -c "SELECT name FROM \"user\" WHERE id='u1'")" "http://dev2.localhost:3080 さん"
check "NULL はそのまま" "$(q -c "SELECT coalesce(\"avatarUrl\", 'NULL') FROM \"user\" WHERE id='u2'")" "NULL"
check "配列" "$(q -c "SELECT aliases[1] || ',' || aliases[2] FROM emoji")" "http://dev2.localhost:3080/e,plain"
check "text" "$(q -c "SELECT \"publicUrl\" FROM emoji")" "http://dev2.localhost:3080/emoji/e1.png"
check "jsonb" "$(q -c "SELECT fields->0->>'value' FROM user_profile")" "http://dev2.localhost:3080/@admin"
check "URL エンコードされたオリジン" "$(q -c "SELECT \"avatarUrl\" FROM \"user\" WHERE id='u3'")" "http://dev2.localhost:3080/proxy/avatar.webp?url=http%3A%2F%2Fdev2.localhost%3A3080%2Ffiles%2Fy&avatar=1"
check "数値の列は触らない" "$(q -c "SELECT n FROM counts")" "3"

# 長さの制限を超える書き換えは全体が巻き戻る
q -c "UPDATE \"user\" SET \"avatarUrl\" = 'http://dev2.localhost:3080/' || repeat('a', 480) WHERE id='u1'"
if q -v old=http://dev2.localhost:3080 -v new="http://$(printf 'b%.0s' $(seq 1 60)).localhost:3080" < "$here/rewrite-url.sql" 2>/dev/null; then
	echo "not ok - 長さ超過で失敗すること"; fail=1
else
	check "失敗したら巻き戻る" "$(q -c "SELECT \"publicUrl\" FROM emoji")" "http://dev2.localhost:3080/emoji/e1.png"
fi
exit $fail
