// Local, explainable recommendations: tag taste per account, memory-only history, candidate ranking.
const fs = require('node:fs');
const path = require('node:path');
const { normalizeWork, restrictedWork, tagText } = require('./core.cjs');
const HALF_LIFE = 30 * 86400000; // tag interest halves every 30 days
const decay = time => 2 ** (-(Date.now() - time) / HALF_LIFE);

class TasteMemory {
  constructor(filename) {
    this.filename = filename; this.history = new Map(); this.seen = new Set(); this.profiles = {}; this.account = 'guest';
    try { this.profiles = JSON.parse(fs.readFileSync(filename, 'utf8')); } catch {}
  }
  switchAccount(id) { const next = String(id || 'guest'); if (this.account !== next) { this.account = next; this.clearHistory(); } }
  clearHistory() { this.history.clear(); this.seen.clear(); }
  historyList() { return [...this.history.values()].reverse(); }
  // History stays in memory only (at most 500 works); only aggregated tag scores are written to disk.
  record(work) {
    const { pages, description, ...compact } = work;
    this.history.delete(work.id); this.history.set(work.id, { ...compact, viewedAt: new Date().toISOString() });
    if (this.history.size > 500) this.history.delete(this.history.keys().next().value);
    if (!this.seen.has(work.id)) this.train(work.tags, 1);
    this.seen.add(work.id);
  }
  train(tags, delta) {
    const profile = this.profiles[this.account] || (this.profiles[this.account] = {});
    for (const raw of tags || []) {
      const tag = tagText(raw);
      if (!tag || tag.length > 100 || ['__proto__', 'constructor', 'prototype'].includes(tag)) continue;
      const old = profile[tag] || { value: 0, time: Date.now() };
      profile[tag] = { value: Math.max(-10, Math.min(30, old.value * decay(old.time) + delta)), time: Date.now() };
    }
    this.profiles[this.account] = Object.fromEntries(Object.entries(profile).sort((a, b) => b[1].time - a[1].time).slice(0, 400));
    this.save();
  }
  interests() {
    return Object.entries(this.profiles[this.account] || {}).map(([tag, v]) => ({ tag, weight: v.value * decay(v.time) })).sort((a, b) => b.weight - a.weight);
  }
  resetTaste() { delete this.profiles[this.account]; this.save(); }
  save() { fs.mkdirSync(path.dirname(this.filename), { recursive: true }); fs.writeFileSync(this.filename, JSON.stringify(this.profiles)); }
}

function rankCandidates(works, interests, { allowR18 = false, seen = new Set(), limit = 24 } = {}) {
  const weights = new Map(interests.map(t => [t.tag, t.weight])), unique = new Map();
  for (const work of works) {
    // R-18G never appears; R-18, R-18-tagged and Pixiv-"sensitive" works only when 18+ is switched on.
    if (!work.id || work.bookmarkData || !work.bookmarkKnown || seen.has(work.id) || work.xRestrict > 1 || (!allowR18 && restrictedWork(work))) continue;
    const old = unique.get(work.id);
    unique.set(work.id, old ? { ...old, ...work, hot: old.hot || work.hot } : work);
  }
  const scored = [...unique.values()].map(w => {
    const matches = (w.tags || []).map(t => ({ tag: tagText(t), weight: weights.get(tagText(t)) || 0 })).sort((a, b) => b.weight - a.weight);
    const affinity = matches.reduce((sum, t) => sum + t.weight, 0);
    const score = affinity * 3 + (w.hot ? 5 : 0) + (w.isFollowed ? 1.5 : 0) + Math.log1p(w.bookmarkCount || 0) * 0.3;
    const reason = w.hot ? '当前热门' : matches[0]?.weight > 0 ? `因为你常看 #${matches[0].tag}` : w.isFollowed ? '关注画师 · 尚未收藏' : '发现新的画师';
    return { ...w, score, reason };
  }).sort((a, b) => b.score - a.score);
  // At most three works per artist, so one prolific artist cannot fill the page.
  const perArtist = new Map(), chosen = [];
  for (const w of scored) {
    if ((perArtist.get(w.userId) || 0) >= 3) continue;
    chosen.push(w); perArtist.set(w.userId, (perArtist.get(w.userId) || 0) + 1);
    if (chosen.length >= limit) break;
  }
  return chosen;
}

