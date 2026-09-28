const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { writeZip, readZip } = require('../src/zip.cjs');
const { encodeGif } = require('../src/gif.cjs');
const { restrictedWork } = require('../src/core.cjs');
const { rankCandidates } = require('../src/recommend.cjs');
const { Library } = require('../src/library.cjs');
const { PixivClient } = require('../src/pixiv.cjs');
const { DownloadManager } = require('../src/downloads.cjs');
const { redact, Logger } = require('../src/log.cjs');

async function tempDir(t) { const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'pixiv-v5-')); t.after(() => fsp.rm(dir, { recursive: true, force: true })); return dir; }

// Independent GIF reader used only to verify the encoder output.
function decodeGif(buf) {
  assert.equal(buf.toString('latin1', 0, 6), 'GIF89a');
  const width = buf.readUInt16LE(6), height = buf.readUInt16LE(8), packed = buf[10];
  let at = 13; const palette = packed & 0x80 ? buf.subarray(at, at += 3 * (1 << ((packed & 7) + 1))) : null;
  const frames = []; let delay = 0, loop = false;
  while (buf[at] !== 0x3b) {
    if (buf[at] === 0x21) {
      const label = buf[at + 1]; at += 2;
      if (label === 0xf9) delay = buf.readUInt16LE(at + 2) * 10;
      if (label === 0xff && buf.toString('latin1', at + 1, at + 12) === 'NETSCAPE2.0') loop = true;
      while (buf[at]) at += buf[at] + 1; at++;
    } else if (buf[at] === 0x2c) {
      const w = buf.readUInt16LE(at + 5), h = buf.readUInt16LE(at + 7); at += 10;
      const min = buf[at++], data = [];
      while (buf[at]) { data.push(...buf.subarray(at + 1, at + 1 + buf[at])); at += buf[at] + 1; } at++;
      // LZW decode
      const clear = 1 << min, eoi = clear + 1; let size = min + 1, dict, prev = null, bits = 0, acc = 0, pos = 0; const out = [];
      const reset = () => { dict = Array.from({ length: clear }, (_, i) => [i]); dict.push(null, null); size = min + 1; prev = null; };
      reset();
      for (;;) {
        while (bits < size) { acc |= data[pos++] << bits; bits += 8; }
        const code = acc & ((1 << size) - 1); acc >>>= size; bits -= size;
        if (code === clear) { reset(); continue; } if (code === eoi) break;
        let entry = code < dict.length ? dict[code] : [...dict[prev], dict[prev][0]];
        out.push(...entry);
        if (prev !== null && dict.length < 4096) dict.push([...dict[prev], entry[0]]);
        if (dict.length === (1 << size) && size < 12) size++;
        prev = code;
      }
      assert.equal(out.length, w * h);
      frames.push({ delay, pixels: out.map(i => [palette[i * 3], palette[i * 3 + 1], palette[i * 3 + 2]]) });
    } else throw new Error('bad block');
  }
  return { width, height, frames, loop };
}
function bgraFrame(width, height, colour) { const b = Buffer.alloc(width * height * 4); for (let i = 0; i < b.length; i += 4) { const [r, g, bl] = colour(i / 4 % width, Math.floor(i / 4 / width)); b[i] = bl; b[i + 1] = g; b[i + 2] = r; b[i + 3] = 255; } return b; }

