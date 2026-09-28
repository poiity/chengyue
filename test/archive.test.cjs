const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Archive, maskedWork, thumbnailUrl } = require('../src/archive.cjs');
const { Library } = require('../src/library.cjs');
const { DownloadManager } = require('../src/downloads.cjs');
const { Recommendations, TasteMemory } = require('../src/recommend.cjs');

async function tempDir(t) { const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'pixiv-archive-')); t.after(() => fsp.rm(dir, { recursive: true, force: true })); return dir; }
const until = async check => { for (let i = 0; i < 200 && !(await check()); i++) await new Promise(r => setTimeout(r, 10)); };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');

test('masked placeholders are recognised; thumbnails prefer Pixiv resized images', () => {
  assert.equal(maskedWork({ title: '-----', url: 'https://s.pximg.net/common/images/limit_unknown_360.png' }), true);
  assert.equal(maskedWork({ isMasked: true, title: 'x' }), true);
  assert.equal(maskedWork({ title: null }), true);
  assert.equal(maskedWork({ title: '夏', url: 'https://i.pximg.net/c/250x250_80_a2/img-master/a.jpg', userName: 'A' }), false);
  assert.equal(thumbnailUrl('https://i.pximg.net/img-master/img/2026/a_p0_master1200.jpg'), 'https://i.pximg.net/c/360x360_70/img-master/img/2026/a_p0_master1200.jpg');
  assert.equal(thumbnailUrl('https://i.pximg.net/c/250x250_80_a2/img-master/a.jpg'), 'https://i.pximg.net/c/250x250_80_a2/img-master/a.jpg');
  assert.equal(thumbnailUrl('https://evil.example/a.jpg'), '');
});

test('bookmarks seen in the app are archived and restored after the artist deletes them', async t => {
  const dir = await tempDir(t);
  let deleted = false, thumbFetches = 0;
  const visible = { id: '42', title: '夏の海', userId: '7', userName: '画师', url: 'https://i.pximg.net/c/250x250_80_a2/img-master/42.jpg', tags: ['風景', '海'], createDate: '2026-01-01T00:00:00+09:00', pageCount: 3, bookmarkData: { id: '900', private: false } };
  const masked = { id: '42', title: '-----', userId: '7', userName: '-----', url: 'https://s.pximg.net/common/images/limit_unknown_360.png', tags: [], isMasked: true, bookmarkData: { id: '900', private: false } };
  const client = {
    account: { id: '1' },
    api: async () => ({ total: 1, works: [deleted ? masked : visible] }),
    fetch: async () => { thumbFetches++; return new Response(png, { headers: { 'content-type': 'image/png' } }); }
  };
  const archive = new Archive(dir, client), lib = new Library(client, {}, () => {}, { archive });
  const first = await lib.bookmarks({});
  assert.equal(first.works[0].title, '夏の海'); assert.equal(first.works[0].masked, undefined);
  await until(() => archive.thumbnail('1', '42'));
  assert.ok(archive.thumbnail('1', '42')); assert.equal(thumbFetches, 1);
  await archive.save('1');

  deleted = true;
  const reopened = new Archive(dir, client), later = new Library(client, {}, () => {}, { archive: reopened });
  const [restored] = (await later.bookmarks({})).works;
  assert.equal(restored.masked, true); assert.equal(restored.archived, true);
  assert.equal(restored.title, '夏の海'); assert.equal(restored.userName, '画师'); assert.deepEqual(restored.tags, ['風景', '海']);
  assert.equal(restored.cover, 'archive:42'); assert.equal(restored.bookmarkData.id, '900');
  assert.deepEqual(await reopened.stats('1'), { count: 1, bytes: (await fsp.stat(path.join(dir, '1', '42.img'))).size + (await fsp.stat(path.join(dir, '1.json'))).size });

  await reopened.clear('1');
  const [unknown] = (await new Library(client, {}, () => {}, { archive: new Archive(dir, client) }).bookmarks({})).works;
  assert.equal(unknown.archived, false); assert.equal(unknown.title, '作品已删除或非公开'); assert.equal(unknown.cover, '');
});

test('the archive can be switched off and never writes outside its account folder', async t => {
  const dir = await tempDir(t), archive = new Archive(dir, {});
  archive.enabled = false; archive.remember('1', [{ id: '5', title: 'x' }]);
  assert.deepEqual(archive.index('1'), {});
  assert.equal(archive.thumbnail('1', '../../x'), null); assert.equal(archive.thumbnail('..', '5'), null);
  assert.throws(() => archive.index('../1'), /账号/);
});

