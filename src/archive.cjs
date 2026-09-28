// Local archive of bookmarked works. When an artist later deletes or hides a work, Pixiv only returns a
// "-----" placeholder; the archive keeps what the app saw before (title, artist, tags, date, thumbnail).
// Everything stays in the user's app-data folder and is never uploaded.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { imageUrl, tagText } = require('./core.cjs');

const MAX_THUMB = 400 * 1024;
const digits = value => /^\d{1,16}$/.test(String(value));
// Pixiv answers a deleted / private work with a masked placeholder instead of an error.
function maskedWork(raw) {
  return raw.isMasked === true || raw.title == null || raw.title === '-----' || /\/common\/images\/limit_/.test(raw.url || '') || (raw.userName === '-----');
}
// Prefer a small square thumbnail; full "regular" images are shrunk through Pixiv's own resize path.
function thumbnailUrl(cover) {
  try {
    const u = new URL(imageUrl(cover));
    if (u.pathname.startsWith('/img-master/')) u.pathname = '/c/360x360_70' + u.pathname;
    return u.href;
  } catch { return ''; }
}
class Archive {
  constructor(dir, client) { this.dir = dir; this.client = client; this.indexes = new Map(); this.queue = []; this.running = 0; this.saveTimer = null; this.enabled = true; }
  folder(uid) { return path.join(this.dir, uid); }
  index(uid) {
    if (!digits(uid)) throw new Error('账号无效');
    if (!this.indexes.has(uid)) {
      let data = {}; try { data = JSON.parse(fs.readFileSync(path.join(this.dir, `${uid}.json`), 'utf8')); } catch {}
      this.indexes.set(uid, data);
    }
    return this.indexes.get(uid);
  }
  scheduleSave(uid) {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(uid).catch(() => {}), 800);
  }
  async save(uid) {
    await fsp.mkdir(this.dir, { recursive: true });
    const file = path.join(this.dir, `${uid}.json`);
    await fsp.writeFile(file + '.tmp', JSON.stringify(this.index(uid))); await fsp.rename(file + '.tmp', file);
  }
  // Records visible (not masked) works. Only metadata; thumbnails are fetched separately for shown works.
  remember(uid, works) {
    if (!this.enabled || !digits(uid)) return;
    const index = this.index(uid); let changed = false;
    for (const w of works) {
      if (!digits(w.id) || w.masked) continue;
      const old = index[w.id];
      const record = { id: w.id, title: w.title, userId: w.userId, userName: w.userName, tags: (w.tags || []).map(tagText).filter(Boolean).slice(0, 30), date: w.date, pageCount: w.pageCount, type: w.type, xRestrict: w.xRestrict, cover: thumbnailUrl(w.cover) || old?.cover || '', savedAt: old?.savedAt || new Date().toISOString(), thumb: old?.thumb || false };
      if (!old || old.title !== record.title || old.userName !== record.userName || old.cover !== record.cover) { index[w.id] = record; changed = true; }
    }
    if (changed) this.scheduleSave(uid);
  }
  // Downloads missing thumbnails in the background, two at a time.
  fetchThumbs(uid, works) {
    if (!this.enabled || !digits(uid)) return;
    const index = this.index(uid);
    for (const w of works) if (index[w.id] && !index[w.id].thumb && index[w.id].cover && !this.queue.some(q => q.id === w.id)) this.queue.push({ uid, id: w.id });
    while (this.running < 2 && this.queue.length) this.pump();
  }
  async pump() {
    const job = this.queue.shift(); if (!job) return;
    this.running++;
    try {
      const record = this.index(job.uid)[job.id];
      const response = await this.client.fetch(record.cover, { image: true });
      const data = Buffer.from(await response.arrayBuffer());
      if (data.length && data.length <= MAX_THUMB) {
        await fsp.mkdir(this.folder(job.uid), { recursive: true });
        await fsp.writeFile(path.join(this.folder(job.uid), `${job.id}.img`), data);
        record.thumb = true; this.scheduleSave(job.uid);
      }
    } catch {} finally { this.running--; if (this.queue.length) this.pump(); }
  }
  // Replaces a masked Pixiv entry with the archived record when one exists.
  restore(uid, work) {
    const record = digits(uid) ? this.index(uid)[work.id] : null;
    if (!record) return { ...work, masked: true, archived: false, title: '作品已删除或非公开', userName: '未知画师', cover: '' };
    return { ...work, ...record, masked: true, archived: true, cover: record.thumb ? `archive:${record.id}` : '', bookmarkData: work.bookmarkData, bookmarkDate: work.bookmarkDate };
  }
  thumbnail(uid, id) {
    if (!digits(uid) || !digits(id)) return null;
    const file = path.join(this.folder(uid), `${id}.img`);
    return fs.existsSync(file) ? file : null;
  }
  async stats(uid) {
    if (!digits(uid)) return { count: 0, bytes: 0 };
    let bytes = 0;
    try { for (const f of await fsp.readdir(this.folder(uid))) bytes += (await fsp.stat(path.join(this.folder(uid), f))).size; } catch {}
    try { bytes += (await fsp.stat(path.join(this.dir, `${uid}.json`))).size; } catch {}
    return { count: Object.keys(this.index(uid)).length, bytes };
  }
  async clear(uid) {
    if (!digits(uid)) return;
    this.queue = this.queue.filter(q => q.uid !== uid); clearTimeout(this.saveTimer);
    this.indexes.set(uid, {});
    await fsp.rm(this.folder(uid), { recursive: true, force: true });
    await fsp.rm(path.join(this.dir, `${uid}.json`), { force: true });
  }
}
module.exports = { Archive, maskedWork, thumbnailUrl };
