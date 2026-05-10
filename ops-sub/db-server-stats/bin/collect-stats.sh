#!/bin/sh
# SPDX-FileCopyrightText: syuilo and misskey-project
# SPDX-License-Identifier: AGPL-3.0-only
#
# DBサーバー側で実行する統計収集スクリプト。
# 1回の実行で OS 指標（CPU/メモリ/ディスク/I-O）と DB 指標を取得し、
# db_server_stats テーブルに 1 行 INSERT して終わる。常駐しない。
#
# 必須環境変数:
#   PGHOST, PGPORT(任意), PGUSER, PGPASSWORD, PGDATABASE
#   MISSKEY_HOST_ID  ... 行を識別するホスト名（例: 'primary' / 'replica-1'）
#
# 任意環境変数:
#   MISSKEY_DATA_DIR ... ディスク使用量を測るマウント点（既定: /var/lib/postgresql）
#   MISSKEY_DATA_DEV ... I/O を測るブロックデバイス名（既定: 自動推定）
#   MISSKEY_STATE_DIR ... 前回値を保存するディレクトリ（既定: /var/lib/misskey-stats）

set -eu

: "${MISSKEY_HOST_ID:?MISSKEY_HOST_ID must be set}"
: "${PGHOST:?PGHOST must be set}"
: "${PGUSER:?PGUSER must be set}"
: "${PGDATABASE:?PGDATABASE must be set}"

DATA_DIR="${MISSKEY_DATA_DIR:-/var/lib/postgresql}"
STATE_DIR="${MISSKEY_STATE_DIR:-/var/lib/misskey-stats}"
mkdir -p "$STATE_DIR"

# ---- CPU usage (1 秒間サンプリング, 0.0-1.0) -----------------------------------
read_cpu_jiffies() {
    awk '/^cpu / {
        idle=$5+$6;
        total=0; for (i=2; i<=NF; i++) total+=$i;
        print idle, total
    }' /proc/stat
}
read cpu_idle_a cpu_total_a <<EOF
$(read_cpu_jiffies)
EOF
sleep 1
read cpu_idle_b cpu_total_b <<EOF
$(read_cpu_jiffies)
EOF
cpu_diff_total=$((cpu_total_b - cpu_total_a))
cpu_diff_idle=$((cpu_idle_b - cpu_idle_a))
if [ "$cpu_diff_total" -gt 0 ]; then
    cpu=$(awk -v t="$cpu_diff_total" -v i="$cpu_diff_idle" 'BEGIN { printf "%.4f", (t-i)/t }')
else
    cpu="NULL"
fi

# ---- Memory ------------------------------------------------------------------
mem_total_kb=$(awk '/^MemTotal:/   {print $2}' /proc/meminfo)
mem_avail_kb=$(awk '/^MemAvailable:/{print $2}' /proc/meminfo)
mem_total=$((mem_total_kb * 1024))
mem_used=$(((mem_total_kb - mem_avail_kb) * 1024))

# ---- Disk usage --------------------------------------------------------------
df_line=$(df -PB1 "$DATA_DIR" | tail -n1)
disk_total=$(echo "$df_line" | awk '{print $2}')
disk_used=$(echo "$df_line"  | awk '{print $3}')
disk_dev=$(echo "$df_line"   | awk '{print $1}')

# ---- Disk I/O (前回値との差分から bytes/sec を推定) --------------------------
target_dev="${MISSKEY_DATA_DEV:-$(basename "$disk_dev")}"
last_file="$STATE_DIR/last-diskstats"
disk_r_sec="NULL"
disk_w_sec="NULL"

now_epoch=$(date +%s)
now_line=$(awk -v dev="$target_dev" '$3 == dev { print $6, $10 }' /proc/diskstats)

if [ -n "$now_line" ] && [ -f "$last_file" ]; then
    read prev_epoch prev_r_sectors prev_w_sectors < "$last_file" || true
    if [ -n "${prev_epoch:-}" ]; then
        elapsed=$((now_epoch - prev_epoch))
        if [ "$elapsed" -gt 0 ]; then
            now_r_sectors=$(echo "$now_line" | awk '{print $1}')
            now_w_sectors=$(echo "$now_line" | awk '{print $2}')
            r_delta=$((now_r_sectors - prev_r_sectors))
            w_delta=$((now_w_sectors - prev_w_sectors))
            [ "$r_delta" -lt 0 ] && r_delta=0
            [ "$w_delta" -lt 0 ] && w_delta=0
            # 1 sector = 512 bytes
            disk_r_sec=$(( r_delta * 512 / elapsed ))
            disk_w_sec=$(( w_delta * 512 / elapsed ))
        fi
    fi
fi

if [ -n "$now_line" ]; then
    now_r=$(echo "$now_line" | awk '{print $1}')
    now_w=$(echo "$now_line" | awk '{print $2}')
    printf '%s %s %s\n' "$now_epoch" "$now_r" "$now_w" > "$last_file"
fi

# ---- DB-side metrics (single round trip) ------------------------------------
# 1 行 TSV: db_size, conn_active, conn_max, cache_hit_ratio
db_metrics=$(psql -X -A -t -F$'\t' -v ON_ERROR_STOP=1 <<'SQL'
SELECT
    pg_database_size(current_database())::bigint,
    (SELECT count(*) FROM pg_stat_activity WHERE state = 'active')::int,
    current_setting('max_connections')::int,
    CASE
        WHEN (SELECT sum(blks_hit + blks_read) FROM pg_stat_database) = 0 THEN NULL
        ELSE (SELECT sum(blks_hit)::numeric / sum(blks_hit + blks_read) FROM pg_stat_database)
    END;
SQL
)
db_size=$(echo "$db_metrics"      | cut -f1)
conn_active=$(echo "$db_metrics"  | cut -f2)
conn_max=$(echo "$db_metrics"     | cut -f3)
cache_hit_ratio=$(echo "$db_metrics" | cut -f4)
[ -z "$cache_hit_ratio" ] && cache_hit_ratio="NULL"

# ---- INSERT ------------------------------------------------------------------
psql -X -v ON_ERROR_STOP=1 <<SQL
INSERT INTO db_server_stats
    (ts, host_id, cpu, mem_used, mem_total, disk_used, disk_total,
     disk_r_sec, disk_w_sec, db_size, conn_active, conn_max, cache_hit_ratio)
VALUES
    (now(), '$MISSKEY_HOST_ID', $cpu, $mem_used, $mem_total, $disk_used, $disk_total,
     $disk_r_sec, $disk_w_sec, $db_size, $conn_active, $conn_max, $cache_hit_ratio);
SQL
