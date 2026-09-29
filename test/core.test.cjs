const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePages, safeName, artworkName, validateId, imageUrl, accountFromHtml, normalizeWork } = require('../src/core.cjs');
test('page selection handles gaps, duplicates, ordering, Chinese separators', () => {
  assert.deepEqual(parsePages('1-4,9-13', 14), [1,2,3,4,9,10,11,12,13]);
  assert.deepEqual(parsePages('9，2、3-5;4', 12), [2,3,4,5,9]);
  assert.deepEqual(parsePages('1至3, 8–9', 9), [1,2,3,8,9]);
  assert.deepEqual(parsePages('', 3), [1,2,3]);
});
test('invalid page selection is rejected before downloading', () => {
  for (const input of ['0', '-1', '5-2', '2-20', '1,,2', 'foo', '1.2', '1-2-3', '1,']) assert.throws(() => parsePages(input, 14));
  for (const count of [0, -1, Infinity, 10001, 1.5]) assert.throws(() => parsePages('', count));
});
test('Windows file names cannot escape destination or use reserved devices', () => {
  assert.equal(safeName('../../a:b?'), '.._.._a_b_');
  assert.equal(safeName('CON'), '_CON'); assert.equal(safeName('lpt1.png'), '_lpt1.png');
  assert.equal(safeName('  hello...  '), 'hello'); assert.equal(safeName(''), '未命名');
  assert.equal(artworkName({ title: '夏日', userName: '画师' }), '夏日_画师');
  assert.equal([...safeName('😃'.repeat(120))].length, 90);
});
test('artwork names fit the 255-byte file name limit of macOS', () => {
  const name = artworkName({ title: '😃'.repeat(48), userName: '𠮷'.repeat(28) });
  assert.ok(Buffer.byteLength(name) <= 220 && name.startsWith('😃'), name);
  assert.equal(artworkName({ title: '夏'.repeat(48), userName: '画'.repeat(20) }).length, 69);
});
test('IDs and image URLs are allowlisted', () => {
  assert.equal(validateId('1234'), '1234');
  for (const value of ['../x', '0', '12?x', '1;2', 'abc']) assert.throws(() => validateId(value));
  assert.equal(imageUrl('https://i.pximg.net/img/a.png'), 'https://i.pximg.net/img/a.png');
  for (const value of ['http://i.pximg.net/a', 'https://i.pximg.net.evil.com/x', 'https://127.0.0.1/a', 'file:///c:/x', 'https://evil.com@i.pximg.net/a', 'https://i.pximg.net:444/a']) assert.throws(() => imageUrl(value));
});
test('account extraction supports legacy meta and current Next.js state', () => {
  const html = '<meta id="meta-global-data" content="{&quot;userData&quot;:{&quot;id&quot;:&quot;123&quot;,&quot;name&quot;:&quot;A&amp;B&quot;,&quot;premium&quot;:true}}">';
  assert.deepEqual(accountFromHtml(html), { id: '123', name: 'A&B', premium: true, avatar: '' });
  const data = { props: { pageProps: { serverSerializedPreloadedState: JSON.stringify({ userData: { self: { userId: 123, userName: 'Me', isPremium: false } } }) } } };
  assert.equal(accountFromHtml(`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script>`).name, 'Me');
  assert.equal(accountFromHtml('<html>login</html>'), null);
});
test('untrusted artwork metadata stays plain data', () => {
  const work = normalizeWork({ id: 1, title: '<script>x</script>', tags: { tags: [{ tag: 'abc' }] }, urls: { small: 'https://i.pximg.net/a' }, pageCount: 4 });
  assert.equal(work.title, '<script>x</script>'); assert.deepEqual(work.tags, ['abc']); assert.equal(work.pageCount, 4);
});
