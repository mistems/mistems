#!/usr/bin/env bash
# worktree ごとに独立した Misskey 開発サーバー (pnpm dev + PostgreSQL + Redis) を OrbStack 上で動かす。
# ホストにポートを公開しないので、複数の worktree や他プロジェクトと 3000 / 5173 / 5432 / 6379 を取り合わない。
#
# usage: orb-dev.sh <up|down|logs|status|seed|snapshot|restore|variant> [worktree-path] [名前] [-v] [--prod] [--seed]
#   up        設定を生成して起動し、起動完了を待って URL を表示する (初回は管理者アカウントも作る)
#             --lan を付けると、LAN 内の端末 (スマホの実機など) から http://<Mac の LAN の IP アドレス>:<ポート> で開けるようにする。
#             ポートは 3000 から順にホストで空いているものを使う。--lan なしで up し直すと orb.local に戻る
#             --lan-mdns は IP アドレスの代わりに <Mac のホスト名>.local を使う (Android の Chrome は .local を引けない)
#             --prod を付けると pnpm dev の代わりに本番ビルド (pnpm build → migrate → start) で起動する
#             --seed を付けると、起動後にキーの合うスナップショットがあれば restore、なければ seed を実行する
#   down      停止する。-v を付けると DB・node_modules の volume も消す
#   logs      web コンテナのログを追う
#   status    コンテナの状態と URL を表示する
#   seed      起動中の環境に開発用データを入れ、終わったらスナップショット (seed) を取る
#   snapshot  今の DB と files/ を保存する。名前の既定は seed
#   restore   保存した DB と files/ に戻す。名前の既定は seed。キー (最新 migration 名) が合わなければ戻さない
#   variant   統合待ちのブランチを、ベース環境 (既定は mistems-main の worktree) の DB・Redis を使う別のコンテナで動かす
#             classify <branch> | prepare <branch> [base] | up <branch> [base] | down <branch> [-v]
#             | status | up-all <branch>... | down-all [-v]   (<branch> は riin のブランチ名)
set -euo pipefail

# seed のスクリプトは対象の worktree ではなく、このスクリプトと同じ場所のものを web コンテナにマウントして使う
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cmd="${1:-}"
[ $# -gt 0 ] && shift
wt_arg="."
wt_set=""
snap_name="seed"
remove_volumes=""
prod=""
with_seed=""
lan=""
lan_mdns=""
# variant は引数の形が違うので、ここでは解釈せずに variant_main に任せる
[ "$cmd" = "variant" ] || for arg in "$@"; do
	case "$arg" in
		-v|--volumes) remove_volumes="-v" ;;
		--prod) prod="1" ;;
		--seed) with_seed="1" ;;
		--lan) lan="1" ;;
		--lan-mdns) lan="1"; lan_mdns="1" ;;
		-*) echo "不明なオプションです: $arg" >&2; exit 1 ;;
		*)
			# 1 つ目の位置引数は worktree、2 つ目はスナップショットの名前
			if [ -z "$wt_set" ]; then wt_arg="$arg"; wt_set="1"; else snap_name="$arg"; fi
			;;
	esac
done

# スナップショットの名前はファイル名に使うので、パスを含むものや隠しファイルになるものは受け付けない
case "$snap_name" in
	''|.*|*/*)
		echo "スナップショットの名前が不正です: '$snap_name' (空、. で始まる名前、/ を含む名前は使えません)" >&2
		exit 1
		;;
esac

cache_root="${XDG_CACHE_HOME:-$HOME/.cache}/misskey-orb-dev"

# 操作する環境を切り替える。compose / psql_db / wait_ready などはここで決めた変数を使う
# $1: worktree のパス  $2: compose のプロジェクト名 (省略すると worktree のディレクトリ名から作る)
use_env() {
	wt="$1"
	# compose のプロジェクト名は [a-z0-9_-] のみ
	project="${2:-$(basename "$wt" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9_-]+/-/g; s/^-+//; s/-+$//')}"
	state_dir="$cache_root/$project"
	snapshots_dir="$state_dir/snapshots"
	url="http://web.$project.orb.local:3000/"
	# Misskey がコンテナの中で待ち受けるポート。--lan のときは、ホストに公開するポートと同じ番号にする
	listen_port=3000
	lan_host=""
	lan_vite_ports=""
	# 前回 --lan で up した環境なら、status や seed でもその URL を使う
	if [ -f "$state_dir/lan" ]; then
		read -r lan_host listen_port < "$state_dir/lan"
		url="http://$lan_host:$listen_port/"
	fi
}

if [ "$cmd" != "variant" ]; then
	use_env "$(cd "$wt_arg" && git rev-parse --show-toplevel)"
fi
admin_user="admin"
admin_pass="admin1234"
setup_password="example_password_please_change_this_or_you_will_get_hacked"
db_user="example-misskey-user"
db_name="misskey"

compose() {
	docker compose -p "$project" -f "$state_dir/compose.yml" "$@"
}

psql_db() {
	compose exec -T db psql -v ON_ERROR_STOP=1 -U "$db_user" "$db_name" "$@"
}

write_docker_env() {
	cat > "$state_dir/docker.env" <<-EOF
	POSTGRES_USER=$db_user
	POSTGRES_PASSWORD=example-misskey-pass
	POSTGRES_DB=$db_name
	EOF
}

# $wt/.config/example.yml から $state_dir/default.yml を作る。$1: DB の接続先のホスト名
write_default_yml() {
	local db_host="$1"
	# vite は ../../.config/default.yml を固定パスで読むため、生成した設定をそのパスに重ねてマウントする
	# allowedPrivateNetworks: 本番モード (NODE_ENV=production) の Misskey は private IP への取得を遮断する。
	# seed のリモートのアバター・絵文字・添付・インスタンスのアイコンは、この環境自身の orb.local の URL
	# (OrbStack のコンテナの IP は 192.168.x.x / fd07:… の private IP) を proxy 経由で取るので、その範囲を許可する
	awk -v url="$url" -v setup="$setup_password" -v db_host="$db_host" -v port="${listen_port:-3000}" '
		skip_list && /^#  - / { next }
		{ skip_list = 0 }
		/^[a-zA-Z]/ { section = $1 }
		/^url: / { print "url: " url; next }
		/^port: / { print "port: " port; next }
		/^# setupPassword: / { print "setupPassword: " setup; next }
		/^#allowedPrivateNetworks:/ {
			print "allowedPrivateNetworks:"
			print "  - \"127.0.0.0/8\""
			print "  - \"192.168.0.0/16\""
			print "  - \"172.16.0.0/12\""
			print "  - \"fd00::/8\""
			skip_list = 1
			next
		}
		section == "db:" && /^  host: / { print "  host: " db_host; next }
		section == "redis:" && /^  host: / { print "  host: redis"; next }
		{ print }
	' "$wt/.config/example.yml" > "$state_dir/default.yml"
}

# compose.yml の node_modules の volume の行を作る。nm_mounts と nm_volumes に入れる
build_nm_entries() {
	local pkg name
	nm_mounts="      - nm-root:/workspace/node_modules"
	nm_volumes="  nm-root:"
	for pkg in "$wt"/packages/*/package.json; do
		name="$(basename "$(dirname "$pkg")")"
		nm_mounts+=$'\n'"      - nm-$name:/workspace/packages/$name/node_modules"
		nm_volumes+=$'\n'"  nm-$name:"
	done
}

