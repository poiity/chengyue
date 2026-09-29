// Download queue: original pages, animated works (GIF or original frames) and ZIP packaging.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');
const { writeZip } = require('./zip.cjs');
const { encodeGif } = require('./gif.cjs');
const { parsePages, artworkName, validateId, imageUrl } = require('./core.cjs');

const FORMATS = ['images', 'separate', 'combined'];
const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif'];
const NO_HARD_LINKS = ['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EXDEV'];
async function availablePath(dir, name, ext = '') {
  for (let n = 0; n < 10000; n++) {
    const candidate = path.join(dir, `${name}${n ? ` (${n + 1})` : ''}${ext}`);
    try { await fsp.access(candidate); } catch (e) { if (e.code === 'ENOENT') return candidate; throw e; }
  }
  throw new Error('目标目录中有过多同名文件');
}
// Creates a new folder without ever reusing one another program created at the same moment.
async function newFolder(dir, name) {
  for (;;) {
    const folder = await availablePath(dir, name);
    try { await fsp.mkdir(folder); return folder; } catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
}
class DownloadManager extends EventEmitter {
  // decodeImage(buffer, mime) -> { bgra, width, height } is supplied by the Electron main process.
  constructor(client, historyPath, { decodeImage } = {}) {
    super(); this.client = client; this.historyPath = historyPath; this.decodeImage = decodeImage; this.jobs = []; this.active = false;
    try { this.jobs = JSON.parse(fs.readFileSync(historyPath, 'utf8')).slice(0, 100).map(j => ({ ...j, status: ['queued', 'running'].includes(j.status) ? 'interrupted' : j.status })); } catch {}
  }
  snapshot() { return this.jobs.map(({ controller, ...job }) => structuredClone(job)); }
  changed() {
    const data = this.snapshot();
    try { fs.mkdirSync(path.dirname(this.historyPath), { recursive: true }); fs.writeFileSync(this.historyPath + '.tmp', JSON.stringify(data.slice(0, 100))); fs.renameSync(this.historyPath + '.tmp', this.historyPath); } catch {}
    this.emit('change', data);
  }
  enqueue(request, directory) {
    if (!Array.isArray(request.items) || !request.items.length || request.items.length > 500) throw new Error('请选择 1–500 个作品');
    if (!FORMATS.includes(request.format)) throw new Error('下载格式无效');
    if (this.jobs.filter(j => ['queued', 'running'].includes(j.status)).length >= 20) throw new Error('下载队列已满，请等待已有任务完成');
    const items = request.items.map(item => ({ id: validateId(item.id), range: String(item.range || '').slice(0, 2000), title: String(item.title || '').slice(0, 160), ugoira: item.ugoira === 'frames' ? 'frames' : 'gif' }));
    const job = { id: randomUUID(), items, format: request.format, directory, status: 'queued', done: 0, total: 0, bytes: 0, current: '等待开始', outputs: [], createdAt: new Date().toISOString(), error: '' };
    this.jobs.unshift(job); this.changed(); this.run(); return job.id;
  }
  cancel(id) {
    const job = this.jobs.find(j => j.id === id);
    if (!job) throw new Error('任务不存在');
    if (job.status === 'queued') { job.status = 'cancelled'; job.current = '已取消'; }
    if (job.status === 'running') job.controller.abort();
    this.changed();
  }
  retry(id) {
    const job = this.jobs.find(j => j.id === id);
    if (!job || !['failed', 'cancelled', 'interrupted'].includes(job.status)) throw new Error('此任务无需重试');
    return this.enqueue({ items: job.items, format: job.format }, job.directory);
  }
  async run() {
    if (this.active) return;
    this.active = true;
    try {
      let job;
      while ((job = [...this.jobs].reverse().find(j => j.status === 'queued'))) {
        job.controller = new AbortController(); job.status = 'running'; job.current = '读取作品信息…'; this.changed();
        try {
          await this.execute(job, job.controller.signal);
          job.status = 'completed'; job.current = '下载完成';
        } catch (e) {
          job.status = job.controller.signal.aborted ? 'cancelled' : 'failed';
          job.error = job.status === 'cancelled' ? '' : e.message;
          job.current = job.status === 'cancelled' ? '已取消' : '下载未完成';
          if (job.status === 'failed') this.emit('failure', e);
        }
        delete job.controller; job.finishedAt = new Date().toISOString(); this.changed();
      }
    } finally { this.active = false; }
  }
  progress(job, text) { job.current = text; this.changed(); }
  // Downloads one original page into the staging folder.
  async fetchPage(job, work, page, staging, index, signal) {
    const url = imageUrl(work.pages[page - 1].original);
    const ext = path.extname(new URL(url).pathname).toLowerCase();
    if (!IMAGE_EXT.includes(ext)) throw new Error('不支持的原图文件格式');
    const name = `${work.id}_p${String(page).padStart(3, '0')}${ext}`, tmp = path.join(staging, `${index}-${name}.partial`);
    const response = await this.client.fetch(url, { signal, image: true });
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(tmp, { flags: 'wx' }), { signal });
    return { tmp, name };
  }
  // Exports an animated work as one GIF, or as its original frames plus animation.json (frame timing).
  async fetchUgoira(job, work, mode, staging, index, signal) {
    this.progress(job, `${work.title} · 读取动图帧…`);
    const { frames, mime } = await this.client.ugoiraFrames(work.id, { original: true, signal });
    if (mode === 'frames') {
      const files = [];
      for (const frame of frames) {
        const tmp = path.join(staging, `${index}-${frame.file}.partial`);
        await fsp.writeFile(tmp, frame.data, { flag: 'wx' }); files.push({ tmp, name: `${work.id}_${frame.file}` });
      }
      const timing = path.join(staging, `${index}-animation.json.partial`);
      await fsp.writeFile(timing, JSON.stringify({ id: work.id, title: work.title, mime, frames: frames.map(f => ({ file: `${work.id}_${f.file}`, delay: f.delay })) }, null, 2), { flag: 'wx' });
      return [...files, { tmp: timing, name: `${work.id}_animation.json` }];
    }
    if (!this.decodeImage) throw new Error('当前环境无法合成 GIF');
    const tmp = path.join(staging, `${index}-${work.id}.gif.partial`), handle = await fsp.open(tmp, 'wx');
    try {
      await encodeGif({
        frameCount: frames.length, signal,
        readFrame: async i => ({ ...this.decodeImage(frames[i].data, mime), delay: frames[i].delay }),
        write: buffer => handle.write(buffer),
        onProgress: (phase, done, total) => { if (done === total || done % 5 === 0) this.progress(job, `${work.title} · ${phase === 'analyse' ? '分析颜色' : '合成 GIF'} ${done} / ${total} 帧`); }
      });
    } finally { await handle.close(); }
    return [{ tmp, name: `${work.id}_ugoira.gif` }];
  }
  async execute(job, signal) {
    await fsp.mkdir(job.directory, { recursive: true });
    const prepared = [];
    for (const item of job.items) {
      signal.throwIfAborted();
      const work = await this.client.detail(item.id, signal);
      const pages = work.type === 2 ? [] : parsePages(item.range, work.pages.length);
      prepared.push({ work, pages, ugoira: work.type === 2 ? item.ugoira || 'gif' : null });
      job.total += work.type === 2 ? 1 : pages.length;
    }
    // This private staging directory is the only directory ever recursively removed.
    const staging = await fsp.mkdtemp(path.join(job.directory, '.pixivlight-'));
    try {
      const merged = []; let sequence = 0;
      for (let index = 0; index < prepared.length; index++) {
        const { work, pages, ugoira } = prepared[index];
        const base = artworkName(work), folder = job.format === 'images' ? await newFolder(job.directory, base) : null, files = [];
        if (folder) job.outputs.push(folder);
        const place = async produced => {
          for (const file of produced) {
            const size = (await fsp.stat(file.tmp)).size;
            if (!size) throw new Error('服务器返回了空文件');
            job.bytes += size;
            if (folder) await fsp.rename(file.tmp, path.join(folder, file.name));
            else { files.push({ path: file.tmp, name: file.name }); merged.push({ path: file.tmp, name: `${String(++sequence).padStart(5, '0')}_${base}_${file.name}` }); }
          }
          job.done++; this.changed();
        };
        if (ugoira) await place(await this.fetchUgoira(job, work, ugoira, staging, index, signal));
        for (const page of pages) {
          signal.throwIfAborted();
          this.progress(job, `${work.title} · 第 ${page} / ${work.pages.length} 页`);
          await place([await this.fetchPage(job, work, page, staging, index, signal)]);
        }
        if (job.format === 'separate') {
          this.progress(job, `正在打包：${work.title}`);
          const zip = path.join(staging, `archive-${index}.zip.partial`);
          await writeZip(files, zip, signal);
          job.outputs.push(await this.publish(zip, job.directory, base, signal));
        }
      }
      if (job.format === 'combined') {
        this.progress(job, '正在合并打包…');
        const base = prepared.length === 1 ? artworkName(prepared[0].work) : `${artworkName(prepared[0].work)}_等${prepared.length}部作品`;
        const zip = path.join(staging, 'combined.zip.partial');
        await writeZip(merged, zip, signal);
        job.outputs.push(await this.publish(zip, job.directory, base, signal));
      }
    } finally { await fsp.rm(staging, { recursive: true, force: true }); }
  }
  async publish(tmp, dir, base, signal) {
    signal.throwIfAborted();
    // Hard-link publication is atomic, on the same volume, and refuses overwrites.
    for (;;) {
      const output = await availablePath(dir, base, '.zip');
      try { await fsp.link(tmp, output); return output; } catch (e) {
        if (e.code === 'EEXIST') continue;
        if (!NO_HARD_LINKS.includes(e.code)) throw e;
      }
      // exFAT / FAT32 drives (common for external disks on macOS) have no hard links: an exclusive copy also refuses overwrites.
      try { await fsp.copyFile(tmp, output, fs.constants.COPYFILE_EXCL); return output; } catch (e) {
        if (e.code === 'EEXIST') continue;
        await fsp.rm(output, { force: true }); throw e;
      }
    }
  }
  // Removes finished records only; files already saved and running or queued jobs are untouched.
  clearHistory() {
    const before = this.jobs.length;
    this.jobs = this.jobs.filter(j => ['queued', 'running'].includes(j.status));
    this.changed(); return { removed: before - this.jobs.length };
  }
  shutdown() {
    this.jobs.forEach(j => { if (j.status === 'queued') { j.status = 'cancelled'; j.current = '程序关闭，任务已取消'; } j.controller?.abort(); });
    this.changed();
  }
}
module.exports = { DownloadManager, availablePath };