test('bulk privacy changes use one edit_restrict call per 100 bookmarks; bulk removal reports progress', async t => {
  const writes = [];
  const client = { account: { id: '1' }, csrf: 't', session: { fetch: async (url, options) => { writes.push({ url, body: options.body }); return Response.json({ error: false, body: {} }); } } };
  const lib = new Library(client);
  const ids = Array.from({ length: 150 }, (_, i) => String(1000 + i));
  assert.deepEqual(await lib.setBookmarksPrivacy({ bookmarkIds: ids, private: true }), { count: 150 });
  assert.equal(writes.length, 2);
  assert.deepEqual(JSON.parse(writes[0].body).bookmarkIds.length, 100); assert.equal(JSON.parse(writes[1].body).bookmarkRestrict, 'private');
  await assert.rejects(lib.setBookmarksPrivacy({ bookmarkIds: ['x'], private: true }), /1–500/);
  await assert.rejects(lib.setBookmarksPrivacy({ bookmarkIds: ids, private: 'yes' }), /公开范围/);

  writes.length = 0; let calls = 0;
  client.session.fetch = async (url, options) => { writes.push({ url, body: options.body }); if (++calls === 2) throw new Error('network interruption'); return Response.json({ error: false, body: {} }); };
  await assert.rejects(lib.removeBookmarks({ items: [{ id: '5', bookmarkId: '1' }, { id: '6', bookmarkId: '2' }] }), /已取消 1 部后中断/);
  assert.equal(writes[0].url, 'https://www.pixiv.net/ajax/illusts/bookmarks/delete'); assert.equal(writes[0].body, 'bookmark_id=1');
});

test('clearing download history keeps running work and saved files', async t => {
  const dir = await tempDir(t), file = path.join(dir, 'jobs.json');
  await fsp.writeFile(file, JSON.stringify([{ id: 'a', status: 'completed' }, { id: 'b', status: 'failed' }, { id: 'c', status: 'cancelled' }]));
  const manager = new DownloadManager({}, file);
  manager.jobs.push({ id: 'd', status: 'running' });
  assert.deepEqual(manager.clearHistory(), { removed: 3 });
  assert.deepEqual(manager.snapshot().map(j => j.id), ['d']);
  assert.deepEqual(JSON.parse(await fsp.readFile(file, 'utf8')).map(j => j.id), ['d']);
});

test('guest recommendations need no per-work lookups; signed-in lookups are cached and the next page is prefetched', async t => {
  const dir = await tempDir(t);
  const ranking = page => Response.json({ contents: Array.from({ length: 30 }, (_, i) => ({ illust_id: String(page * 100 + i), user_id: String(i), title: 't', url: 'https://i.pximg.net/c/240x480/img-master/a.jpg', illust_content_type: { sexual: i === 0 ? 1 : 0 } })) });
  const calls = [], makeClient = account => ({ account, fetch: async url => ranking(Number(new URL(url).searchParams.get('p'))), api: async route => { calls.push(route); if (route.startsWith('discovery')) return { thumbnails: { illust: [] } }; return { id: route.split('/').pop(), title: 't', tags: [], bookmarkData: null, sl: 2 }; } });
  const guest = new Recommendations(makeClient(null), new TasteMemory(path.join(dir, 'g.json')));
  const page = await guest.list({ kind: 'hot' });
  assert.equal(calls.length, 0); assert.ok(page.works.every(w => w.id !== '100'), 'content-rated ranking work is hidden');

  await until(() => guest.cache.size === 2);
  const user = new Recommendations(makeClient({ id: '9' }), new TasteMemory(path.join(dir, 'u.json')));
  await user.list({ kind: 'hot', page: 1 });
  const afterFirst = calls.filter(r => r.startsWith('illust/')).length;
  assert.ok(afterFirst >= 30 && afterFirst <= 30 + 40, `looked up ${afterFirst}`);
  const page2 = JSON.stringify(['9', 2, false, 'hot']);
  await until(() => user.cache.has(page2));
  assert.ok(user.cache.has(page2), 'page 2 was prepared in the background');
  assert.strictEqual((await user.list({ kind: 'hot', page: 2 })).works.length, user.cache.get(page2).works.length);
  const lookups = calls.filter(r => r.startsWith('illust/'));
  const seen = new Set(), dup = lookups.filter(r => seen.has(r) || !seen.add(r)); assert.deepEqual(dup, [], 'no artwork detail is fetched twice');
});