# --lan のときの URL とポートを決める。--lan なしなら orb.local の URL に戻す
#
# url のホストは、既定ではルートのインターフェースの IPv4 アドレスにする (Android の Chrome は mDNS の .local を
# 引けないため)。IP アドレスが変わったら、up --lan し直せば作り直される。
# backend は vite への中継先を「url のホスト名:5173」で作るので、コンテナの中からは Mac の 5173 番へ中継する。
# 5173 番は同じ番号で公開しているので、Mac を経由して自分の vite に戻ってくる。
# --lan-mdns のときは url を <Mac のホスト名>.local にし、コンテナの中だけその名前を 127.0.0.1 に向ける (extra_hosts)
configure_lan() {
	if [ -z "$lan" ]; then
		rm -f "$state_dir/lan"
		url="http://web.$project.orb.local:3000/"
		listen_port=3000
		lan_host=""
		return 0
	fi
	if [ -n "$lan_mdns" ]; then
		lan_host="$(scutil --get LocalHostName).local"
	else
		local iface
		iface="$(route -n get default 2>/dev/null | awk '/interface:/ { print $2 }')"
		lan_host="$( [ -n "$iface" ] && ipconfig getifaddr "$iface" 2>/dev/null || true)"
		if [ -z "$lan_host" ]; then
			echo "LAN の IPv4 アドレスを取れませんでした (既定ルートのインターフェース: ${iface:-なし})。ネットワークにつないでから実行してください" >&2
			exit 1
		fi
	fi
	local prev_port="" p
	[ -f "$state_dir/lan" ] && read -r _ prev_port < "$state_dir/lan"
	listen_port=""
	# この環境が既にそのポートを公開して動いているなら、そのまま使う
	if [ -n "$prev_port" ] && compose port web "$prev_port" >/dev/null 2>&1; then
		listen_port="$prev_port"
	else
		for p in $prev_port $(seq 3000 3099); do
			if ! lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then
				listen_port="$p"
				break
			fi
		done
	fi
	if [ -z "$listen_port" ]; then
		echo "3000〜3099 に空いているポートがありません" >&2
		exit 1
	fi
	# vite の HMR は、ページを開いた端末から 5173 番 (埋め込みは 5174 番) へ直接つなぐ (vite.config.ts の
	# hmr.clientPort が固定)。つながらないと Misskey の起動処理が「読み込みに失敗しました」になるので、同じ番号で公開する
	lan_vite_ports=""
	for p in 5173 5174; do
		if compose port web "$p" >/dev/null 2>&1 || ! lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then
			lan_vite_ports+=" $p"
		elif [ "$p" = 5173 ]; then
			echo "ホストの 5173 番を別のプロセスが使っています。vite の HMR がつながらず画面を開けないので、--lan では起動しません:" >&2
			lsof -nP -iTCP:5173 -sTCP:LISTEN >&2
			exit 1
		else
			echo "注意: ホストの $p 番を別のプロセスが使っているので公開しません。埋め込みのページは開けないことがあります" >&2
		fi
	done
	url="http://$lan_host:$listen_port/"
	mkdir -p "$state_dir"
	echo "$lan_host $listen_port" > "$state_dir/lan"
}

