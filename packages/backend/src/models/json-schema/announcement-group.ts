/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export const packedAnnouncementGroupSchema = {
	type: 'object',
	properties: {
		id: {
			type: 'string',
			optional: false, nullable: false,
			format: 'id',
			example: 'xxxxxxxxxx',
		},
		createdAt: {
			type: 'string',
			optional: false, nullable: false,
			format: 'date-time',
		},
		updatedAt: {
			type: 'string',
			optional: false, nullable: true,
			format: 'date-time',
		},
		name: {
			type: 'string',
			optional: false, nullable: false,
		},
		icon: {
			type: 'string',
			optional: false, nullable: true,
		},
		order: {
			type: 'integer',
			optional: false, nullable: false,
		},
	},
} as const;
