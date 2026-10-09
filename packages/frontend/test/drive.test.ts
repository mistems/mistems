/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/vue';
import { ref } from 'vue';
import { preferReactive, preferState } from './init.js';
import { components } from '@/components/index.js';
import MkDrive from '@/components/MkDrive.vue';

// 描画にのみ影響するディレクティブはno-opで十分。
// v-panel など実装が themeManager に依存するものを呼ばないようにする。
const noopDirective = { mounted: () => {}, updated: () => {}, beforeUnmount: () => {} };
const stubDirectives = new Proxy({} as Record<string, typeof noopDirective>, {
	get: () => noopDirective,
});
import 'intersection-observer';

const misskeyApiMock = vi.hoisted(() => vi.fn());

vi.mock('@/utility/misskey-api.js', () => ({
	misskeyApi: misskeyApiMock,
	misskeyApiGet: misskeyApiMock,
	pendingApiRequestsCount: { value: 0 },
}));

vi.mock('@/stream.js', () => ({
	useStream: () => ({
		useChannel: () => ({
			on: vi.fn(),
			off: vi.fn(),
			send: vi.fn(),
			dispose: vi.fn(),
		}),
	}),
}));

vi.mock('@/store.js', () => ({
	store: {
		s: { realtimeMode: false },
		r: {
			tips: { value: { drive: true } },
		},
	},
}));

vi.mock('@/i.js', () => ({
	$i: null,
	iAmModerator: false,
	iAmAdmin: false,
	notesCount: 0,
	ensureSignin: vi.fn(),
	incNotesCount: vi.fn(),
	updateAccount: vi.fn(),
	updateAccountPartial: vi.fn(),
	refreshAccount: vi.fn(),
	login: vi.fn(),
	signout: vi.fn(),
	signoutAndRemoveAccount: vi.fn(),
	signoutAndRemoveAccounts: vi.fn(),
	getAccounts: vi.fn(() => []),
	addAccount: vi.fn(),
	removeAccount: vi.fn(),
}));

const folderA = {
	id: 'folderA',
	createdAt: '1970-01-01T00:00:00.000Z',
	name: 'FolderA',
	parentId: null,
	foldersCount: 0,
	filesCount: 1,
};

function makeFile(overrides: { id: string; name: string; folderId: string | null }) {
	return {
		id: overrides.id,
		createdAt: '1970-01-01T00:00:00.000Z',
		name: overrides.name,
		type: 'image/png',
		md5: '00000000000000000000000000000000',
		size: 1,
		isSensitive: false,
		blurhash: null,
		properties: {},
		url: 'https://example.local/dummy.png',
		thumbnailUrl: null,
		comment: null,
		folderId: overrides.folderId,
		folder: null,
		userId: null,
		user: null,
	};
}

const rootFile = makeFile({ id: 'file-root', name: 'rootFile', folderId: null });
const folderAFile = makeFile({ id: 'file-A', name: 'fileInA', folderId: 'folderA' });

describe('MkDrive', () => {
	beforeEach(() => {
		// MkDrive が参照する prefer のキーを補う
		preferState.enableInfiniteScroll = false;
		preferState.animation = false;
		preferReactive.enableInfiniteScroll = ref(false);
		preferReactive.animation = ref(false);
		preferState.uploadFolder = null;

		misskeyApiMock.mockImplementation(async (endpoint: string, params: any = {}) => {
			if (endpoint === 'drive/folders') {
				return params.folderId == null ? [folderA] : [];
			}
			if (endpoint === 'drive/files') {
				return params.folderId == null ? [rootFile] : [folderAFile];
			}
			if (endpoint === 'drive/folders/show') {
				return { ...folderA, parent: null };
			}
			return null;
		});
	});

	afterEach(() => {
		cleanup();
		misskeyApiMock.mockReset();
	});

	test('フォルダ遷移時にファイルの複数選択状態がクリアされる', async () => {
		const onChangeSelectedFiles = vi.fn();

		const view = render(MkDrive, {
			props: {
				select: 'file' as const,
				multiple: true,
				onChangeSelectedFiles,
			},
			global: { directives: stubDirectives, components },
		});

		// 初期表示: root のファイル/フォルダが描画されるまで待つ
		await waitFor(() => {
			expect(view.queryByText('rootFile')).toBeTruthy();
			expect(view.queryByText('FolderA')).toBeTruthy();
		});

		// ファイルをクリックして選択
		await fireEvent.click(view.getByText('rootFile'));

		expect(onChangeSelectedFiles).toHaveBeenLastCalledWith([
			expect.objectContaining({ id: 'file-root' }),
		]);

		// フォルダをクリックして遷移
		await fireEvent.click(view.getByText('FolderA'));

		// 遷移後、FolderA 配下のファイルが描画されるまで待つ
		await waitFor(() => {
			expect(view.queryByText('fileInA')).toBeTruthy();
			expect(view.queryByText('rootFile')).toBeFalsy();
		});

		// フォルダ切替時に選択状態が空配列に戻ること
		expect(onChangeSelectedFiles).toHaveBeenLastCalledWith([]);
	});
});