generate() {
	# variant の worktree で普通の up を実行して、variant の compose.yml を上書きしないようにする
	if grep -q 'orb-dev.variant.branch' "$state_dir/compose.yml" 2>/dev/null; then
		echo "$project は variant の環境です。'$0 variant up <branch>' で起動してください。何も変更せずに終了します。" >&2
		exit 1
	fi
	mkdir -p "$state_dir"
	local node_ver pnpm_ver
	node_ver="$(tr -d '[:space:]' < "$wt/.node-version")"
	pnpm_ver="$(sed -nE 's/.*"packageManager": *"pnpm@([^"]+)".*/\1/p' "$wt/package.json")"

	write_docker_env
	write_default_yml db

	# ホストの node_modules は macOS 向けのネイティブモジュールを含むので、コンテナ側は volume に分ける
	local nm_mounts nm_volumes
	build_nm_entries

	# CI=true: modules ディレクトリを作り直すときに、TTY が無いと pnpm install が止まるのを避ける
	local run_cmd="npm i -g pnpm@$pnpm_ver && pnpm config set store-dir /pnpm-store && CI=true pnpm install --frozen-lockfile"
	if [ -n "$prod" ]; then
		run_cmd+=" && NODE_ENV=production pnpm build && pnpm migrate && NODE_ENV=production pnpm start"
	else
		# migrate は built/meta.json (build-pre が書く) と packages/backend/built を読むので、
		# 新しい worktree でも migrate できるよう先に作る。バックエンドのビルドは無いときだけ行う
		run_cmd+=" && pnpm build-pre && { [ -f packages/backend/built/config.js ] || pnpm --filter backend... build; } && pnpm migrate && pnpm dev"
	fi

	# --lan のときだけホストにポートを公開する (configure_lan のコメント参照)
	local lan_entries=""
	if [ -n "$lan_host" ]; then
		lan_entries=$'    ports:\n'"      - \"$listen_port:$listen_port\""
		for p in $lan_vite_ports; do
			lan_entries+=$'\n'"      - \"$p:$p\""
		done
		if [ -n "$lan_mdns" ]; then
			lan_entries+=$'\n    extra_hosts:\n'"      - \"$lan_host:127.0.0.1\""
		fi
	fi

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
	    command: bash -c "$run_cmd"
	    depends_on:
	      db:
	        condition: service_healthy
	      redis:
	        condition: service_healthy
	$lan_entries
	    volumes:
	      - $wt:/workspace
	      - ./default.yml:/workspace/.config/default.yml:ro
	      - $script_dir/seed:/orb-seed:ro
	      - pnpm-store:/pnpm-store
	$nm_mounts
	volumes:
	  db-data:
	  pnpm-store:
	$nm_volumes
	EOF
}

# 今の compose.yml が本番モードかどうか (restore で web を起動し直すときの待ち時間に使う)
is_prod_compose() {
	grep -q 'NODE_ENV=production pnpm start' "$state_dir/compose.yml" 2>/dev/null
}

# web のログに "Now listening" が出るまで待つ。
# $1: ログを見始める時刻 (省略するとコンテナの最初から)。web を起動し直したときに前回のログを拾わないために使う
wait_ready() {
	local since="${1:-}" status limit_min=15 since_args=()
	if is_prod_compose; then limit_min=30; fi
	[ -n "$since" ] && since_args=(--since "$since")
	for _ in $(seq 1 $((limit_min * 12))); do
		if compose logs ${since_args[@]+"${since_args[@]}"} web 2>/dev/null | grep -q "Now listening"; then
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
	echo "$limit_min 分待っても起動しませんでした。'$0 logs' で確認してください" >&2
	return 1
}

create_admin() {
	# ユーザーが 1 人もいないときだけ成功する。既にいれば何もしない
	curl -s -X POST "${url}api/admin/accounts/create" \
		-H 'Content-Type: application/json' \
		-d "{\"username\":\"$admin_user\",\"password\":\"$admin_pass\",\"setupPassword\":\"$setup_password\"}" \
		| grep -q '"token"' && echo "管理者アカウントを作成しました: $admin_user / $admin_pass" || true
}

# seed / snapshot / restore の前に、この worktree の環境が起動していることを確かめる
require_running() {
	local running
	if [ ! -f "$state_dir/compose.yml" ]; then
		echo "この worktree の環境がありません。先に '$0 up $wt' で起動してください" >&2
		exit 1
	fi
	running="$(compose ps --status running --services 2>/dev/null || true)"
	local svc
	for svc in db redis web; do
		if ! printf '%s\n' "$running" | grep -qx "$svc"; then
			echo "環境が起動していません ($svc が動いていません)。先に '$0 up $wt' で起動してください" >&2
			exit 1
		fi
	done
}

# 同じ名前の worktree が別の場所にあると compose のプロジェクトが共有されてしまうので、
# 壊す操作の前に、compose.yml がこの worktree をマウントしていることを確かめる
require_own_project() {
	if ! grep -qxF "      - $wt:/workspace" "$state_dir/compose.yml"; then
		echo "プロジェクト $project の環境は別の worktree のものです ($state_dir/compose.yml が $wt をマウントしていません)。" >&2
		echo "同じディレクトリ名の worktree が複数あるときは、片方の名前を変えてください。何も変更せずに終了します。" >&2
		exit 1
	fi
}

# スナップショットのキー (DB に適用済みの最新 migration 名) を表示する
snapshot_key() {
	local key
	key="$(psql_db -Atc 'SELECT name FROM migrations ORDER BY id DESC LIMIT 1')"
	if [ -z "$key" ]; then
		echo "migration が 1 件も適用されていません。先に up で起動してください" >&2
		return 1
	fi
	echo "$key"
}

do_snapshot() {
	local key dir
	key="$(snapshot_key)"
	dir="$snapshots_dir/$key"
	mkdir -p "$dir"
	echo "スナップショットを保存しています: $snap_name (キー: $key)"
	# 途中で失敗しても前のスナップショットを壊さないよう、一時ファイルに書いてから置き換える
	compose exec -T db pg_dump -Fc -U "$db_user" "$db_name" > "$dir/$snap_name.dump.tmp"
	# ローカルのドライブのファイルは worktree の files/ (コンテナの /workspace/files) にある
	mkdir -p "$wt/files"
	tar -C "$wt/files" -cf "$dir/$snap_name.files.tar.tmp" .
	mv "$dir/$snap_name.dump.tmp" "$dir/$snap_name.dump"
	mv "$dir/$snap_name.files.tar.tmp" "$dir/$snap_name.files.tar"
	echo "保存しました: $dir/$snap_name.dump, $dir/$snap_name.files.tar"
}

# DB と files/ をスナップショットの内容に置き換える。失敗したら 1 を返す
# (呼び出し側の if の中では set -e が効かないので、1 つずつ確かめる)
apply_snapshot() {
	local dir="$1"
	psql_db -q -c 'SET client_min_messages = warning; DROP SCHEMA public CASCADE; CREATE SCHEMA public;' || return 1
	compose exec -T db pg_restore --single-transaction --exit-on-error --no-owner -U "$db_user" -d "$db_name" \
		< "$dir/$snap_name.dump" || return 1
	rm -rf "$wt/files" || return 1
	mkdir -p "$wt/files" || return 1
	tar -C "$wt/files" -xf "$dir/$snap_name.files.tar" || return 1
}

do_restore() {
	local key dir since
	key="$(snapshot_key)"
	dir="$snapshots_dir/$key"
	if [ ! -f "$dir/$snap_name.dump" ] || [ ! -f "$dir/$snap_name.files.tar" ]; then
		echo "今の DB のキー ($key) に合うスナップショット「${snap_name}」がありません。戻さずに終了します。" >&2
		if [ -d "$snapshots_dir" ] && [ -n "$(ls -A "$snapshots_dir" 2>/dev/null)" ]; then
			echo "手元にあるスナップショット (キー/名前):" >&2
			( cd "$snapshots_dir" && find . -name '*.dump' | sed -E 's|^\./||; s|\.dump$||' | sort ) | sed 's/^/  /' >&2
		else
			echo "手元にスナップショットはありません。" >&2
		fi
		echo "migration が進んだときは、'$0 down $wt -v' で環境を消してから '$0 up $wt --seed' で作り直してください。" >&2
		return 1
	fi

	require_own_project
	# 環境に手を付ける前に、スナップショットが最後まで読めることを確かめる。
	# pg_restore -f /dev/null は DB に触らず dump 全体 (データを含む) を読む
	echo "スナップショット「${snap_name}」を確かめています..."
	if ! compose exec -T db pg_restore -f /dev/null < "$dir/$snap_name.dump"; then
		echo "dump が壊れています: $dir/$snap_name.dump 。環境には何も変更せずに終了します。" >&2
		return 1
	fi
	if ! tar -tf "$dir/$snap_name.files.tar" > /dev/null; then
		echo "files の tar が壊れています: $dir/$snap_name.files.tar 。環境には何も変更せずに終了します。" >&2
		return 1
	fi

	echo "スナップショット「${snap_name}」に戻します (キー: $key)"
	compose stop web
	if ! apply_snapshot "$dir"; then
		echo "戻している途中で失敗しました。DB と files/ は戻し切れていない可能性があり、web は止まったままです。" >&2
		echo "戻し直すには、'$0 up $wt' で起動し直してから (空の DB には migrate がかかる) '$0 restore $wt $snap_name' を実行してください。" >&2
		echo "seed のスナップショットなら '$0 up $wt --seed' だけで戻ります。それでも戻らないときは '$0 down $wt -v' で環境を消してから '$0 up $wt --seed' で作り直してください。" >&2
		exit 1
	fi
	# タイムラインやユーザーなどのキャッシュが戻す前の DB を指したままにならないよう、Redis を空にする
	compose exec -T redis redis-cli FLUSHALL > /dev/null
	since="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
	compose start web
	echo "web を起動し直しています..."
	wait_ready "$since"
	echo "戻しました: $url  (ログイン: $admin_user / $admin_pass)"
}

do_seed() {
	# docker compose exec はホストの環境変数を渡さないので、seed の設定に使う変数のうち設定されているものだけ渡す
	local seed_env=() var
	for var in SEED SEED_LOCAL_NOTES SEED_REMOTE_NOTES; do
		if [ -n "${!var:-}" ]; then seed_env+=(-e "$var=${!var}"); fi
	done
	echo "開発用データを入れています (API の段)..."
	compose exec -T web rm -rf /tmp/orb-seed
	if ! compose exec -T ${seed_env[@]+"${seed_env[@]}"} web node /orb-seed/seed.mjs --url "http://localhost:$listen_port" --out /tmp/orb-seed; then
		echo "seed (API の段) が失敗したので止めます。スナップショットは取りません。" >&2
		return 1
	fi
	echo "開発用データを入れています (SQL の段)..."
	# bulk.mjs の出力は BEGIN から COMMIT までの 1 つのトランザクション。途中で失敗すれば何も入らない
	if ! compose exec -T ${seed_env[@]+"${seed_env[@]}"} web node /orb-seed/bulk.mjs --result /tmp/orb-seed/seed-result.json --base-url "$url" \
		| psql_db -q > /dev/null; then
		echo "seed (SQL の段) が失敗したので止めます。スナップショットは取りません。" >&2
		echo "API の段のデータは残っています。'$0 down $wt -v' で環境を消してからやり直してください。" >&2
		return 1
	fi
	echo "開発用データを入れました"
	do_snapshot
}

# ---------------------------------------------------------------------------
# variant: 統合待ちのブランチを、ベース環境 (mistems-main) の隣で個別のコンテナとして動かす
#   ソースは「ベース環境の worktree の HEAD + ブランチ固有の差分」。Redis・files/・pnpm のストアはベース環境のものを使う
#   backend の変更はベース環境の DB をそのまま使い、migration を追加するものは自分の DB (vdb) を持つ
# ---------------------------------------------------------------------------

classify_js="$script_dir/variant/classify.mjs"
self="$script_dir/$(basename "${BASH_SOURCE[0]}")"
# 注意: pipefail なので、パイプの後ろで grep -q を使わない (grep が先に終わると前のコマンドが SIGPIPE で失敗扱いになる)
# 起動の前に必要な空きメモリ (本番ビルド中の web は一時的に多く使う)
variant_min_free_bytes=$((4 * 1024 * 1024 * 1024))

variant_usage() {
	cat >&2 <<-EOF
	usage: $0 variant <subcommand>
	  classify <branch>        種類 (frontend / backend / migration / other) を表示する
	  prepare <branch> [base]  worktree を作り、ブランチ固有の差分を当てる。コンフリクトしたら終了コード 2
	  up <branch> [base]       本番ビルドで起動し、応答するまで待つ
	  down <branch> [-v]       止める。-v で DB (vdb)・node_modules の volume も消す
	  status                   全 variant のブランチ・種類・URL・DB・応答を一覧する
	  up-all <branch>...       prepare と up を 1 本ずつ順に行う (ベース環境は既定のものだけ)
	  down-all [-v]            全 variant を止める
	<branch> は riin のブランチ名 (例: claude/renote-lock-feature-7J0NA)。base はベース環境の worktree (既定は mistems-main の worktree)
	EOF
}

# mistems-main のブランチをチェックアウトしている worktree を表示する
default_base_wt() {
	local found
	found="$(git -C "$script_dir" worktree list --porcelain | awk '
		/^worktree / { path = substr($0, 10) }
		$0 == "branch refs/heads/mistems-main" { print path; exit }
	')"
	if [ -z "$found" ]; then
		echo "mistems-main をチェックアウトしている worktree が見つかりません。ベース環境の worktree を引数で指定してください" >&2
		return 1
	fi
	echo "$found"
}

# 名前を決める。$1: ブランチ名  $2: ベース環境の worktree (省略可)
variant_names() {
	v_branch="$1"
	if [ -n "${2:-}" ]; then
		base_wt="$(cd "$2" && git rev-parse --show-toplevel)"
	else
		base_wt="$(default_base_wt)"
	fi
	use_env "$base_wt"
	base_project="$project"
	v_slug="$(node "$classify_js" --slug "$v_branch")"
	v_wt="$(dirname "$base_wt")/variant-$v_slug"
	v_local_branch="variant/$v_slug"
	v_project="variant-$v_slug"
}

# 名前を決め、ブランチを取ってきて種類と起点を調べる
variant_load() {
	variant_names "$@"
	if ! git -C "$base_wt" fetch -q riin "$v_branch"; then
		echo "riin からブランチ $v_branch を取得できませんでした" >&2
		exit 1
	fi
	local json
	json="$(node "$classify_js" "$base_wt" "riin/$v_branch")"
	v_category="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).category)' "$json")"
	v_fork="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).forkPoint)' "$json")"
}

# variant のブランチにブランチ固有の差分のコミット (件名 "variant: <branch>") があるかどうか
# コンフリクトを解消したあとに直しのコミットを重ねても当て済みと分かるよう、最新のコミットに限らず探す
variant_applied() {
	git -C "$v_wt" log --format=%s "origin/develop..HEAD" | grep -xF "variant: $v_branch" > /dev/null
}

# slug が同じ別のブランチ (claude/foo と fix/foo など) が、この worktree や compose のプロジェクトを使っていれば終了する
require_no_slug_collision() {
	local other
	if [ -d "$v_wt" ]; then
		other="$(git -C "$v_wt" log --format=%s "origin/develop..HEAD" | sed -n 's/^variant: //p' | grep -vxF "$v_branch" || true)"
		if [ -n "$other" ]; then
			echo "$v_wt には別のブランチ ($(printf '%s' "$other" | head -1)) の差分が当たっています。slug ($v_slug) が同じブランチは同時に扱えません。何も変更せずに終了します。" >&2
			exit 1
		fi
	fi
	other="$(docker ps -a --filter "label=com.docker.compose.project=$v_project" --format '{{.Label "orb-dev.variant.branch"}}' | grep -vxF "$v_branch" | grep -v '^$' || true)"
	if [ -n "$other" ]; then
		echo "compose のプロジェクト $v_project は別のブランチ ($(printf '%s' "$other" | head -1)) が使っています。slug ($v_slug) が同じブランチは同時に扱えません。何も変更せずに終了します。" >&2
		exit 1
	fi
}

# variant のブランチが、今のベース環境の HEAD より古いベースから作られていれば注意を表示する (止めはしない)
warn_if_old_base() {
	local base_head
	base_head="$(git -C "$base_wt" rev-parse HEAD)"
	if ! git -C "$v_wt" merge-base --is-ancestor "$base_head" HEAD; then
		echo "注意: $v_wt は、今のベース環境の HEAD ($(git -C "$base_wt" log -1 --format='%h %s')) を含まない、古いベースから作られています。" >&2
		print_rebuild_steps
	fi
}

# variant を作り直す手順を表示する (標準エラー出力)
print_rebuild_steps() {
	echo "  作り直すには: '$0 variant down $v_branch -v' → git -C '$base_wt' worktree remove '$v_wt' → git -C '$base_wt' branch -D '$v_local_branch' → '$0 variant prepare $v_branch' → '$0 variant up $v_branch'" >&2
}

# 当てたときの riin/<branch> の sha を置くファイル。コンフリクトを解消するコミットの案内に使う
applied_sha_file() {
	echo "$(git -C "$v_wt" rev-parse --absolute-git-dir)/orb-dev-variant-sha"
}

# riin のブランチが、variant に当てた版より進んでいれば注意を表示する (止めはしない)
# 当てたコミットの本文の「ブランチ: riin/<branch> (<sha>)」と比べる。
# 本文に sha が無いコミット (以前の案内で手で解消したもの) は、コミットした時刻より新しいコミットがブランチにあるかで判断する
warn_if_branch_moved() {
	local c applied_sha now_sha newer
	c="$(git -C "$v_wt" log --format='%H%x09%s' "origin/develop..HEAD" | awk -F'\t' -v s="variant: $v_branch" '$2 == s { print $1; exit }')"
	[ -n "$c" ] || return 0
	now_sha="$(git -C "$base_wt" rev-parse "riin/$v_branch")"
	applied_sha="$(git -C "$v_wt" log -1 --format=%b "$c" | sed -nE 's/^ブランチ: riin\/.* \(([0-9a-f]+)\)$/\1/p' | head -1)"
	if [ -n "$applied_sha" ]; then
		[ "$applied_sha" = "$now_sha" ] && return 0
		echo "注意: riin/$v_branch は、$v_wt に当てた版 (${applied_sha:0:10}) から進んでいます (今は ${now_sha:0:10})。variant は古い版のままです。" >&2
	else
		newer="$(git -C "$base_wt" rev-list -1 --since="$(git -C "$v_wt" log -1 --format=%cI "$c")" "riin/$v_branch")"
		[ -n "$newer" ] || return 0
		echo "注意: riin/$v_branch に、$v_wt に当てたあとのコミットがあります (今は ${now_sha:0:10})。variant は古い版のままの可能性があります。" >&2
	fi
	print_rebuild_steps
}

variant_report_conflicts() {
	local unmerged
	unmerged="$(git -C "$v_wt" diff --name-only --diff-filter=U)"
	if [ -n "$unmerged" ]; then
		echo "コンフリクトしました。$v_wt で次のファイルを解消してください:" >&2
		printf '%s\n' "$unmerged" | sed 's/^/  /' >&2
		echo "autogen (locale.ts、misskey-js の autogen) は解消せずに生成し直してください。CHANGELOG.md はどちらを取っても構いません。" >&2
	else
		echo "$v_wt にコミットしていない変更があります。" >&2
	fi
	# 当てた版を本文に残し、ブランチが進んだことを warn_if_branch_moved で検出できるようにする
	local sha
	sha="$(cat "$(applied_sha_file)" 2>/dev/null || git -C "$base_wt" rev-parse "riin/$v_branch")"
	# rerere は main-統合.sh と rr-cache を共有するので、variant の解消を記録させない (統合のときに勝手に当たるのを防ぐ)
	echo "解消したら git -C '$v_wt' add -A && git -C '$v_wt' -c rerere.enabled=false commit -m 'variant: $v_branch' -m 'ブランチ: riin/$v_branch ($sha)' でコミットし、もう一度 '$0 variant prepare $v_branch' を実行してください。" >&2
}

# variant で動かすのは backend (種類 2) と migration (種類 3) だけ
require_variant_category() {
	case "$v_category" in
		backend|migration) ;;
		frontend)
			echo "$v_branch は frontend だけの変更です。variant ではなく frontend-variants で確認してください" >&2
			exit 1
			;;
		*)
			echo "$v_branch は frontend・backend・migration のどれにも当たりません (種類: $v_category)。variant では動かしません" >&2
			exit 1
			;;
	esac
}

