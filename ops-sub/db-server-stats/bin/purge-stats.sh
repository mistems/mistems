#!/bin/sh
# SPDX-FileCopyrightText: syuilo and misskey-project
# SPDX-License-Identifier: AGPL-3.0-only
#
# db_server_stats テーブルから古い行を削除する単発スクリプト。
# 1 日 1 回呼ばれることを想定（cron / systemd timer などで）。
#
# 必須環境変数: PGHOST, PGUSER, PGPASSWORD, PGDATABASE
# 任意環境変数: MISSKEY_STATS_RETENTION (例: '24 hours' / '7 days', 既定: '24 hours')

set -eu

: "${PGHOST:?PGHOST must be set}"
: "${PGUSER:?PGUSER must be set}"
: "${PGDATABASE:?PGDATABASE must be set}"

RETENTION="${MISSKEY_STATS_RETENTION:-24 hours}"

psql -X -v ON_ERROR_STOP=1 -c "DELETE FROM db_server_stats WHERE ts < now() - interval '$RETENTION'"
