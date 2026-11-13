# 枠の台帳。orb-dev.sh から source して使う。cache_root を先に決めておくこと
#
# 枠 (devN) ごとに $cache_root/slots/devN/ を置き、中の owner に
# 「プロジェクト名」「ワークツリーのパス」「取った時刻 (UTC)」を 1 行ずつ書く。
# 枠を取るのは mkdir の成否で決めるので、並行セッションが同時に up しても同じ枠を取り合わない

slot_names="$(seq -f 'dev%g' 1 "${ORB_DEV_SLOT_COUNT:-10}" | tr '\n' ' ')"
slot_names="${slot_names% }"

# 取ってからこの秒数のうちは、web コンテナがまだ無くても枠を奪わない。
# 初めての環境は db・redis の起動や依存のインストール、variant の種類 3 は vdb の restore を待ってから web を作るため
slot_grace_default=3600
# owner を書く前にプロセスが落ちた枠は、この秒数がたてば空きとして扱う
slot_ownerless_grace=60

# 持ち主の web コンテナがあるか。0: ある (止まっているだけも含む)  1: 無い  2: 分からない (Docker に問い合わせられない)。
# 止まっている環境や、Docker がまだ起動していないときに、ほかの環境の枠を奪わないようにする
slot_owner_exists() {
	local out
	if out="$(docker inspect "$1-web-1" 2>&1 >/dev/null)"; then
		return 0
	fi
	case "$out" in
		*"No such object"*|*"no such object"*) return 1 ;;
		*) return 2 ;;
	esac
}

slot_dir() { echo "$cache_root/slots/$1"; }

slot_owner() {
	sed -n 1p "$(slot_dir "$1")/owner" 2>/dev/null || true
}

slot_of_project() {
	local s
	for s in $slot_names; do
		if [ "$(slot_owner "$s")" = "$1" ]; then
			echo "$s"
			return 0
		fi
	done
	return 1
}

slot_write_owner() {
	printf '%s\n%s\n%s\n%s\n' "$2" "$3" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(date +%s)" > "$(slot_dir "$1")/owner"
}

# 枠を空きとして扱ってよいか。持ち主の web コンテナが無く、取ってから猶予がたっているときだけ 0 を返す
slot_is_stale() {
	local dir owner since now
	dir="$(slot_dir "$1")"
	now="$(date +%s)"
	owner="$(slot_owner "$1")"
	if [ -z "$owner" ]; then
		# owner を書く前に落ちた枠。ディレクトリを作ってから時間がたっていれば空き
		since="$(stat -f %m "$dir" 2>/dev/null || echo "$now")"
		[ $((now - since)) -ge "$slot_ownerless_grace" ]
		return
	fi
	since="$(sed -n 4p "$dir/owner" 2>/dev/null)"
	[ -n "$since" ] || since=0
	[ $((now - since)) -ge "${ORB_DEV_SLOT_GRACE:-$slot_grace_default}" ] || return 1
	slot_owner_exists "$owner"
	[ $? -eq 1 ]
}

# 空きとして扱える枠を取り直す。同時に取り直そうとしたセッションのうち、mv できた 1 つだけが進む
slot_take_stale() {
	local dir tmp
	dir="$(slot_dir "$1")"
	tmp="$cache_root/slots/.stale-$1-$$"
	mv "$dir" "$tmp" 2>/dev/null || return 1
	rm -rf "$tmp"
	mkdir "$dir" 2>/dev/null || return 1
	slot_write_owner "$1" "$2" "$3"
}

# $1: プロジェクト名  $2: ワークツリーのパス  $3: 欲しい枠 (省略すると空いている最初の枠)
slot_claim() {
	local project="$1" wt="$2" wanted="${3:-}" s candidates
	if [ -n "$wanted" ] && [[ " $slot_names " != *" $wanted "* ]]; then
		echo "枠の名前が不正です: $wanted (使えるのは $slot_names)" >&2
		return 1
	fi
	if s="$(slot_of_project "$project")"; then
		if [ -n "$wanted" ] && [ "$wanted" != "$s" ]; then
			echo "$project は既に枠 $s を持っています。枠を替えるときは先に down してください" >&2
			return 1
		fi
		echo "$s"
		return 0
	fi
	mkdir -p "$cache_root/slots"
	candidates="${wanted:-$slot_names}"
	for s in $candidates; do
		if mkdir "$(slot_dir "$s")" 2>/dev/null; then
			slot_write_owner "$s" "$project" "$wt"
			echo "$s"
			return 0
		fi
		# 持ち主の web コンテナが無く、取ってから猶予がたった枠は空きとして扱う (slot_is_stale)
		if slot_is_stale "$s" && slot_take_stale "$s" "$project" "$wt"; then
			echo "$s"
			return 0
		fi
	done
	if [ -n "$wanted" ]; then
		echo "枠 $wanted は $(slot_owner "$wanted") が使っています" >&2
	else
		echo "空いている枠がありません" >&2
	fi
	return 1
}

slot_release() {
	local s
	if s="$(slot_of_project "$1")"; then
		rm -rf "$(slot_dir "$s")"
	fi
	return 0
}

slot_list() {
	local s f
	for s in $slot_names; do
		f="$(slot_dir "$s")/owner"
		if [ -f "$f" ]; then
			printf '%s\t%s\t%s\t%s\n' "$s" "$(sed -n 1p "$f")" "$(sed -n 2p "$f")" "$(sed -n 3p "$f")"
		else
			printf '%s\t-\t-\t-\n' "$s"
		fi
	done
}