variant_prepare() {
	variant_load "$@"
	require_variant_category
	require_no_slug_collision

	if [ ! -e "$v_wt" ]; then
		if git -C "$base_wt" show-ref --verify -q "refs/heads/$v_local_branch"; then
			git -C "$base_wt" worktree add -q "$v_wt" "$v_local_branch"
		else
			git -C "$base_wt" worktree add -q -b "$v_local_branch" "$v_wt" HEAD
		fi
		echo "worktree を作りました: $v_wt (ブランチ ${v_local_branch}、元: $(git -C "$v_wt" log -1 --format='%h %s'))"
	fi
	if [ "$(git -C "$v_wt" rev-parse --abbrev-ref HEAD 2>/dev/null || true)" != "$v_local_branch" ]; then
		echo "$v_wt は $v_local_branch をチェックアウトしている worktree ではありません。何も変更せずに終了します。" >&2
		exit 1
	fi

	if variant_applied; then
		echo "当て済みです: $v_wt ($v_local_branch)"
		warn_if_old_base
		warn_if_branch_moved
		return 0
	fi
	if [ -n "$(git -C "$v_wt" status --porcelain)" ]; then
		# 前回の prepare のコンフリクトを解消している途中
		variant_report_conflicts
		exit 2
	fi

	echo "ブランチ固有の差分を当てています: $(git -C "$base_wt" log -1 --format='%h %s' "$v_fork") .. riin/$v_branch"
	git -C "$base_wt" rev-parse "riin/$v_branch" > "$(applied_sha_file)"
	# rerere は main-統合.sh と rr-cache を共有する。variant のコンフリクトと解消を記録させないよう、apply と commit では無効にする
	if git -C "$base_wt" diff --binary "$v_fork" "riin/$v_branch" | git -C "$v_wt" -c rerere.enabled=false apply --3way --index; then
		# 差分がすべてベース環境に入っているときも、当て済みの印としてコミットする
		git -C "$v_wt" -c rerere.enabled=false commit -q --allow-empty -m "variant: $v_branch" \
			-m "起点: $v_fork"$'\n'"ブランチ: riin/$v_branch ($(git -C "$base_wt" rev-parse "riin/$v_branch"))"
		echo "当ててコミットしました: $v_wt ($v_local_branch)"
		warn_if_old_base
		return 0
	fi
	if [ -n "$(git -C "$v_wt" status --porcelain)" ]; then
		variant_report_conflicts
		exit 2
	fi
	echo "差分を当てられませんでした (コンフリクトではない理由で、何も変更していません)。上のエラーを確かめてください" >&2
	exit 1
}