test('ZIP writer round-trips files and in-memory data with UTF-8 names', async t => {
  const dir = await tempDir(t), file = path.join(dir, 'a.bin');
  await fsp.writeFile(file, Buffer.from('hello'));
  const target = path.join(dir, 'out.zip');
  await writeZip([{ path: file, name: '画像_1.png' }, { data: Buffer.from([1, 2, 3]), name: 'animation.json' }], target);
  const entries = readZip(await fsp.readFile(target));
  assert.deepEqual([...entries.keys()], ['画像_1.png', 'animation.json']);
  assert.equal(entries.get('画像_1.png').toString(), 'hello'); assert.deepEqual([...entries.get('animation.json')], [1, 2, 3]);
});
test('an aborted ZIP leaves no partial archive behind', async t => {
  const dir = await tempDir(t), target = path.join(dir, 'x.zip'), controller = new AbortController();
  await fsp.writeFile(path.join(dir, 'f'), 'x'); controller.abort();
  await assert.rejects(writeZip([{ path: path.join(dir, 'f'), name: 'f' }], target, controller.signal));
  assert.equal(fs.existsSync(target), false);
});
test('ZIP reader rejects damaged archives', () => {
  assert.throws(() => readZip(Buffer.from('not a zip')), /格式无效/);
});
test('GIF encoder produces looping frames with timing and faithful colours', async () => {
  const width = 37, height = 23, chunks = [];
  const frames = [
    { bgra: bgraFrame(width, height, x => x < 18 ? [255, 0, 0] : [0, 0, 255]), width, height, delay: 30 },
    { bgra: bgraFrame(width, height, (x, y) => [x * 6, y * 10, 128]), width, height, delay: 120 }
  ];
  await encodeGif({ frameCount: 2, readFrame: async i => frames[i], write: async b => { chunks.push(Buffer.from(b)); } });
  const gif = decodeGif(Buffer.concat(chunks));
  assert.equal(gif.width, width); assert.equal(gif.height, height); assert.equal(gif.loop, true);
  assert.deepEqual(gif.frames.map(f => f.delay), [30, 120]);
  assert.deepEqual(gif.frames[0].pixels[0], [255, 0, 0]); assert.deepEqual(gif.frames[0].pixels[width - 1], [0, 0, 255]);
  const sample = gif.frames[1].pixels[10 * width + 20], expected = [120, 100, 128];
  assert.ok(sample.every((v, i) => Math.abs(v - expected[i]) <= 12), `colour ${sample} ≈ ${expected}`);
});
test('GIF encoder handles long runs that exceed the 4096-code table', async () => {
  const width = 300, height = 200, chunks = [];
  const frame = { bgra: bgraFrame(width, height, (x, y) => [(x * 7 + y * 13) % 256, (x * y) % 256, (x + y) % 256]), width, height, delay: 50 };
  await encodeGif({ frameCount: 1, readFrame: async () => frame, write: async b => { chunks.push(Buffer.from(b)); } });
  assert.equal(decodeGif(Buffer.concat(chunks)).frames[0].pixels.length, width * height);
});
test('adult, R-18-tagged and Pixiv-sensitive works are hidden unless 18+ is on', () => {
  assert.equal(restrictedWork({ xRestrict: 0, sl: 2, tags: ['風景'] }), false);
  assert.equal(restrictedWork({ xRestrict: 1 }), true);
  assert.equal(restrictedWork({ xRestrict: 0, sl: 6 }), true);
  assert.equal(restrictedWork({ xRestrict: 0, tags: [{ tag: 'R-18' }] }), true);
  assert.equal(restrictedWork({ xRestrict: 0, tags: ['r18g'] }), true);
  let n = 0; const base = { bookmarkKnown: true, bookmarkData: null, tags: [], get userId() { return String(++n); } };
  const works = [{ ...base, id: 'safe', xRestrict: 0, sl: 2 }, { ...base, id: 'sensitive', xRestrict: 0, sl: 6 }, { ...base, id: 'tagged', xRestrict: 0, tags: ['R-18'] }, { ...base, id: 'r18', xRestrict: 1 }, { ...base, id: 'r18g', xRestrict: 2 }];
  assert.deepEqual(rankCandidates(works, []).map(w => w.id), ['safe']);
  assert.deepEqual(rankCandidates(works, [], { allowR18: true }).map(w => w.id).sort(), ['r18', 'safe', 'sensitive', 'tagged']);
});
test('a follow category becomes one newest-first artwork list across all its artists', async () => {
  const calls = [];
  const users = page => page === 1
    ? [{ userId: '1', userName: 'A', illusts: [{ id: '10', createDate: '2026-01-01T00:00:00+09:00', userName: 'A' }, { id: '30', createDate: '2026-03-01T00:00:00+09:00', userName: 'A' }] }]
    : [{ userId: '2', userName: 'B', illusts: [{ id: '20', createDate: '2026-02-01T00:00:00+09:00' }, null] }];
  const lib = new Library({ account: { id: '7' }, api: async (route, params) => { calls.push(params); return { total: 25, users: users(params.offset ? 2 : 1), followUserTags: ['风景'] }; } });
  const result = await lib.followingWorks({ tag: '风景', rest: 'hide' });
  assert.deepEqual(result.works.map(w => w.id), ['30', '20', '10']);
  assert.equal(result.works[1].userName, 'B'); assert.equal(result.total, 3);
  assert.ok(calls.every(p => p.tag === '风景' && p.rest === 'hide')); assert.equal(calls.length, 2);
  await lib.followingWorks({ tag: '风景', rest: 'hide', page: 1 }); assert.equal(calls.length, 2, 'category index is cached');
});
test('logs redact session cookies, CSRF tokens and the Windows user folder', () => {
  const home = os.homedir();
  const text = redact(`Cookie: PHPSESSID=123_abcDEF; x-csrf-token: deadbeef {"token":"secret"} ${home}\\AppData C:\\Users\\someone\\x ?tt=abc`);
  for (const secret of ['123_abcDEF', 'deadbeef', 'secret', home, 'someone', 'tt=abc']) assert.ok(!text.includes(secret), `${secret} leaked: ${text}`);
});
test('the logger writes, de-duplicates and rotates', async t => {
  const dir = await tempDir(t), log = new Logger(dir);
  const error = new TypeError('boom'); log.error('ipc', error); log.error('ipc', error);
  const content = await fsp.readFile(log.file, 'utf8');
  assert.equal(content.match(/boom/g).length, 1); assert.match(content, /\[ERROR\] ipc: boom/);
  await fsp.writeFile(log.file, 'x'.repeat(1024 * 1024 + 1)); log.info('app', 'after rotation');
  assert.ok(fs.existsSync(path.join(dir, 'pixiv-light.old.log')));
});
async function ugoiraClient(t) {
  const dir = await tempDir(t), zip = path.join(dir, 'u.zip');
  await writeZip([{ data: Buffer.from('frame-a'), name: '000000.jpg' }, { data: Buffer.from('frame-b'), name: '000001.jpg' }], zip);
  const archive = await fsp.readFile(zip);
  const client = new PixivClient({ fetch: async url => url.includes('/ugoira_meta')
    ? Response.json({ error: false, body: { src: 'https://i.pximg.net/u600.zip', originalSrc: 'https://i.pximg.net/u1920.zip', mime_type: 'image/jpeg', frames: [{ file: '000000.jpg', delay: 40 }, { file: '000001.jpg', delay: 80 }] } })
    : new Response(archive, { headers: { 'content-type': 'application/zip' } }) });
  return { client, dir };
}
test('ugoira frames are read in order with their timing; unsafe frame names are rejected', async t => {
  const { client } = await ugoiraClient(t);
  const { frames, mime } = await client.ugoiraFrames('5');
  assert.equal(mime, 'image/jpeg'); assert.deepEqual(frames.map(f => [f.file, f.delay, f.data.toString()]), [['000000.jpg', 40, 'frame-a'], ['000001.jpg', 80, 'frame-b']]);
  const bad = new PixivClient({ fetch: async () => Response.json({ error: false, body: { src: 'https://i.pximg.net/a.zip', frames: [{ file: '../x.jpg', delay: 10 }] } }) });
  await assert.rejects(bad.ugoira('5'), /帧信息/);
  const foreign = new PixivClient({ fetch: async () => Response.json({ error: false, body: { src: 'https://evil.example/a.zip', frames: [{ file: 'a.jpg', delay: 10 }] } }) });
  await assert.rejects(foreign.ugoira('5'), /Pixiv 图片服务器/);
});
async function terminal(manager, id) {
  for (;;) { const job = manager.snapshot().find(j => j.id === id); if (!['queued', 'running'].includes(job.status)) return job; await new Promise(r => setTimeout(r, 20)); }
}
test('animated works download as original frames with animation.json, or as a GIF', async t => {
  const { client, dir } = await ugoiraClient(t);
  client.detail = async id => ({ id, title: '动图', userName: '画师', type: 2, pages: [{ original: 'https://i.pximg.net/p0.jpg' }] });
  const decodeImage = data => ({ width: 4, height: 2, bgra: bgraFrame(4, 2, () => data.toString() === 'frame-a' ? [255, 0, 0] : [0, 255, 0]) });
  const manager = new DownloadManager(client, path.join(dir, 'jobs.json'), { decodeImage });
  const frames = await terminal(manager, manager.enqueue({ format: 'images', items: [{ id: '5', ugoira: 'frames' }] }, dir));
  assert.equal(frames.status, 'completed', frames.error);
  const folder = frames.outputs[0];
  assert.deepEqual((await fsp.readdir(folder)).sort(), ['5_000000.jpg', '5_000001.jpg', '5_animation.json']);
  assert.deepEqual(JSON.parse(await fsp.readFile(path.join(folder, '5_animation.json'), 'utf8')).frames, [{ file: '5_000000.jpg', delay: 40 }, { file: '5_000001.jpg', delay: 80 }]);
  const gif = await terminal(manager, manager.enqueue({ format: 'separate', items: [{ id: '5' }] }, dir));
  assert.equal(gif.status, 'completed', gif.error);
  const entries = readZip(await fsp.readFile(gif.outputs[0]));
  const decoded = decodeGif(entries.get('5_ugoira.gif'));
  assert.deepEqual(decoded.frames.map(f => [f.delay, f.pixels[0]]), [[40, [255, 0, 0]], [80, [0, 255, 0]]]);
});
