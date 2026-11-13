/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class ChannelFederationPolicy1794477119411 {
	name = 'ChannelFederationPolicy1794477119411'

	async up(queryRunner) {
		await queryRunner.query(`CREATE TYPE "public"."channel_federationpolicy_enum" AS ENUM('none', 'public')`);
		await queryRunner.query(`ALTER TABLE "channel" ADD "federationPolicy" "public"."channel_federationpolicy_enum" NOT NULL DEFAULT 'none'`);
		await queryRunner.query(`COMMENT ON COLUMN "channel"."federationPolicy" IS 'How notes in this channel are federated.'`);
	}

	async down(queryRunner) {
		await queryRunner.query(`COMMENT ON COLUMN "channel"."federationPolicy" IS NULL`);
		await queryRunner.query(`ALTER TABLE "channel" DROP COLUMN "federationPolicy"`);
		await queryRunner.query(`DROP TYPE "public"."channel_federationpolicy_enum"`);
	}
}
