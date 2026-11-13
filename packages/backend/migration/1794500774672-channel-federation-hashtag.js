/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class ChannelFederationHashtag1794500774672 {
	name = 'ChannelFederationHashtag1794500774672'

	async up(queryRunner) {
		await queryRunner.query(`ALTER TABLE "channel" ADD "federationHashtag" character varying(128)`);
		await queryRunner.query(`COMMENT ON COLUMN "channel"."federationHashtag" IS 'The hashtag (without #) attached to notes of this channel when federated.'`);
		await queryRunner.query(`ALTER TABLE "channel" ADD "federationHashtagNormalized" character varying(128)`);
		await queryRunner.query(`COMMENT ON COLUMN "channel"."federationHashtagNormalized" IS 'The normalized federationHashtag, used for uniqueness and lookup.'`);
		await queryRunner.query(`CREATE UNIQUE INDEX "IDX_bde9382061a7fb5a7fc25868ac" ON "channel" ("federationHashtagNormalized") `);
	}

	async down(queryRunner) {
		await queryRunner.query(`DROP INDEX "public"."IDX_bde9382061a7fb5a7fc25868ac"`);
		await queryRunner.query(`ALTER TABLE "channel" DROP COLUMN "federationHashtagNormalized"`);
		await queryRunner.query(`ALTER TABLE "channel" DROP COLUMN "federationHashtag"`);
	}
}
