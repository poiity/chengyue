// Account library: tag suggestions, follows, bookmarks and their writes.
const { normalizeWork, validateId } = require('./core.cjs');
const { maskedWork } = require('./archive.cjs');
const wait = ms => new Promise(r => setTimeout(r, ms));
function tagNames(values) { return (Array.isArray(values) ? values : []).map(x => typeof x === 'string' ? x : x.tag || x.name || '').filter(Boolean); }
function ownAccount(client) { if (!client.account?.id) throw new Error('请先登录自己的 Pixiv 账号'); return client.account.id; }
const rest = value => value === 'hide' ? 'hide' : 'show';
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
function filterBookmarks(works, filters) {
  const tags = String(filters.artworkTag || '').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return works.filter(w => {
    if (filters.age === 'safe' && w.xRestrict > 0) return false;
    if (filters.age === 'r18' && !w.xRestrict) return false;
    if (tags.length && !tags.every(tag => tagNames(w.tags).some(t => t.toLocaleLowerCase().includes(tag)))) return false;
    return true;
  });
}
// Newest first by upload time, falling back to the (monotonic) artwork ID.
function newestFirst(a, b) {
  const ta = Date.parse(a.date) || 0, tb = Date.parse(b.date) || 0;
  if (ta !== tb) return tb - ta;
  return b.id.length - a.id.length || (b.id > a.id ? 1 : b.id < a.id ? -1 : 0);
}
class Library {
  // options: archive (local record of bookmarks), months / saveMonths (bookmark month per work, synced from Pixiv).
  constructor(client, dates = {}, saveDates = () => {}, { archive = null, months = {}, saveMonths = () => {} } = {}) {
    this.client = client; this.dates = dates; this.saveDates = saveDates; this.archive = archive;
    this.months = { works: {}, counts: {}, ...months }; this.saveMonths = saveMonths;
    this.cache = new Map(); this.pending = new Map(); this.syncing = new Map(); this.generation = 0;
  }
  clear() { this.generation++; this.cache.clear(); }
  // Builds (or reuses for two minutes) a complete index; concurrent callers share one request chain.
  async indexed(key, account, build) {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.time < 120000) return cached.value;
    if (!this.pending.has(key)) {
      const generation = this.generation;
      const cancelled = () => generation !== this.generation || this.client.account?.id !== account;
      this.pending.set(key, build(cancelled).then(value => {
        if (!cancelled()) this.cache.set(key, { value, time: Date.now() });
        return value;
      }).finally(() => this.pending.delete(key)));
    }
    return this.pending.get(key);
  }
  async suggestions(keyword) {
    const q = String(keyword || '').trim().slice(0, 80); if (!q) return [];
    const data = await (await this.client.fetch(`https://www.pixiv.net/rpc/cps.php?keyword=${encodeURIComponent(q)}&lang=${this.client.lang || 'zh'}`)).json();
    return (data.candidates || []).slice(0, 8).map(x => ({ tag: String(x.tag_name), translation: String(x.tag_translation || '') }));
  }
  async following({ tag = '', rest: visibility = 'show', page = 1 } = {}) {
    const id = ownAccount(this.client);
    const data = await this.client.api(`user/${id}/following`, { offset: (page - 1) * 24, limit: 24, rest: rest(visibility), tag: String(tag).slice(0, 100), acceptingRequests: 0 });
    return {
      users: (data.users || []).map(u => ({ id: String(u.userId), name: u.userName, avatar: u.profileImageUrl || u.image, works: (u.illusts || []).filter(w => w?.id).map(normalizeWork) })),
      tags: tagNames(data.followUserTags || data.tags), total: data.total || 0, page, hasMore: page * 24 < data.total
    };
  }
  // Artworks of every artist in one follow category, newest first (like the website's category view).
  // Pixiv lists each followed artist with their latest works; those are merged across the category.
  async followingWorks({ tag = '', rest: visibility = 'show', page = 1 } = {}) {
    const id = ownAccount(this.client), key = JSON.stringify(['follow-works', id, rest(visibility), tag]);
    const works = await this.indexed(key, id, async cancelled => {
      const all = new Map();
      for (let p = 1, more = true; more && p <= 25; p++) {
        if (cancelled()) throw new Error('读取已取消');
        const result = await this.following({ tag, rest: visibility, page: p });
        for (const user of result.users) for (const w of user.works) all.set(w.id, { ...w, userName: w.userName === '未知画师' ? user.name : w.userName });
        more = result.hasMore; if (more) await wait(150);
      }
      return [...all.values()].sort(newestFirst);
    });
    return { works: works.slice((page - 1) * 48, page * 48), total: works.length, page, hasMore: page * 48 < works.length };
  }
  async bookmarkTags() {
    const id = ownAccount(this.client);
    const data = await this.client.api(`user/${id}/illusts/bookmark/tags`);
    return { public: tagNames(data.public), private: tagNames(data.private) };
  }
  // bm: a bookmark month "YYYY-MM" (the website's "收藏时间" filter).
  async fetchBookmarkPage({ rest: visibility = 'show', tag = '', offset = 0, limit = 48, bm = '' } = {}) {
    const id = ownAccount(this.client);
    if (bm && !MONTH.test(bm)) throw new Error('收藏月份格式不正确');
    // The website sends the month without the dash (bm=202609); "2026-09" is rejected with HTTP 400.
    const data = await this.client.api(`user/${id}/illusts/bookmarks`, { rest: rest(visibility), tag, offset, limit, ...(bm ? { bm: bm.replace('-', '') } : {}) });
    const works = (data.works || []).filter(w => w.id).map(raw => {
      const work = normalizeWork(raw);
      Object.assign(work, { bookmarkDate: work.bookmarkDate || this.dates[`${id}:${work.id}`] || '', bookmarkMonth: bm || this.months.works[`${id}:${work.id}`] || '', bookmarkKnown: true });
      // Deleted or hidden works come back masked; show the locally archived record instead when there is one.
      if (!maskedWork(raw)) return work;
      return this.archive ? this.archive.restore(id, work) : { ...work, masked: true, archived: false, title: '作品已删除或非公开', cover: '' };
    }).filter(w => w.id);
    this.archive?.remember(id, works.filter(w => !w.masked));
    return { total: Number(data.total) || 0, works };
  }
  async bookmarks(filters = {}) {
    const id = ownAccount(this.client), page = Math.max(1, Number(filters.page) || 1), visibility = rest(filters.rest), tag = String(filters.tag || ''), bm = String(filters.bm || '');
    if (bm && !MONTH.test(bm)) throw new Error('收藏月份格式不正确');
    const custom = (filters.age && filters.age !== 'all') || filters.artworkTag || filters.order === 'oldest';
    if (!custom) {
      const data = await this.fetchBookmarkPage({ rest: visibility, tag, bm, offset: (page - 1) * 48 });
      this.archive?.fetchThumbs(id, data.works);
      return { ...data, page, hasMore: page * 48 < data.total };
    }
    // Combined filters apply to the whole library (or the chosen month), not only to the visible page.
    const all = await this.indexed(JSON.stringify(['bookmarks', id, visibility, tag, bm]), id, async cancelled => {
      const works = [];
      for (let offset = 0, total = Infinity; offset < total; offset += 100) {
        if (cancelled()) throw new Error('收藏检索已取消');
        const data = await this.fetchBookmarkPage({ rest: visibility, tag, bm, offset, limit: 100 });
        total = data.total; works.push(...data.works); if (offset + 100 < total) await wait(150);
      }
      return works;
    });
    let works = filterBookmarks(all, filters);
    if (filters.order === 'oldest') works = [...works].reverse();
    this.archive?.fetchThumbs(id, works.slice((page - 1) * 48, page * 48));
    return { works: works.slice((page - 1) * 48, page * 48), total: works.length, page, hasMore: page * 48 < works.length, indexed: all.length };
  }
  // Bookmark counts per month, as the website shows under "收藏时间". Pixiv offers this to Premium members;
  // for other accounts the request fails or returns nothing, and the app falls back to its own records.
  async bookmarkPeriods({ rest: visibility = 'show' } = {}) {
    const id = ownAccount(this.client);
    const data = await this.client.api(`user/${id}/illusts/bookmarks/periods`, { rest: rest(visibility) });
    const list = Array.isArray(data) ? data : data.periods || data.bookmarkPeriods || [];
    return list.map(p => ({ period: String(p.period || ''), count: Math.max(0, Number(p.count) || 0) })).filter(p => MONTH.test(p.period)).sort((a, b) => b.period.localeCompare(a.period));
  }
  // Learns the bookmark month of every work by reading each month from Pixiv once; months whose count
  // did not change since the last sync are skipped, so later syncs cost a single request.
  syncBookmarkMonths({ rest: visibility = 'show' } = {}) {
    const id = ownAccount(this.client), key = `${id}:${rest(visibility)}`;
    if (!this.syncing.has(key)) this.syncing.set(key, this.runMonthSync(id, rest(visibility), key).finally(() => this.syncing.delete(key)));
    return this.syncing.get(key);
  }
  async runMonthSync(id, visibility, key) {
    const periods = await this.bookmarkPeriods({ rest: visibility });
    if (!periods.length) return { supported: false, periods: 0, synced: 0, known: 0 };
    const counts = this.months.counts[key] || {};
    let synced = 0;
    try {
      for (const { period, count } of periods) {
        if (counts[period] === count || !count) continue;
        for (let offset = 0, total = count; offset < total; offset += 100) {
          if (this.client.account?.id !== id) throw new Error('账号已切换，同步已停止');
          const data = await this.fetchBookmarkPage({ rest: visibility, bm: period, offset, limit: 100 });
          // If Pixiv ignored the month filter, the list would be the whole library: stop instead of mislabelling.
          if (Math.abs(data.total - count) > Math.max(3, count * 0.1)) return { supported: false, periods: periods.length, synced, known: this.knownMonths(id) };
          total = data.total;
          for (const w of data.works) this.months.works[`${id}:${w.id}`] = period;
          await wait(150);
        }
        counts[period] = count; synced++;
      }
    } finally {
      this.months.counts[key] = counts; this.saveMonths(this.months);
      if (synced) this.clear();
    }
    return { supported: true, periods: periods.length, synced, known: this.knownMonths(id) };
  }
  knownMonths(id) { const prefix = `${id}:`; return Object.keys(this.months.works).filter(k => k.startsWith(prefix)).length; }
  async bookmarkState(id, detail = null) {
    ownAccount(this.client);
    const current = await this.client.api(`illust/${validateId(id)}`);
    if (!Object.hasOwn(current, 'bookmarkData')) throw new Error('无法确认收藏状态，请刷新作品后重试');
    if (detail) detail.work = current;
    return { bookmarkData: current.bookmarkData || null };
  }
  async quickBookmark(id) {
    const uid = ownAccount(this.client); id = validateId(id);
    const detail = {}, { bookmarkData } = await this.bookmarkState(id, detail);
    if (bookmarkData) return { bookmarkData, alreadySaved: true };
    const result = await this.post('illusts/bookmarks/add', { illust_id: id, restrict: 0, comment: '', tags: [] });
    this.dates[`${uid}:${id}`] = new Date().toISOString(); this.saveDates(this.dates); this.clear();
    // Keep a local record of the new bookmark, in case the artist removes it later.
    if (this.archive && detail.work) { const work = normalizeWork(detail.work); this.archive.remember(uid, [work]); this.archive.fetchThumbs(uid, [work]); }
    return { bookmarkData: { id: String(result?.last_bookmark_id || result?.bookmarkId || ''), private: false }, alreadySaved: false };
  }
  // Switches an existing bookmark between public and private without touching its tags.
  async setBookmarkPrivacy({ id, private: privateFlag }) {
    ownAccount(this.client); id = validateId(id);
    if (typeof privateFlag !== 'boolean') throw new Error('公开范围无效');
    const { bookmarkData } = await this.bookmarkState(id);
    if (!bookmarkData?.id) throw new Error('作品已经不在收藏中，请刷新页面');
    if (!!bookmarkData.private !== privateFlag) {
      await this.post('illusts/bookmarks/edit_restrict', { bookmarkIds: [String(bookmarkData.id)], bookmarkRestrict: privateFlag ? 'private' : 'public' });
      this.clear();
    }
    return { bookmarkData: { ...bookmarkData, private: privateFlag } };
  }
  // Bulk public / private switch for several bookmarks (the bookmark management panel).
  async setBookmarksPrivacy({ bookmarkIds, private: privateFlag }) {
    ownAccount(this.client);
    if (typeof privateFlag !== 'boolean') throw new Error('公开范围无效');
    const ids = [...new Set((Array.isArray(bookmarkIds) ? bookmarkIds : []).map(String))];
    if (!ids.length || ids.length > 500 || ids.some(x => !/^\d{1,20}$/.test(x))) throw new Error('请选择 1–500 部收藏作品');
    for (let i = 0; i < ids.length; i += 100) {
      await this.post('illusts/bookmarks/edit_restrict', { bookmarkIds: ids.slice(i, i + 100), bookmarkRestrict: privateFlag ? 'private' : 'public' });
      if (i + 100 < ids.length) await wait(300);
    }
    this.clear(); return { count: ids.length };
  }
  // Removes several bookmarks one by one; stops at the first failure and reports how many were removed.
  async removeBookmarks({ items }) {
    const uid = ownAccount(this.client);
    const list = (Array.isArray(items) ? items : []).map(x => ({ id: validateId(x.id), bookmarkId: String(x.bookmarkId || '') }));
    if (!list.length || list.length > 500 || list.some(x => !/^\d{1,20}$/.test(x.bookmarkId))) throw new Error('请选择 1–500 部收藏作品');
    let removed = 0;
    try {
      for (const item of list) {
        await this.post('illusts/bookmarks/delete', { bookmark_id: item.bookmarkId }, true);
        delete this.dates[`${uid}:${item.id}`]; removed++;
        if (removed < list.length) await wait(200);
      }
    } catch (e) { if (removed) e.message = `已取消 ${removed} 部后中断：${e.message}`; throw e; }
    finally { this.saveDates(this.dates); this.clear(); }
    return { count: removed };
  }
  async removeBookmark(id) {
    const uid = ownAccount(this.client); id = validateId(id);
    const { bookmarkData } = await this.bookmarkState(id);
    if (!bookmarkData?.id) throw new Error('作品已经不在收藏中，请刷新页面');
    const result = await this.post('illusts/bookmarks/delete', { bookmark_id: String(bookmarkData.id) }, true);
    delete this.dates[`${uid}:${id}`]; this.saveDates(this.dates); this.clear(); return result;
  }
  async follow({ id, follow = true }) {
    const uid = ownAccount(this.client); id = validateId(id);
    if (uid === id) throw new Error('不能关注自己');
    if (typeof follow !== 'boolean') throw new Error('关注状态无效');
    const before = await this.client.api(`user/${id}`, { full: 1 });
    if (typeof before.isFollowed !== 'boolean') throw new Error('无法确认关注状态，请刷新画师主页');
    if (before.isFollowed === follow) return { isFollowed: follow };
    await this.post(follow ? '/bookmark_add.php' : '/rpc_group_setting.php', follow ? { mode: 'add', type: 'user', user_id: id, tag: '', restrict: 0, format: 'json' } : { mode: 'del', type: 'bookuser', id }, true);
    this.client.artistCache?.delete(id); this.clear(); return { isFollowed: follow };
  }
  async post(route, body, form = false) {
    ownAccount(this.client);
    if (!this.client.csrf) await (this.client.ensureToken ? this.client.ensureToken() : this.client.status());
    if (!this.client.csrf) throw new Error('无法取得操作令牌，请刷新登录状态后重试');
    // Never auto-retry a write: an ambiguous network result may already be committed.
    const url = route.startsWith('/') ? `https://www.pixiv.net${route}` : `https://www.pixiv.net/ajax/${route}`;
    let response;
    try {
      response = await this.client.session.fetch(url, {
        method: 'POST', credentials: 'include', redirect: 'error', signal: AbortSignal.timeout(30000),
        headers: { Referer: 'https://www.pixiv.net/', Origin: 'https://www.pixiv.net', 'x-csrf-token': this.client.csrf, 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' },
        body: form ? new URLSearchParams(body).toString() : JSON.stringify(body)
      });
    } catch (e) {
      if (/redirect/i.test(e.message)) throw new Error('Pixiv 要求重新验证登录，请打开登录窗口后重试');
      if (e.name === 'TimeoutError') throw new Error('操作超时，请刷新页面确认状态后再试');
      if (/net::|ERR_|fetch failed/i.test(e.message)) throw new Error('无法连接 Pixiv，请检查网络或代理后刷新页面确认状态');
      throw e;
    }
    if (response.status === 400 || response.status === 403) this.client.csrf = '';
    if (!response.ok) throw new Error(`操作返回 HTTP ${response.status}；请刷新页面确认状态后再试`);
    let data; try { data = await response.json(); } catch { throw new Error('无法确认操作结果，请刷新页面检查状态'); }
    if (data.error || data.status === 'error') throw new Error(data.message || '操作失败');
    return data.body;
  }
}
module.exports = { Library, filterBookmarks, tagNames, newestFirst };
