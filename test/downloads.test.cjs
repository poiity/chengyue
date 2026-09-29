const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { DownloadManager } = require(process.env.PIXIV_LIGHT_DOWNLOAD_MODULE || '../src/downloads.cjs');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
function fakeClient({ failAt = 0, delay = 0 } = {}) {
  let fetchCount = 0;
  return {
    async detail(id) { return { id, title: `作品${id}`, userName: '画师', type: 0, pages: Array.from({length: 14}, (_, i) => ({ original: `https://i.pximg.net/${id}_p${i}.png` })) }; },
    async fetch(url, { signal }) {
      if (delay) await new Promise((resolve, reject) => { const timer = setTimeout(resolve, delay); signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('cancelled')); }, {once:true}); });
      signal.throwIfAborted(); if (++fetchCount === failAt) throw new Error('simulated failure');
      return new Response(png, { headers: { 'content-type': 'image/png' } });
    }
  };
}
async function fixture(t, opts) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'pixiv-light-test-'));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  return { dir, manager: new DownloadManager(fakeClient(opts), path.join(dir, 'state', 'jobs.json')) };
}
async function terminal(manager, id) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { manager.removeListener('change', check); reject(new Error('test timeout')); }, 10000);
    function check(jobs) { const j = jobs.find(j => j.id === id); if (j && !['queued', 'running'].includes(j.status)) { clearTimeout(timer); manager.removeListener('change', check); resolve(j); } }
    manager.on('change', check); check(manager.snapshot());
  });
}
function zipEntries(buffer) {
  const end = buffer.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));
  assert.ok(end > 0); const total = buffer.readUInt16LE(end + 10); let offset = buffer.readUInt32LE(end + 16); const entries = [];
  for (let i = 0; i < total; i++) {
    assert.equal(buffer.readUInt32LE(offset), 0x02014b50);
    const n = buffer.readUInt16LE(offset + 28), x = buffer.readUInt16LE(offset + 30), c = buffer.readUInt16LE(offset + 32);
    const size = buffer.readUInt32LE(offset + 20); const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + n).toString('utf8');
    const start = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    assert.deepEqual(buffer.subarray(start, start + size), png);
    entries.push(name); offset += 46 + n + x + c;
  }
  return entries;
}
test('gap-page original image download writes only requested pages', async t => {
  const { dir, manager } = await fixture(t);
  const id = manager.enqueue({ format: 'images', items: [{ id:'1', range:'1-4,9-13' }] }, dir);
  const job = await terminal(manager, id); assert.equal(job.status, 'completed'); assert.equal(job.done, 9);
  const files = await fsp.readdir(job.outputs[0]); assert.equal(files.length, 9); assert.ok(files.includes('1_p009.png')); assert.ok(!files.includes('1_p005.png'));
  assert.deepEqual(await fsp.readFile(path.join(job.outputs[0], files[0])), png);
  assert.equal((await fsp.readdir(dir)).filter(x => x.startsWith('.pixivlight-')).length, 0);
});
test('separate ZIP uses title + artist, UTF-8 names and valid image bytes', async t => {
  const { dir, manager } = await fixture(t);
  const job = await terminal(manager, manager.enqueue({ format:'separate', items:[{id:'1',range:'1,3'},{id:'2',range:'2'}] }, dir));
  assert.equal(job.status, 'completed'); assert.equal(job.outputs.length, 2);
  assert.equal(path.basename(job.outputs[0]), '作品1_画师.zip');
  assert.deepEqual(zipEntries(await fsp.readFile(job.outputs[0])), ['1_p001.png','1_p003.png']);
  assert.deepEqual(zipEntries(await fsp.readFile(job.outputs[1])), ['2_p002.png']);
});
test('combined ZIP preserves work selection order and sorts page ranges', async t => {
  const { dir, manager } = await fixture(t);
  const job = await terminal(manager, manager.enqueue({ format:'combined', items:[{id:'2',range:'4,1'},{id:'1',range:'9'}] }, dir));
  assert.equal(job.status, 'completed');
  assert.deepEqual(zipEntries(await fsp.readFile(job.outputs[0])), ['00001_作品2_画师_2_p001.png','00002_作品2_画师_2_p004.png','00003_作品1_画师_1_p009.png']);
});
test('existing files are not overwritten', async t => {
  const { dir, manager } = await fixture(t); const request = { format:'separate', items:[{id:'1',range:'1'}] };
  const first = await terminal(manager, manager.enqueue(request, dir));
  const second = await terminal(manager, manager.enqueue(request, dir));
  assert.notEqual(first.outputs[0], second.outputs[0]); assert.equal(path.basename(second.outputs[0]), '作品1_画师 (2).zip');
});
test('invalid ranges fail before saving files', async t => {
  const { dir, manager } = await fixture(t);
  const job = await terminal(manager, manager.enqueue({format:'images',items:[{id:'1',range:'15'}]}, dir));
  assert.equal(job.status,'failed'); assert.equal(job.outputs.length,0);
});
test('failed ZIP is not published and staging is cleaned; retry works', async t => {
  const { dir, manager } = await fixture(t, { failAt: 2 });
  const job = await terminal(manager, manager.enqueue({format:'combined',items:[{id:'1',range:'1-3'}]}, dir));
  assert.equal(job.status,'failed'); assert.equal(job.outputs.length,0); assert.equal((await fsp.readdir(dir)).filter(f => /zip|pixivlight/.test(f)).length, 0);
  assert.equal((await terminal(manager, manager.retry(job.id))).status, 'completed');
});
test('cancellation aborts active download and cleans staged partial images', async t => {
  const { dir, manager } = await fixture(t, { delay: 100 });
  const id = manager.enqueue({format:'combined',items:[{id:'1',range:'1-14'}]},dir);
  setTimeout(() => manager.cancel(id), 30);
  assert.equal((await terminal(manager,id)).status,'cancelled');
  assert.equal((await fsp.readdir(dir)).filter(f => f.startsWith('.pixivlight-')).length,0);
});
test('queued jobs run FIFO; cancelled queued job stays cancelled', async t => {
  const { dir, manager } = await fixture(t, {delay:15});
  const a=manager.enqueue({format:'images',items:[{id:'1',range:'1-2'}]},dir);
  const b=manager.enqueue({format:'images',items:[{id:'2',range:'1'}]},dir);
  manager.cancel(b); await terminal(manager,a); assert.equal(manager.snapshot().find(j=>j.id===b).status,'cancelled');
});
test('unfinished history is marked interrupted after restart', async t => {
  const { dir, manager } = await fixture(t);
  await fsp.mkdir(path.dirname(manager.historyPath),{recursive:true});
  await fsp.writeFile(manager.historyPath,JSON.stringify([{id:'old',status:'running'}]));
  const restored = new DownloadManager(fakeClient(),manager.historyPath);
  assert.equal(restored.snapshot()[0].status,'interrupted');
});
test('shutdown cancels active and queued work instead of starting another task', async t => {
  const {dir,manager}=await fixture(t,{delay:80});
  const a=manager.enqueue({format:'combined',items:[{id:'1',range:'1-3'}]},dir);
  const b=manager.enqueue({format:'combined',items:[{id:'2',range:'1'}]},dir);
  manager.shutdown();
  assert.equal((await terminal(manager,a)).status,'cancelled');
  assert.equal(manager.snapshot().find(j=>j.id===b).status,'cancelled');
});
test('ZIP publication falls back to an exclusive copy on drives without hard links', async t => {
  const { dir, manager } = await fixture(t);
  const link = fsp.link; fsp.link = async () => { throw Object.assign(new Error('not supported'), { code: 'ENOTSUP' }); };
  t.after(() => { fsp.link = link; });
  await fsp.writeFile(path.join(dir, '作品1_画师.zip'), 'keep');
  const job = await terminal(manager, manager.enqueue({ items: [{ id: '1', range: '1-2' }], format: 'combined' }, dir));
  assert.equal(job.status, 'completed', job.error);
  assert.equal(path.basename(job.outputs[0]), '作品1_画师 (2).zip');
  assert.equal(await fsp.readFile(path.join(dir, '作品1_画师.zip'), 'utf8'), 'keep');
  assert.equal(zipEntries(await fsp.readFile(job.outputs[0])).length, 2);
  assert.deepEqual((await fsp.readdir(dir)).filter(f => f.startsWith('.pixivlight-')), []);
});
