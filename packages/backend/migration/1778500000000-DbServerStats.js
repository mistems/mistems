/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class DbServerStats1778500000000 {
    name = 'DbServerStats1778500000000'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "db_server_stats" (
            "ts"              TIMESTAMP WITH TIME ZONE NOT NULL,
            "host_id"         TEXT NOT NULL,
            "cpu"             REAL,
            "mem_used"        BIGINT,
            "mem_total"       BIGINT,
            "disk_used"       BIGINT,
            "disk_total"      BIGINT,
            "disk_r_sec"      BIGINT,
            "disk_w_sec"      BIGINT,
            "db_size"         BIGINT,
            "conn_active"     INTEGER,
            "conn_max"        INTEGER,
            "cache_hit_ratio" REAL,
            CONSTRAINT "PK_db_server_stats" PRIMARY KEY ("ts", "host_id")
        )`);
        await queryRunner.query(`CREATE INDEX "IDX_db_server_stats_ts" ON "db_server_stats" ("ts" DESC)`);
        await queryRunner.query(`ALTER TABLE "meta" ADD "enableDbServerStats" boolean NOT NULL DEFAULT false`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "enableDbServerStats"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_db_server_stats_ts"`);
        await queryRunner.query(`DROP TABLE "db_server_stats"`);
    }
}
