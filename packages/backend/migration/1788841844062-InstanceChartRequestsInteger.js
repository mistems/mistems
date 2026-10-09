/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class InstanceChartRequestsInteger1788841844062 {
    name = 'InstanceChartRequestsInteger1788841844062'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "__chart__instance" ALTER COLUMN "___requests_failed" TYPE integer USING "___requests_failed"::integer, ALTER COLUMN "___requests_succeeded" TYPE integer USING "___requests_succeeded"::integer, ALTER COLUMN "___requests_received" TYPE integer USING "___requests_received"::integer`);
        await queryRunner.query(`ALTER TABLE "__chart_day__instance" ALTER COLUMN "___requests_failed" TYPE integer USING "___requests_failed"::integer, ALTER COLUMN "___requests_succeeded" TYPE integer USING "___requests_succeeded"::integer, ALTER COLUMN "___requests_received" TYPE integer USING "___requests_received"::integer`);
    }

    async down(queryRunner) {
        // smallint に戻す前に上限を超える値を丸める (丸めないと巻き戻し自体が失敗する)
        await queryRunner.query(`UPDATE "__chart_day__instance" SET "___requests_failed" = LEAST("___requests_failed", 32767), "___requests_succeeded" = LEAST("___requests_succeeded", 32767), "___requests_received" = LEAST("___requests_received", 32767)`);
        await queryRunner.query(`UPDATE "__chart__instance" SET "___requests_failed" = LEAST("___requests_failed", 32767), "___requests_succeeded" = LEAST("___requests_succeeded", 32767), "___requests_received" = LEAST("___requests_received", 32767)`);
        await queryRunner.query(`ALTER TABLE "__chart_day__instance" ALTER COLUMN "___requests_failed" TYPE smallint USING "___requests_failed"::smallint, ALTER COLUMN "___requests_succeeded" TYPE smallint USING "___requests_succeeded"::smallint, ALTER COLUMN "___requests_received" TYPE smallint USING "___requests_received"::smallint`);
        await queryRunner.query(`ALTER TABLE "__chart__instance" ALTER COLUMN "___requests_failed" TYPE smallint USING "___requests_failed"::smallint, ALTER COLUMN "___requests_succeeded" TYPE smallint USING "___requests_succeeded"::smallint, ALTER COLUMN "___requests_received" TYPE smallint USING "___requests_received"::smallint`);
    }
}
