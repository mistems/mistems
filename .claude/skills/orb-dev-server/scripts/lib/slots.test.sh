#!/usr/bin/env bash
# lib/slots.sh のテスト。bash lib/slots.test.sh で実行する
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cache_root="$(mktemp -d)"
trap 'rc=$?; rm -rf "$cache_root"; exit $rc' EXIT
# 読み込みに失敗しても bash は終了コード 0 で終わることがあるので、先に確かめる
[ -f "$here/slots.sh" ] || { echo "not ok - slots.sh がありません"; exit 1; }
# shellcheck source=slots.sh
ORB_DEV_SLOT_COUNT=4
. "$here/slots.sh"

# テストでは docker を見ずに、ここに書いたプロジェクトだけコンテナがあることにする。
# docker_down を 1 にすると、Docker に問い合わせられない (分からない) ことにする
existing=" "
docker_down=0
slot_owner_exists() { [ "$docker_down" = 1 ] && return 2; [[ "$existing" == *" $1 "* ]]; }
# 既定では、取ってからの猶予を 0 秒にして、コンテナの無い枠をすぐ空きとして扱う
ORB_DEV_SLOT_GRACE=0

fail=0
check() { if [ "$2" = "$3" ]; then echo "ok - $1"; else echo "not ok - $1: 期待 '$3' 実際 '$2'"; fail=1; fi; }

existing=" a b c d e "
check "空きの先頭を取る" "$(slot_claim a /wt/a)" dev1
check "同じプロジェクトは同じ枠" "$(slot_claim a /wt/a)" dev1
check "次の空き" "$(slot_claim b /wt/b)" dev2
check "指定した枠" "$(slot_claim c /wt/c dev4)" dev4
check "持ち主を引く" "$(slot_of_project c)" dev4
check "指定した枠が埋まっていれば失敗" "$(slot_claim d /wt/d dev1 2>/dev/null || echo fail)" fail
check "残りの空き" "$(slot_claim d /wt/d)" dev3
check "全部埋まれば失敗" "$(slot_claim e /wt/e 2>/dev/null || echo fail)" fail
check "持ち主のワークツリー" "$(slot_list | awk -F'\t' '$1=="dev2"{print $3}')" /wt/b

slot_release b
check "返した枠は空き" "$(slot_list | awk -F'\t' '$1=="dev2"{print $2}')" -
check "返した枠を取れる" "$(slot_claim e /wt/e)" dev2

existing=" a b d e "
slot_release e
check "コンテナが無い持ち主の枠は空きとして扱う" "$(slot_claim e /wt/e dev4)" dev4
check "不明な枠名は失敗" "$(slot_claim x /wt/x dev9 2>/dev/null || echo fail)" fail
check "持ち主の無いプロジェクトの release は成功" "$(slot_release nobody && echo ok)" ok

# 取ってから猶予のうちは、コンテナがまだ無くても (起動の途中) 奪わない
slot_release a; slot_release b; slot_release c; slot_release d; slot_release e
existing=" "
check "空きを取る" "$(slot_claim p /wt/p)" dev1
ORB_DEV_SLOT_GRACE=3600
check "起動の途中の枠は奪わない" "$(slot_claim q /wt/q)" dev2
ORB_DEV_SLOT_GRACE=0

# Docker に問い合わせられないときは奪わない
docker_down=1
check "Docker が止まっていれば奪わない" "$(slot_claim r /wt/r dev1 2>/dev/null || echo fail)" fail
check "持ち主はそのまま" "$(slot_of_project p)" dev1
docker_down=0

# owner を書く前に落ちた枠は、しばらくたてば空きとして扱う
slot_release p; slot_release q
mkdir "$cache_root/slots/dev3"
touch -t 202001010000 "$cache_root/slots/dev3"
check "owner の無い古い枠を取れる" "$(slot_claim s /wt/s dev3)" dev3
mkdir "$cache_root/slots/dev4"
check "owner の無い新しい枠は取らない" "$(slot_claim t /wt/t dev4 2>/dev/null || echo fail)" fail
exit $fail