# 動いているコンテナのメモリ使用量の合計 (バイト) を表示する
containers_mem_bytes() {
	docker stats --no-stream --format '{{.MemUsage}}' | awk '
		function tobytes(s,   n, u) {
			n = s + 0; u = s; sub(/^[0-9.]+/, "", u)
			if (u == "KiB") return n * 1024
			if (u == "MiB") return n * 1048576
			if (u == "GiB") return n * 1073741824
			if (u == "TiB") return n * 1099511627776
			if (u == "kB" || u == "KB") return n * 1e3
			if (u == "MB") return n * 1e6
			if (u == "GB") return n * 1e9
			return n
		}
		{ split($0, a, " / "); sum += tobytes(a[1]) }
		END { printf "%.0f\n", sum }
	'
}

fmt_gb() {
	awk -v b="$1" 'BEGIN { printf "%.1fGB", b / 1073741824 }'
}

# OrbStack の VM のメモリからコンテナの使用量の合計を引いた空きが足りなければ、内訳を表示して終了する
# 他のコンテナを止めて空けることはしない
require_free_memory() {
	local total used free
	total="$(docker info --format '{{.MemTotal}}')"
	used="$(containers_mem_bytes)"
	free=$((total - used))
	if [ "$free" -lt "$variant_min_free_bytes" ]; then
		echo "空きメモリが足りないので起動しません: 空き $(fmt_gb "$free") (VM $(fmt_gb "$total") - コンテナ $(fmt_gb "$used"))、必要 $(fmt_gb "$variant_min_free_bytes")" >&2
		echo "コンテナごとの使用量:" >&2
		docker stats --no-stream --format '{{.Name}}\t{{.MemUsage}}' | sed 's/^/  /' >&2
		echo "どのコンテナも止めていません。不要な環境を止めてから、もう一度実行してください。" >&2
		exit 1
	fi
	echo "空きメモリ: $(fmt_gb "$free") (VM $(fmt_gb "$total") - コンテナ $(fmt_gb "$used"))"
}

