#!/usr/bin/env bash
# 上流の packages/backend/test-federation (a.test と b.test の連合テスト) を OrbStack で動かす。
# 使い方は SKILL.md を参照。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
	cat <<'USAGE'
fed.sh up      [worktree] [--build]   ビルド (無いとき・--build のとき)、証明書の用意、a.test / b.test の起動
fed.sh test    [worktree] [テスト...] テストを実行する。名前だけ (channel) でも、パスでもよい。省略すると全体
fed.sh relay   [worktree]             a.test に b.test の inbox を受理済みのリレーとして登録する (リレーの代わり)
fed.sh exec    [worktree] -- <コマンド> compose のサービスに対して docker compose を実行する (例: -- exec -T db.a.test psql ...)
fed.sh status  [worktree]
fed.sh down    [worktree] [-v]        止める。-v で DB のデータ (test-federation/volumes) も消す
USAGE
}

cmd="${1:-}"; shift || true
[[ -z "$cmd" || "$cmd" == "-h" || "$cmd" == "--help" ]] && { usage; exit 0; }

# 1 つめの引数がディレクトリなら worktree として扱う
worktree=""
if [[ $# -gt 0 && -d "$1" ]]; then worktree="$1"; shift; fi
worktree="$(cd "${worktree:-.}" && git rev-parse --show-toplevel)"

FED_DIR="$worktree/packages/backend/test-federation"
[[ -d "$FED_DIR" ]] || { echo "test-federation がありません: $FED_DIR" >&2; exit 2; }

export NODE_VERSION
NODE_VERSION="$(cat "$worktree/.node-version")"
# compose のプロジェクト名は小文字・数字・「-」「_」だけなので、worktree の名前を小文字にする (例: mkPostformExtend)
PROJECT="fed-$(basename "$worktree" | tr '[:upper:]' '[:lower:]')"
compose() { (cd "$FED_DIR" && docker compose -p "$PROJECT" "$@"); }

# 固定サブネット (172.20/16・172.23/16) を使うので、同時に動かせるのは 1 組だけ
check_other_projects() {
	local others
	others="$(docker ps --format '{{.Label "com.docker.compose.project"}}' | sort -u | grep -E '^(fed-|test-federation$|chfed$)' | grep -vx "$PROJECT" || true)"
	if [[ -n "$others" ]]; then
		echo "別の連合テストの環境が動いています: $others" >&2
		echo "先に止めてください (例: docker compose -p <名前> down)。サブネットが固定なので 2 組は同時に動きません" >&2
		exit 3
	fi
}

find_openssl() {
	local p
	for p in /opt/homebrew/opt/openssl@3/bin/openssl /opt/homebrew/opt/openssl/bin/openssl /usr/local/opt/openssl@3/bin/openssl; do
		[[ -x "$p" ]] && { echo "$p"; return; }
	done
	# macOS の /usr/bin/openssl (LibreSSL) では setup.sh の rootCA.crt の作成が失敗する
	if openssl version | grep -q LibreSSL; then
		echo "OpenSSL が要ります (LibreSSL では setup.sh が失敗します)。brew install openssl@3 を実行してください" >&2
		exit 2
	fi
	command -v openssl
}

setup_certificates() {
	if [[ -f "$FED_DIR/certificates/rootCA.crt" && -f "$FED_DIR/certificates/b.test.crt" ]]; then return; fi
	echo "証明書と設定を作ります"
	local openssl_bin; openssl_bin="$(find_openssl)"
	rm -rf "$FED_DIR/certificates"
	(cd "$FED_DIR" && PATH="$(dirname "$openssl_bin"):$PATH" bash ./setup.sh >/dev/null 2>&1)
	[[ -f "$FED_DIR/certificates/rootCA.crt" ]] || { echo "rootCA.crt を作れませんでした" >&2; exit 1; }
}

build() {
	echo "Node $NODE_VERSION でビルドします (数分かかります)"
	(cd "$worktree" && mise exec "node@$NODE_VERSION" -- pnpm install --frozen-lockfile && mise exec "node@$NODE_VERSION" -- pnpm build)
}

wait_ready() {
	local i s
	for i in $(seq 1 240); do
		s="$(compose ps -a --format '{{.Service}} {{.Status}}')"
		if echo "$s" | grep -qE '^misskey\.a\.test .*\(healthy\)' && echo "$s" | grep -qE '^misskey\.b\.test .*\(healthy\)' \
			&& echo "$s" | grep -qE '^a\.test .*\(healthy\)' && echo "$s" | grep -qE '^b\.test .*\(healthy\)'; then
			echo "a.test と b.test が使える状態になりました"; return 0
		fi
		if echo "$s" | grep -qE 'Exited \([1-9]'; then
			echo "起動に失敗しました:" >&2; echo "$s" >&2
			echo "ログ: $0 exec $worktree -- logs <サービス名>" >&2
			return 1
		fi
		sleep 5
	done
	echo "20 分待っても起動しませんでした" >&2; echo "$s" >&2; return 1
}

# テスト名を backend からの相対パスにする (tester の作業ディレクトリは packages/backend)
normalize_test() {
	local t="$1"
	t="${t#packages/backend/}"
	case "$t" in
		test-federation/*) echo "$t" ;;
		test/*) echo "test-federation/$t" ;;
		*.test.ts) echo "test-federation/test/$t" ;;
		*) echo "test-federation/test/$t.test.ts" ;;
	esac
}

case "$cmd" in
	up)
		do_build=false
		[[ "${1:-}" == "--build" ]] && do_build=true
		check_other_projects
		if $do_build || [[ ! -d "$worktree/packages/backend/built" || ! -d "$worktree/built" ]]; then build; fi
		setup_certificates
		compose up -d --scale tester=0
		wait_ready
		;;
	test)
		tests=()
		for t in "$@"; do tests+=("$(normalize_test "$t")"); done
		if [[ ${#tests[@]} -eq 0 ]]; then
			compose run --no-deps --rm tester
		else
			compose run --no-deps --rm tester -- pnpm -F backend test:fed "${tests[@]}"
		fi
		;;
	relay)
		compose exec -T misskey.a.test node --input-type=module - add-relay < "$SCRIPT_DIR/fake-relay.mjs"
		compose exec -T db.a.test psql -U postgres -d misskey -c "UPDATE relay SET status = 'accepted' WHERE inbox = 'https://b.test/inbox';"
		# 受理済みのリレーの一覧はメモリに 10 分残るので、再起動して読み直させる
		compose restart misskey.a.test
		# 再起動の直後は healthcheck の状態が前のまま残るので、API が応答するまで待つ
		for _ in $(seq 1 60); do
			compose exec -T misskey.a.test curl -sf -o /dev/null -X POST http://127.0.0.1:3000/api/ping && break
			sleep 3
		done
		compose exec -T misskey.a.test node --input-type=module - list < "$SCRIPT_DIR/fake-relay.mjs"
		;;
	exec)
		[[ "${1:-}" == "--" ]] && shift
		compose "$@"
		;;
	status)
		compose ps -a --format '{{.Service}}\t{{.Status}}'
		;;
	down)
		compose down
		if [[ "${1:-}" == "-v" ]]; then
			rm -rf "$FED_DIR/volumes"
			echo "DB のデータ (test-federation/volumes) を消しました"
		fi
		;;
	*)
		usage; exit 2 ;;
esac
