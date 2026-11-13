/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { beforeAll, describe, test, expect } from 'vitest';
import { Test } from '@nestjs/testing';

import { CoreModule } from '@/core/CoreModule.js';
import { NoteCreateService } from '@/core/NoteCreateService.js';
import { GlobalModule } from '@/GlobalModule.js';
import { MiNote } from '@/models/Note.js';
import { IPoll } from '@/models/Poll.js';
import { MiDriveFile } from '@/models/DriveFile.js';
import { MiChannel } from '@/models/Channel.js';

describe('NoteCreateService', () => {
	let noteCreateService: NoteCreateService;

	beforeAll(async () => {
		const app = await Test.createTestingModule({
			imports: [GlobalModule, CoreModule],
		}).compile();
		noteCreateService = app.get<NoteCreateService>(NoteCreateService);
	});

	describe('is-renote', () => {
		const base: MiNote = {
			id: 'some-note-id',
			replyId: null,
			reply: null,
			renoteId: null,
			renote: null,
			threadId: null,
			text: null,
			name: null,
			cw: null,
			userId: 'some-user-id',
			user: null,
			localOnly: false,
			reactionAcceptance: null,
			renoteCount: 0,
			repliesCount: 0,
			clippedCount: 0,
			pageCount: 0,
			reactions: {},
			visibility: 'public',
			uri: null,
			url: null,
			fileIds: [],
			attachedFileTypes: [],
			visibleUserIds: [],
			mentions: [],
			mentionedRemoteUsers: '',
			reactionAndUserPairCache: [],
			emojis: [],
			tags: [],
			hasPoll: false,
			channelId: null,
			channel: null,
			userHost: null,
			replyUserId: null,
			replyUserHost: null,
			renoteUserId: null,
			renoteUserHost: null,
			renoteChannelId: null,
		};

		const poll: IPoll = {
			choices: ['kinoko', 'takenoko'],
			multiple: false,
			expiresAt: null,
		};

		const file: MiDriveFile = {
			id: 'some-file-id',
			userId: null,
			user: null,
			userHost: null,
			md5: '',
			name: '',
			type: '',
			size: 0,
			comment: null,
			blurhash: null,
			properties: {},
			storedInternal: false,
			url: '',
			thumbnailUrl: null,
			webpublicUrl: null,
			webpublicType: null,
			accessKey: null,
			thumbnailAccessKey: null,
			webpublicAccessKey: null,
			uri: null,
			src: null,
			folderId: null,
			folder: null,
			isSensitive: false,
			maybeSensitive: false,
			maybePorn: false,
			isLink: false,
			requestHeaders: null,
			requestIp: null,
		};

		test('note without renote should not be Renote', () => {
			const note = { renote: null };
			expect(noteCreateService['isRenote'](note)).toBe(false);
		});

		test('note with renote should be Renote and not be Quote', () => {
			const note = { renote: base };
			expect(noteCreateService['isRenote'](note)).toBe(true);
			expect(noteCreateService['isQuote'](note)).toBe(false);
		});

		test('note with renote and text should be Quote', () => {
			const note = { renote: base, text: 'some-text' };
			expect(noteCreateService['isRenote'](note)).toBe(true);
			expect(noteCreateService['isQuote'](note)).toBe(true);
		});

		test('note with renote and cw should be Quote', () => {
			const note = { renote: base, cw: 'some-cw' };
			expect(noteCreateService['isRenote'](note)).toBe(true);
			expect(noteCreateService['isQuote'](note)).toBe(true);
		});

		test('note with renote and reply should be Quote', () => {
			const note = { renote: base, reply: { ...base, id: 'another-note-id' } };
			expect(noteCreateService['isRenote'](note)).toBe(true);
			expect(noteCreateService['isQuote'](note)).toBe(true);
		});

		test('note with renote and poll should be Quote', () => {
			const note = { renote: base, poll };
			expect(noteCreateService['isRenote'](note)).toBe(true);
			expect(noteCreateService['isQuote'](note)).toBe(true);
		});

		test('note with renote and non-empty files should be Quote', () => {
			const note = { renote: base, files: [file] };
			expect(noteCreateService['isRenote'](note)).toBe(true);
			expect(noteCreateService['isQuote'](note)).toBe(true);
		});
	});

	describe('applyChannelFederationPolicy (チャンネル連合)', () => {
		const localUser = { id: 'local-user-id', host: null };
		const remoteUser = { id: 'remote-user-id', host: 'remote.example' };
		const channel = (federationPolicy: MiChannel['federationPolicy']) => ({ id: 'some-channel-id', federationPolicy } as MiChannel);
		const apply = (data: { channel: MiChannel | null; visibility?: string; localOnly?: boolean; visibleUsers?: unknown[] }, user: { id: string; host: string | null } = localUser) => {
			noteCreateService['applyChannelFederationPolicy'](data as any, user);
			return data;
		};

		test('none: public + localOnly になる', () => {
			const data = apply({ channel: channel('none'), visibility: 'public', localOnly: false });
			expect(data.visibility).toBe('public');
			expect(data.localOnly).toBe(true);
		});

		test('public: public で連合する', () => {
			const data = apply({ channel: channel('public'), visibility: 'public', localOnly: false });
			expect(data.visibility).toBe('public');
			expect(data.localOnly).toBe(false);
		});

		test('public: サイレンス等で home に降格済みなら home を維持する', () => {
			const data = apply({ channel: channel('public'), visibility: 'home', localOnly: false });
			expect(data.visibility).toBe('home');
			expect(data.localOnly).toBe(false);
		});

		test('public: ノート単位の localOnly は尊重し、public + localOnly に落とす', () => {
			const data = apply({ channel: channel('public'), visibility: 'public', localOnly: true });
			expect(data.visibility).toBe('public');
			expect(data.localOnly).toBe(true);
		});

		test.each(['followers', 'specified'])('%s 可視性は連合させず public + localOnly に落とす', (visibility) => {
			const data = apply({ channel: channel('public'), visibility, localOnly: false, visibleUsers: [{ id: 'x' }] });
			expect(data.visibility).toBe('public');
			expect(data.localOnly).toBe(true);
			expect(data.visibleUsers).toEqual([]);
		});

		test.each(['unknown', 'home'])('未知の federationPolicy (%s) は連合しない側に倒す', (policy) => {
			const data = apply({ channel: channel(policy as any), visibility: 'public', localOnly: false });
			expect(data.visibility).toBe('public');
			expect(data.localOnly).toBe(true);
		});

		test('リモートユーザーのノートには適用しない (受信した可視性と localOnly を保つ)', () => {
			const data = apply({ channel: channel('none'), visibility: 'home', localOnly: false }, remoteUser);
			expect(data.visibility).toBe('home');
			expect(data.localOnly).toBe(false);
		});

		test('チャンネル外のノートには適用しない', () => {
			const data = apply({ channel: null, visibility: 'followers', localOnly: false });
			expect(data.visibility).toBe('followers');
			expect(data.localOnly).toBe(false);
		});
	});

	describe('collectIntoFederatedChannelByHashtag (チャンネル連合のハッシュタグ)', () => {
		const localUser = { id: 'local-user-id', host: null };
		const remoteUser = { id: 'remote-user-id', host: 'remote.example' };
		const federatedChannel = { id: 'federated-channel-id', federationPolicy: 'public', federationHashtag: '連合チャンネル_雑談' } as MiChannel;
		const replyChannel = { id: 'reply-channel-id', federationPolicy: 'public' } as MiChannel;

		const collect = async (data: Record<string, unknown>, user: { id: string; host: string | null } = remoteUser) => {
			const service = noteCreateService['channelFederationHashtagService'];
			const original = service.findCollectingChannel;
			const calls: string[][] = [];
			service.findCollectingChannel = async (tags: string[]) => {
				calls.push(tags);
				return tags.some(t => t.toLowerCase() === '連合チャンネル_雑談') ? federatedChannel : null;
			};
			try {
				await noteCreateService['collectIntoFederatedChannelByHashtag'](data as any, user);
			} finally {
				service.findCollectingChannel = original;
			}
			return { data, calls };
		};

		test('リモートの公開のノートでハッシュタグが一致すれば、チャンネルに入れる', async () => {
			const { data } = await collect({ channel: null, visibility: 'public', localOnly: false, apHashtags: ['連合チャンネル_雑談'] });
			expect(data.channel).toBe(federatedChannel);
		});

		test.each(['home', 'followers', 'specified'])('公開以外 (%s) は入れない', async (visibility) => {
			const { data, calls } = await collect({ channel: null, visibility, localOnly: false, apHashtags: ['連合チャンネル_雑談'] });
			expect(data.channel).toBe(null);
			expect(calls.length).toBe(0);
		});

		test('ローカルのユーザーのノートは入れない', async () => {
			const { data, calls } = await collect({ channel: null, visibility: 'public', localOnly: false, apHashtags: ['連合チャンネル_雑談'] }, localUser);
			expect(data.channel).toBe(null);
			expect(calls.length).toBe(0);
		});

		test('リプライでチャンネルが決まっていれば、そちらを優先する', async () => {
			const { data, calls } = await collect({ channel: replyChannel, visibility: 'public', localOnly: false, apHashtags: ['連合チャンネル_雑談'] });
			expect(data.channel).toBe(replyChannel);
			expect(calls.length).toBe(0);
		});

		test('一致するチャンネルがなければ入れない', async () => {
			const { data } = await collect({ channel: null, visibility: 'public', localOnly: false, apHashtags: ['ほかのタグ'] });
			expect(data.channel).toBe(null);
		});

		test('AP の tag になくても、本文の付記にハッシュタグがあれば入れ、ノートのハッシュタグにも足す (古い MISTEMS の付記)', async () => {
			const { data } = await collect({
				channel: null, visibility: 'public', localOnly: false, apHashtags: ['ほかのタグ'],
				text: 'hello\n\nFrom: 「雑談」 #連合チャンネル_雑談 https://b.test/channels/x',
			});
			expect(data.channel).toBe(federatedChannel);
			expect(data.apHashtags).toEqual(['ほかのタグ', '連合チャンネル_雑談']);
		});

		test('AP の tag と本文の両方にあるハッシュタグは、ノートのハッシュタグに重ねない', async () => {
			const { data } = await collect({
				channel: null, visibility: 'public', localOnly: false, apHashtags: ['連合チャンネル_雑談'],
				text: 'hello\n\n#連合チャンネル_雑談',
			});
			expect(data.channel).toBe(federatedChannel);
			expect(data.apHashtags).toEqual(['連合チャンネル_雑談']);
		});

		test('本文のふつうのハッシュタグは、収蔵の判定に使わない', async () => {
			const { data, calls } = await collect({ channel: null, visibility: 'public', localOnly: false, apHashtags: [], text: 'hello #雑談' });
			expect(data.channel).toBe(null);
			expect(calls.length).toBe(0);
		});

		test('中身のないリノートは入れない', async () => {
			const { data, calls } = await collect({ channel: null, visibility: 'public', localOnly: false, apHashtags: ['連合チャンネル_雑談'], renote: { id: 'x' } });
			expect(data.channel).toBe(null);
			expect(calls.length).toBe(0);
		});
	});
});