# コンテナが今回起動してからのログに "Now listening" が出ているかどうか。
# restart policy が no なので、止まったコンテナを起動し直すと前回のログが残っている。起動した時刻より前のログは見ない
container_listening() {
	local started
	started="$(docker inspect -f '{{.State.StartedAt}}' "$1" 2>/dev/null)" || return 1
	docker logs --since "$started" "$1" 2>&1 | grep "Now listening" > /dev/null
}

# 今の環境の web コンテナが動いていて、今回起動してからのログに "Now listening" が出ているかどうか
web_listening() {
	local id
	id="$(compose ps -q web 2>/dev/null || true)"
	[ -n "$id" ] && container_listening "$id"
}

# pnpm install / build を同時に 2 つ実行しないよう、ほかの variant がまだ起動の途中なら終了する
require_no_variant_starting() {
	local name proj
	while IFS=$'\t' read -r name proj; do
		[ -n "$name" ] || continue
		[ "$proj" = "$v_project" ] && continue
		if ! container_listening "$name"; then
			echo "variant のコンテナ $name がまだ起動の途中です。応答するまで待ってから、もう一度実行してください" >&2
			exit 1
		fi
	done < <(docker ps --filter label=orb-dev.variant.branch --format '{{.Names}}	{{.Label "com.docker.compose.project"}}')
}

