// a.test の misskey コンテナの中で `node --input-type=module - <add-relay|list>` として実行する。
// 管理者 (admin / admin) は、テストを一度実行すると utils.ts の fetchAdmin が作る。
const base = 'http://127.0.0.1:3000/api/';
const api = async (endpoint, body) => {
	const res = await fetch(base + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
	const text = await res.text();
	if (!res.ok) throw new Error(`${endpoint} ${res.status} ${text}`);
	return text ? JSON.parse(text) : null;
};

const { i } = await api('signin-flow', { username: 'admin', password: 'admin' });
const inbox = 'https://b.test/inbox';

if (process.argv[2] === 'add-relay') {
	const relays = await api('admin/relays/list', { i });
	if (!relays.some(r => r.inbox === inbox)) await api('admin/relays/add', { i, inbox });
}
console.log(JSON.stringify(await api('admin/relays/list', { i })));
