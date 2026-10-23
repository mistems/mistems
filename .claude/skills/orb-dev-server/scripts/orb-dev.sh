#!/usr/bin/env bash
# worktree ごとに独立した Misskey 開発サーバー (pnpm dev + PostgreSQL + Redis) を OrbStack 上で動かす。
# ホストにポートを公開しないので、複数の worktree や他プロジェクトと 3000 / 5173 / 5432 / 6379 を取り合わない。
#
# usage: orb-dev.sh <up|down|logs|status> [worktree-path] [-v]
#   up      設定を生成して起動し、起動完了を待って URL を表示する (初回は管理者アカウントも作る)
#   down    停止する。-v を付けると DB・node_modules の volume も消す
#   logs    web コンテナのログを追う
#   status  コンテナの状態と URL を表示する
set -euo pipefail

cmd="${1:-}"
[ $# -gt 0 ] && shift
wt_arg="."
remove_volumes=""
for arg in "$@"; do
	case "$arg" in
		-v|--volumes) remove_volumes="-v" ;;
		*) wt_arg="$arg" ;;
	esac
done

wt="$(cd "$wt_arg" && git rev-parse --show-toplevel)"
# compose のプロジェクト名は [a-z0-9_-] のみ
project="$(basename "$wt" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9_-]+/-/g; s/^-+//; s/-+$//')"
state_dir="${XDG_CACHE_HOME:-$HOME/.cache}/misskey-orb-dev/$project"
url="http://web.$project.orb.local:3000/"
admin_user="admin"
admin_pass="admin1234"
setup_password="example_password_please_change_this_or_you_will_get_hacked"

compose() {
	docker compose -p "$project" -f "$state_dir/compose.yml" "$@"
}

generate() {
	mkdir -p "$state_dir"
	local node_ver pnpm_ver
	node_ver="$(tr -d '[:space:]' < "$wt/.node-version")"
	pnpm_ver="$(sed -nE 's/.*"packageManager": *"pnpm@([^"]+)".*/\1/p' "$wt/package.json")"

	cat > "$state_dir/docker.env" <<-EOF
	POSTGRES_USER=example-misskey-user
	POSTGRES_PASSWORD=example-misskey-pass
	POSTGRES_DB=misskey
	EOF

	# vite は ../../.config/default.yml を固定パスで読むため、生成した設定をそのパスに重ねてマウントする
	awk -v url="$url" -v setup="$setup_password" '
		/^[a-zA-Z]/ { section = $1 }
		/^url: / { print "url: " url; next }
		/^# setupPassword: / { print "setupPassword: " setup; next }
		section == "db:" && /^  host: / { print "  host: db"; next }
		section == "redis:" && /^  host: / { print "  host: redis"; next }
		{ print }
	' "$wt/.config/example.yml" > "$state_dir/default.yml"

	# ホストの node_modules は macOS 向けのネイティブモジュールを含むので、コンテナ側は volume に分ける
	local nm_mounts="      - nm-root:/workspace/node_modules" nm_volumes="  nm-root:" pkg name
	for pkg in "$wt"/packages/*/package.json; do
		name="$(basename "$(dirname "$pkg")")"
		nm_mounts+=$'\n'"      - nm-$name:/workspace/packages/$name/node_modules"
		nm_volumes+=$'\n'"  nm-$name:"
	done

	cat > "$state_dir/compose.yml" <<-EOF
	services:
	  redis:
	    image: redis:7-alpine
	    healthcheck:
	      test: "redis-cli ping"
	      interval: 5s
	      retries: 20
	  db:
	    image: postgres:18-alpine
	    env_file:
	      - ./docker.env
	    volumes:
	      - db-data:/var/lib/postgresql
	    healthcheck:
	      test: "pg_isready -U \$\$POSTGRES_USER -d \$\$POSTGRES_DB"
	      interval: 5s
	      retries: 20
	  web:
	    image: node:$node_ver-bookworm
	    working_dir: /workspace
	    # Node 25 以降の公式イメージには corepack が無いので npm で入れる
	    command: bash -c "npm i -g pnpm@$pnpm_ver && pnpm config set store-dir /pnpm-store && pnpm install --frozen-lockfile && pnpm migrate && pnpm dev"
	    depends_on:
	      db:
	        condition: service_healthy
	      redis:
	        condition: service_healthy
	    volumes:
	      - $wt:/workspace
	      - ./default.yml:/workspace/.config/default.yml:ro
	      - pnpm-store:/pnpm-store
	$nm_mounts
	volumes:
	  db-data:
	  pnpm-store:
	$nm_volumes
	EOF
}

wait_ready() {
	local status
	for _ in $(seq 1 180); do
		if compose logs web 2>/dev/null | grep -q "Now listening"; then
			return 0
		fi
		status="$(compose ps -a web --format '{{.State}}' 2>/dev/null || true)"
		if [ "$status" = "exited" ]; then
			echo "web コンテナが停止しました。ログ:" >&2
			compose logs --tail 30 web >&2
			return 1
		fi
		sleep 5
	done
	echo "15 分待っても起動しませんでした。'$0 logs' で確認してください" >&2
	return 1
}

create_admin() {
	# ユーザーが 1 人もいないときだけ成功する。既にいれば何もしない
	curl -s -X POST "${url}api/admin/accounts/create" \
		-H 'Content-Type: application/json' \
		-d "{\"username\":\"$admin_user\",\"password\":\"$admin_pass\",\"setupPassword\":\"$setup_password\"}" \
		| grep -q '"token"' && echo "管理者アカウントを作成しました: $admin_user / $admin_pass" || true
}

case "$cmd" in
	up)
		generate
		compose up -d
		echo "起動を待っています (初回は依存のインストールで数分かかります)..."
		wait_ready
		create_admin
		echo "起動しました: $url  (ログイン: $admin_user / $admin_pass)"
		;;
	down)
		compose down $remove_volumes
		;;
	logs)
		compose logs -f --tail 100 web
		;;
	status)
		compose ps -a
		echo "URL: $url"
		;;
	*)
		sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
		exit 1
		;;
esac