class Recommendations {
  constructor(client, memory) {
    this.client = client; this.memory = memory;
    this.cache = new Map(); this.pending = new Map(); this.shown = new Map(); this.cards = new Map(); this.details = new Map();
  }
  clear() { this.cache.clear(); this.pending.clear(); this.shown.clear(); this.cards.clear(); this.details.clear(); }
  async ranking(page = 1, adult = false) {
    const data = await (await this.client.fetch(`https://www.pixiv.net/ranking.php?mode=${adult ? 'daily_r18' : 'daily'}&content=illust&p=${page}&format=json`)).json();
    return (data.contents || []).slice(0, 36).map(w => ({
      ...normalizeWork({ id: w.illust_id, title: w.title, userId: w.user_id, userName: w.user_name, url: w.url, pageCount: w.illust_page_count, illustType: w.illust_type, tags: w.tags, width: w.width, height: w.height, createDate: w.illust_upload_timestamp ? new Date(w.illust_upload_timestamp * 1000).toISOString() : '', xRestrict: adult ? 1 : 0, sl: adult || w.illust_content_type?.sexual > 0 ? 6 : 2 }),
      hot: true
    }));
  }
  async sources({ page, allowR18, kind, positive }) {
    const sources = [];
    if (kind !== 'hot' && this.client.account) {
      // Pixiv's personal discovery feed exists only for signed-in accounts.
      sources.push(this.client.api('discovery/artworks', { mode: allowR18 ? 'all' : 'safe', limit: 60 }).then(d => (d.thumbnails?.illust || d.illusts || []).map(normalizeWork)));
    }
    if (kind !== 'hot') {
      const seeds = positive.slice(0, 6), picked = seeds.length ? [seeds[(page - 1) % seeds.length], seeds[page % seeds.length]] : [];
      for (const seed of new Map(picked.map(t => [t.tag, t])).values()) {
        sources.push(this.client.search({ query: seed.tag, page, age: allowR18 ? 'all' : 'safe', match: 's_tag_full' }).then(d => d.works.slice(0, 24)));
      }
    }
    sources.push(this.ranking(page, false));
    if (allowR18) sources.push(this.ranking(page, true));
    return Promise.allSettled(sources);
  }
  // Rankings do not include the account's bookmark state or exact sensitivity level; a signed-in account
  // reads them from the artwork detail (6 at a time, cached for 15 minutes). Guests have no bookmarks,
  // so their ranking works are judged from the ranking's own content rating without extra requests.
  async enrich(candidates, shown, account) {
    if (!this.client.account) return candidates.map(w => w.bookmarkKnown ? w : { ...w, bookmarkKnown: true });
    const unresolved = [...new Map(candidates.filter(w => !w.bookmarkKnown && !shown.has(w.id) && !this.memory.seen.has(w.id)).map(w => [w.id, w])).values()].slice(0, 40);
    const enriched = new Map(), queue = [...unresolved];
    const worker = async () => {
      // A background prefetch stops as soon as the signed-in account changes.
      for (let w; (w = queue.shift()) && (this.client.account?.id || 'guest') === account;) {
        const cached = this.details.get(w.id);
        if (cached && Date.now() - cached.time < 900000) { enriched.set(w.id, { ...cached.work, hot: w.hot }); continue; }
        try {
          const detail = normalizeWork(await this.client.api(`illust/${w.id}`));
          // Detail responses can hide image URLs (for example login-only works); keep the ranking cover then.
          const work = { ...detail, cover: detail.cover || w.cover };
          this.details.set(w.id, { work, time: Date.now() }); enriched.set(w.id, { ...work, hot: w.hot });
        } catch {}
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    if (this.details.size > 600) for (const key of [...this.details.keys()].slice(0, 200)) this.details.delete(key);
    return candidates.map(w => enriched.get(w.id) || w);
  }
  async list({ page = 1, allowR18 = false, kind = 'for-you', refresh = false } = {}) {
    if (allowR18 && !this.client.account) throw new Error('请先登录，再根据 Pixiv 账号权限开启 18+ 推荐');
    const account = this.client.account?.id || 'guest', key = JSON.stringify([account, page, allowR18, kind]);
    if (refresh) { this.cache.clear(); this.pending.clear(); }
    if (!this.cache.has(key)) {
      if (!this.pending.has(key)) this.pending.set(key, this.build({ page, allowR18, kind, account, key }).finally(() => this.pending.delete(key)));
      await this.pending.get(key);
    }
    // The next page is prepared in the background, so "下一页" usually opens instantly.
    const next = JSON.stringify([account, page + 1, allowR18, kind]);
    if (page < 10 && !this.cache.has(next) && !this.pending.has(next)) {
      this.pending.set(next, this.build({ page: page + 1, allowR18, kind, account, key: next }).catch(() => {}).finally(() => this.pending.delete(next)));
    }
    const cached = this.cache.get(key);
    return { ...cached, works: cached.works.filter(w => !this.memory.seen.has(w.id)) };
  }
  async build({ page, allowR18, kind, account, key }) {
    const context = JSON.stringify([account, allowR18, kind]);
    if (!this.shown.has(context)) this.shown.set(context, new Set());
    const shown = this.shown.get(context), interests = this.memory.interests(), positive = interests.filter(t => t.weight > 0);
    let candidates = []; const warnings = [];
    for (const result of await this.sources({ page, allowR18, kind, positive })) {
      if (result.status === 'fulfilled') candidates.push(...result.value); else warnings.push(result.reason.message);
    }
    if (!candidates.length && warnings.length) throw new Error(warnings.join('；'));
    candidates = await this.enrich(candidates, shown, account);
    const excluded = new Set([...this.memory.seen, ...shown]);
    let works = rankCandidates(candidates, kind === 'hot' ? [] : interests, { allowR18, seen: excluded });
    if (kind === 'for-you') {
      // Reserve up to six slots for today's popular works so interests do not form a closed loop.
      const hot = rankCandidates(candidates.filter(w => w.hot), [], { allowR18, seen: excluded, limit: 6 });
      works = [...works.filter(w => !hot.some(h => h.id === w.id)).slice(0, 24 - hot.length), ...hot];
    }
    works.forEach(w => { shown.add(w.id); this.cards.set(w.id, w); });
    const response = { works, total: null, page, hasMore: page < 10, interests: positive.slice(0, 6), notice: warnings.length ? '部分来源暂不可用，已显示其余来源的推荐。' : '', cold: !positive.length };
    if ((this.client.account?.id || 'guest') === account) this.cache.set(key, response);
    return response;
  }
  dismiss(id) { const w = this.cards.get(String(id)); if (w) { this.memory.train(w.tags, -2); this.memory.seen.add(w.id); this.cache.clear(); } }
}
module.exports = { TasteMemory, Recommendations, rankCandidates };