# variant の compose.yml と default.yml を作る (use_env で variant の環境に切り替えてから呼ぶ)
# $1: 種類 3 で初回に戻すベース環境の seed の dump (空なら戻さない)
generate_variant() {
	local seed_dump="$1"
	mkdir -p "$state_dir"
	local node_ver pnpm_ver db_host run_cmd nm_mounts nm_volumes
	local vdb_service="" vdb_volume="" web_depends=""
	node_ver="$(tr -d '[:space:]' < "$wt/.node-version")"
	pnpm_ver="$(sed -nE 's/.*"packageManager": *"pnpm@([^"]+)".*/\1/p' "$wt/package.json")"
	build_nm_entries

	run_cmd="npm i -g pnpm@$pnpm_ver && pnpm config set store-dir /pnpm-store && CI=true pnpm install --frozen-lockfile && NODE_ENV=production pnpm build"
	if [ "$v_category" = "migration" ]; then
		db_host="vdb"
		# 自分の DB にだけ、このブランチの migration を当てる
		run_cmd+=" && pnpm migrate"
		write_docker_env
		local init_mounts=""
		if [ -n "$seed_dump" ]; then
			mkdir -p "$state_dir/vdb-init"
			cat > "$state_dir/vdb-init/restore-seed.sh" <<-'EOF'
			#!/bin/sh
			# postgres のイメージは、volume が空のとき (初回) だけ docker-entrypoint-initdb.d を実行する
			set -e
			pg_restore --single-transaction --exit-on-error --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB" /orb-seed-dump/seed.dump
			EOF
			init_mounts=$'\n'"      - ./vdb-init:/docker-entrypoint-initdb.d:ro"$'\n'"      - $seed_dump:/orb-seed-dump/seed.dump:ro"
		fi
		vdb_service="  vdb:
    image: postgres:18-alpine
    env_file:
      - ./docker.env
    volumes:
      - vdb-data:/var/lib/postgresql$init_mounts
    healthcheck:
      # 初回の restore の間は unix socket でしか待ち受けないので、TCP で確かめて restore が終わるのを待つ
      test: \"pg_isready -h 127.0.0.1 -U \$\$POSTGRES_USER -d \$\$POSTGRES_DB\"
      interval: 5s
      start_period: 30m
      start_interval: 5s
      retries: 20"
		vdb_volume="  vdb-data:"
		web_depends="    depends_on:
      vdb:
        condition: service_healthy"
	else
		# ベース環境の DB をそのまま使う。ベース環境の DB を変えないよう migrate はしない
		db_host="db"
	fi
	run_cmd+=" && NODE_ENV=production pnpm start"
	write_default_yml "$db_host"

	cat > "$state_dir/compose.yml" <<-EOF
	services:
	$vdb_service
	  web:
	    image: node:$node_ver-bookworm
	    working_dir: /workspace
	    command: bash -c "$run_cmd"
	    environment:
	      # キューのワーカーとデーモン (チャートの集計など) を起動しない
	      MK_ONLY_SERVER: "1"
	      MK_NO_DAEMONS: "1"
	    labels:
	      orb-dev.variant.branch: "$v_branch"
	      orb-dev.variant.category: "$v_category"
	      orb-dev.variant.base: "$base_project"
	    # ベース環境の network に繋ぎ、redis (と種類 2 では db) はベース環境のものを使う
	    # compose はサービス名を必ず別名に足すので、ベースの network では web がベースと variant の両方を指す。
	    # ベース環境の中では web という名前で通信しないこと (Misskey と seed は orb.local の URL を使うので影響しない)
	    networks:
	      - default
	      - base
	$web_depends
	    volumes:
	      - $wt:/workspace
	      - ./default.yml:/workspace/.config/default.yml:ro
	      - $base_wt/files:/workspace/files
	      - base-pnpm-store:/pnpm-store
	$nm_mounts
	networks:
	  base:
	    name: ${base_project}_default
	    external: true
	volumes:
	  base-pnpm-store:
	    name: ${base_project}_pnpm-store
	    external: true
	$vdb_volume
	$nm_volumes
	EOF
	# 種類 2 では vdb の行と depends_on の行が空になるので、空行を消す
	sed -i '' '/^$/d' "$state_dir/compose.yml"
}

# variant の worktree の migration のうち最新のもの (TypeORM と同じく、class 名の末尾 13 桁の時刻で比べる) の名前を表示する
newest_migration_in_wt() {
	grep -hoE '^export class [A-Za-z0-9_]+' "$v_wt"/packages/backend/migration/*.js \
		| sed -E 's/^export class //' \
		| awk 'match($0, /[0-9]{13}$/) { print substr($0, RSTART), $0 }' \
		| sort -n | tail -1 | cut -d' ' -f2
}

# 種類 2 は migration を追加せず、ベース環境の DB をそのまま使う。variant の worktree の最新の migration が
# ベース DB の最新と違えば (main-統合.sh のあとにベース環境を作り直していないなど)、起動しても列や表が無いエラーで
# 画面が壊れる。応答はするので起動は成功して見える。違えば案内を表示して終了する (ベース環境は作り直さない)
# use_env でベース環境に切り替えてから呼ぶ
require_base_db_matches_migrations() {
	local wt_newest db_newest
	wt_newest="$(newest_migration_in_wt)"
	db_newest="$(psql_db -Atc 'SELECT name FROM migrations ORDER BY timestamp DESC LIMIT 1')"
	[ "$wt_newest" = "$db_newest" ] && return 0
	echo "ベース環境 ($base_project) の DB の migration が、$v_wt と合いません。" >&2
	echo "  $v_wt の最新の migration: ${wt_newest:-(なし)}" >&2
	echo "  ベース DB に当たっている最新の migration: ${db_newest:-(なし)}" >&2
	echo "種類 2 の variant はベース DB をそのまま使うので、このままでは動きません。どの環境も変更していません。" >&2
	echo "main-統合.sh で mistems-main を作り直したあとなら、ベース環境と variant を作り直してください (variant-prep スキルの「main-統合.sh のあとの再実行」の節)。" >&2
	echo "variant の worktree だけが古いなら、作り直すと合います:" >&2
	print_rebuild_steps
	exit 1
}

# variant の web コンテナが動いていて、今回起動してからのログに "Now listening" が出ているかどうか
web_ready() {
	[ -f "$state_dir/compose.yml" ] || return 1
	compose ps --status running --services 2>/dev/null | grep -x web > /dev/null || return 1
	web_listening
}

variant_up() {
	variant_load "$@"
	require_variant_category
	if [ ! -d "$v_wt" ] || ! variant_applied; then
		echo "$v_branch はまだ用意できていません。先に '$0 variant prepare $v_branch' を実行してください" >&2
		exit 1
	fi
	require_no_slug_collision
	warn_if_old_base
	warn_if_branch_moved

	# 種類 2 は、起動済みかどうかに関わらず、ベース DB の migration と合っているかを確かめる
	if [ "$v_category" = "backend" ]; then
		use_env "$base_wt"
		require_running
		require_base_db_matches_migrations
	fi

	use_env "$v_wt" "$v_project"
	if web_ready; then
		echo "既に起動しています: $url  (作り直すときは '$0 variant down $v_branch' してから up してください)"
		return 0
	fi

	# ベース環境が動いていて、起動し終わっていることを確かめる
	use_env "$base_wt"
	require_running
	require_own_project
	if ! web_listening; then
		echo "ベース環境 ($base_project) がまだ起動の途中です。応答するまで待ってから、もう一度実行してください" >&2
		exit 1
	fi
	if ! docker volume inspect "${base_project}_pnpm-store" > /dev/null 2>&1; then
		echo "ベース環境の pnpm のストア (${base_project}_pnpm-store) がありません" >&2
		exit 1
	fi
	mkdir -p "$base_wt/files"

	# 種類 3 は、自分の DB の volume がまだ無いとき (初回) だけ、ベース環境の seed のスナップショットを戻す
	local seed_dump="" key
	if [ "$v_category" = "migration" ] && ! docker volume inspect "${v_project}_vdb-data" > /dev/null 2>&1; then
		key="$(snapshot_key)"
		seed_dump="$snapshots_dir/$key/seed.dump"
		if [ ! -f "$seed_dump" ]; then
			echo "ベース環境の seed のスナップショットがありません: $seed_dump" >&2
			echo "先に '$0 up $base_wt --prod --seed' でベース環境に seed を入れてください" >&2
			exit 1
		fi
	fi

	require_no_variant_starting
	require_free_memory

	use_env "$v_wt" "$v_project"
	generate_variant "$seed_dump"
	if [ "$v_category" = "migration" ]; then
		start_vdb
	fi
	# 止まっていた web を起動し直すときに、前回のログの "Now listening" を拾わないよう、起動する前の時刻から見る
	local since
	since="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
	compose up -d
	echo "起動を待っています (本番ビルドがあるので数分〜十数分かかります)..."
	wait_ready "$since"
	echo "起動しました: $url  (ブランチ: ${v_branch}、種類: $v_category)"
}

# vdb だけを消してやり直す手順を表示する。down -v は node_modules の volume も消し、依存のインストールからやり直しになるので使わない
print_vdb_retry_steps() {
	echo "'$0 variant down $v_branch' で止め、docker volume rm '${project}_vdb-data' で vdb だけを消してから、もう一度 '$0 variant up $v_branch' を実行してください" >&2
}

# 種類 3 の vdb を先に起動し、seed が入っていることを確かめる。
# 初回の restore が失敗すると、データディレクトリは初期化済みの空の DB のまま残り、次の起動では initdb.d を実行しない。
# そのまま web を起動すると、空の DB に migrate がかかって seed の無い環境が正常に起動したように見えるので、ここで止める
start_vdb() {
	local admins
	echo "vdb を起動しています (初回はベース環境の seed を戻すので数分かかります)..."
	if ! compose up -d --wait vdb; then
		echo "vdb が起動しませんでした。ログ:" >&2
		compose logs --tail 30 vdb >&2
		print_vdb_retry_steps
		exit 1
	fi
	# seed には管理者 admin がいる。表が無い (restore されていない) ときも 0 とみなす
	admins="$(compose exec -T vdb psql -U "$db_user" "$db_name" -Atc \
		"SELECT count(*) FROM \"user\" WHERE \"usernameLower\" = 'admin' AND host IS NULL" 2>/dev/null || true)"
	if [ "$admins" != "1" ]; then
		echo "vdb に seed が入っていません (初回の restore が失敗した可能性があります)。web は起動しません。" >&2
		print_vdb_retry_steps
		exit 1
	fi
}

variant_down() {
	local slug
	slug="$(node "$classify_js" --slug "$1")"
	use_env "" "variant-$slug"
	if [ ! -f "$state_dir/compose.yml" ]; then
		echo "variant の環境がありません: $project ($state_dir/compose.yml がありません)" >&2
		exit 1
	fi
	compose down $remove_volumes
}

# variant の compose のプロジェクト名を 1 行ずつ表示する (コンテナのラベルと、生成した compose.yml から集める)
variant_projects() {
	{
		docker ps -a --filter label=orb-dev.variant.branch --format '{{.Label "com.docker.compose.project"}}'
		local f
		for f in "$cache_root"/variant-*/compose.yml; do
			# 名前が variant- で始まる普通の worktree の環境は含めない
			if grep -q 'orb-dev.variant.branch' "$f" 2>/dev/null; then basename "$(dirname "$f")"; fi
		done
	} | sort -u
}

variant_down_all() {
	local p
	while IFS= read -r p; do
		[ -n "$p" ] || continue
		echo "止めています: $p"
		use_env "" "$p"
		if [ -f "$state_dir/compose.yml" ]; then
			compose down $remove_volumes
		else
			docker compose -p "$p" down $remove_volumes
		fi
	done < <(variant_projects)
}

variant_status() {
	local rows proj branch category base state u db code resp
	rows="$(docker ps -a --filter label=orb-dev.variant.branch \
		--format '{{.Label "com.docker.compose.project"}}	{{.Label "orb-dev.variant.branch"}}	{{.Label "orb-dev.variant.category"}}	{{.Label "orb-dev.variant.base"}}	{{.State}}')"
	if [ -z "$rows" ]; then
		echo "variant のコンテナはありません"
		return 0
	fi
	{
		printf 'ブランチ\t種類\tURL\tDB\t状態\t応答\n'
		while IFS=$'\t' read -r proj branch category base state; do
			u="http://web.$proj.orb.local:3000/"
			if [ "$category" = "migration" ]; then db="vdb"; else db="base ($base)"; fi
			code="$(curl -s -m 5 -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' "${u}api/meta" || true)"
			if [ "$code" = "200" ]; then resp="OK"; else resp="NG ($code)"; fi
			printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$branch" "$category" "$u" "$db" "$state" "$resp"
		done <<< "$rows"
	} | column -t -s $'\t'
}

variant_up_all() {
	local b rc
	for b in "$@"; do
		echo "=== $b"
		rc=0
		"$BASH" "$self" variant prepare "$b" || rc=$?
		if [ "$rc" -eq 2 ]; then
			echo "$b がコンフリクトしたので止めます。解消してコミットしてから、もう一度 up-all を実行してください" >&2
			exit 2
		elif [ "$rc" -ne 0 ]; then
			echo "$b の prepare が失敗したので止めます" >&2
			exit 1
		fi
		# 起動して応答するまで待ってから次へ進む (pnpm install / build を同時に 2 つ実行しない)
		if ! "$BASH" "$self" variant up "$b"; then
			echo "$b の起動が失敗したので止めます" >&2
			exit 1
		fi
	done
	variant_status
}

variant_main() {
	local sub="${1:-}" args=() a
	[ $# -gt 0 ] && shift
	for a in "$@"; do
		case "$a" in
			-v|--volumes) remove_volumes="-v" ;;
			-*) echo "不明なオプションです: $a" >&2; exit 1 ;;
			*) args+=("$a") ;;
		esac
	done
	set -- ${args[@]+"${args[@]}"}
	if [ -n "$remove_volumes" ] && [ "$sub" != "down" ] && [ "$sub" != "down-all" ]; then
		echo "-v は down と down-all でだけ使えます" >&2
		exit 1
	fi

	case "$sub:$#" in
		classify:1)
			variant_load "$1"
			echo "$v_category"
			echo "起点: $(git -C "$base_wt" log -1 --format='%h %s' "$v_fork")  名前: $v_slug" >&2
			git -C "$base_wt" diff --no-renames --name-only --diff-filter=A "origin/develop...riin/$v_branch" -- packages/backend/migration \
				| sed 's/^/追加される migration: /' >&2
			;;
		prepare:1|prepare:2) variant_prepare "$@" ;;
		up:1|up:2) variant_up "$@" ;;
		down:1) variant_down "$1" ;;
		status:0) variant_status ;;
		down-all:0) variant_down_all ;;
		up-all:0) variant_usage; exit 1 ;;
		up-all:*) variant_up_all "$@" ;;
		*) variant_usage; exit 1 ;;
	esac
}

case "$cmd" in
	up)
		configure_lan
		generate
		compose up -d
		echo "起動を待っています (初回は依存のインストールで数分かかります)..."
		wait_ready
		create_admin
		echo "起動しました: $url  (ログイン: $admin_user / $admin_pass)"
		if [ -n "$lan_host" ]; then
			echo "LAN 内の端末からも開けます。開けないときは、端末が同じネットワークにいるか、macOS のファイアウォールで OrbStack の受信を許可しているかを確かめてください"
			echo "vite の HMR 用に 5173 番も公開しています。ほかの worktree を --lan で同時に動かすことはできません"
		fi
		if [ -n "$with_seed" ]; then
			snap_name="seed"
			key="$(snapshot_key)"
			if [ -f "$snapshots_dir/$key/seed.dump" ] && [ -f "$snapshots_dir/$key/seed.files.tar" ]; then
				do_restore
			else
				do_seed
			fi
		fi
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
	seed)
		require_running
		do_seed
		;;
	snapshot)
		require_running
		require_own_project
		do_snapshot
		;;
	restore)
		require_running
		do_restore
		;;
	variant)
		variant_main "$@"
		;;
	*)
		sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
		exit 1
		;;
esac
