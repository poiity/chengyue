const { validateId, normalizeWork, accountFromHtml, imageUrl, csrfFromHtml, mirrorHost } = require('./core.cjs');
const { readZip } = require('./zip.cjs');
const wait = ms => new Promise(r => setTimeout(r, ms));
const networkError = message => Object.assign(new Error(message), { network: true });
// A logged-in Pixiv session cookie is "<user id>_<random>"; guests never carry the numeric prefix.
function sessionUserId(value) { return /^([1-9]\d{0,15})_[A-Za-z0-9]+$/.exec(String(value || ''))?.[1] || ''; }

class PixivClient {
  constructor(session) {
    this.session = session; this.artistCache = new Map(); this.account = null; this.csrf = ''; this.lang = 'zh'; // Pixiv tag translations follow the interface language
    this.imageMirror = { mode: 'official', host: 'i.pixiv.re' }; this.officialImageFailedAt = 0;
    this.probe = null; this.onAccountChange = null;
  }
  setImageMirror({ mode = 'official', host = 'i.pixiv.re' } = {}) {
    if (!['official', 'auto', 'mirror'].includes(mode)) throw new Error('图片线路无效');
    this.imageMirror = { mode, host: mirrorHost(host) }; this.officialImageFailedAt = 0;
  }
  // Official host first, the mirror second; in auto mode a recent official failure skips the slow attempt.
  imageCandidates(url) {
    const u = new URL(url), { mode, host } = this.imageMirror;
    if (mode === 'official' || u.hostname !== 'i.pximg.net') return [url];
    const mirrored = new URL(url); mirrored.hostname = host;
    if (mode === 'mirror' || Date.now() - this.officialImageFailedAt < 600000) return [mirrored.href];
    return [url, mirrored.href];
  }
  // archive: an i.pximg.net ZIP (ugoira frames) instead of an image.
  async fetch(url, { signal, image = false, archive = false } = {}) {
    image ||= archive;
    if (!image) {
      if (!url.startsWith('https://www.pixiv.net/')) throw new Error('不允许访问此地址');
      return this.fetchOnce(url, { signal, image });
    }
    const candidates = this.imageCandidates(imageUrl(url));
    for (let i = 0; ; i++) {
      const quick = i < candidates.length - 1;
      try { return await this.fetchOnce(candidates[i], { signal, image, archive, quick }); }
      catch (e) {
        if (signal?.aborted || !e.network || !quick) throw e;
        this.officialImageFailedAt = Date.now();
      }
    }
  }
  // Electron's session.fetch aborts on every redirect in "manual" mode ("Redirect was cancelled"),
  // which broke login detection whenever Pixiv redirected the home page (common through a VPN).
  // Redirects are followed natively; the final address is validated whenever the runtime reports it
  // (a login page served instead of data is still caught by the JSON / account parsing that follows).
  finalUrlAllowed(response, target, image) {
    if (!response.url) return;
    const final = new URL(response.url);
    if (final.protocol === 'https:' && !final.username && !final.password) {
      if (image && (/(^|\.)pximg\.net$/i.test(final.hostname) || final.hostname === new URL(target).hostname)) return;
      if (!image && final.origin === 'https://www.pixiv.net') return;
      if (!image && final.hostname === 'accounts.pixiv.net') throw new Error('Pixiv 要求重新登录或验证，请打开官方登录窗口完成验证');
    }
    throw new Error('Pixiv 跳转到了不受信任的地址，请求已停止');
  }
  async fetchOnce(target, { signal, image = false, archive = false, quick = false } = {}) {
    const attempts = quick ? 1 : 3;
    for (let attempt = 0; attempt < attempts; attempt++) {
      signal?.throwIfAborted();
      const deadline = AbortSignal.timeout(image ? 120000 : 30000);
      // A quick probe of the official image host gives up early so the mirror can take over.
      const headers = new AbortController(), headerTimer = quick ? setTimeout(() => headers.abort(new DOMException('timeout', 'TimeoutError')), 9000) : null;
      try {
        let response;
        try {
          response = await this.session.fetch(target, {
            method: 'GET', credentials: 'include', redirect: 'follow', cache: 'no-store',
            headers: { Referer: 'https://www.pixiv.net/', 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' },
            signal: AbortSignal.any([deadline, headers.signal, ...(signal ? [signal] : [])])
          });
        } finally { clearTimeout(headerTimer); }
        try { this.finalUrlAllowed(response, target, image); } catch (e) { await response.body?.cancel(); throw e; }
        if ([429, 500, 502, 503, 504].includes(response.status) && attempt < attempts - 1) {
          await response.body?.cancel(); await wait(1000 * 2 ** attempt); continue;
        }
        if (!response.ok) {
          await response.body?.cancel();
          if (response.status === 401) throw new Error('登录已失效，请重新登录 Pixiv');
          if (response.status === 403) throw new Error(image ? '图片服务器拒绝访问，可在设置中切换图片线路' : 'Pixiv 拒绝访问。请在登录窗口完成验证，并确认账号有权查看该作品');
          if (response.status === 404) throw new Error(image ? '图片不存在或已被删除' : '作品或画师不存在，或已被删除');
          if (response.status === 429) throw new Error('Pixiv 请求过于频繁，请稍后再试');
          throw Object.assign(new Error(`Pixiv 返回 HTTP ${response.status}`), { network: response.status >= 500 });
        }
        const type = response.headers.get('content-type') || '';
        if (archive ? !/zip|octet-stream/i.test(type) : image && !/^image\//i.test(type)) {
          await response.body?.cancel(); throw new Error(archive ? '图片服务器未返回动图数据' : '图片服务器未返回图片，下载已停止');
        }
        return response;
      } catch (e) {
        if (signal?.aborted) throw new Error('下载已取消');
        if (e.name === 'TimeoutError' || e.name === 'AbortError') throw networkError(image ? '连接图片服务器超时，请检查网络、代理或图片线路' : '连接 Pixiv 超时，请检查网络或设置代理');
        if (/net::|fetch failed|Failed to fetch|ERR_/i.test(e.message)) throw networkError(image ? '无法连接图片服务器，可在设置中切换图片线路或填写代理' : '无法连接 Pixiv，请检查网络，或在设置中填写可用代理');
        throw e;
      }
    }
  }
  async api(route, params = {}, signal) {
    const url = new URL(`https://www.pixiv.net/ajax/${route}`);
    url.searchParams.set('lang', this.lang);
    for (const [key, value] of Object.entries(params)) {
      if (Array.isArray(value)) value.forEach(v => url.searchParams.append(key, String(v)));
      else if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const response = await this.fetch(url.href, { signal });
    const content = await response.text();
    let data;
    try { data = JSON.parse(content); } catch { throw new Error('Pixiv 返回了验证页面，请打开登录窗口完成验证后重试'); }
    if (data.error) throw new Error(data.message || 'Pixiv 无法完成请求');
    if (data.body == null) throw new Error('Pixiv 接口响应格式发生变化');
    return data.body;
  }
  setAccount(account, csrf) {
    const old = this.account?.id || null;
    this.account = account || null;
    if (!account) this.csrf = ''; else if (csrf) this.csrf = csrf;
    this.onAccountChange?.(old, this.account?.id || null);
    return this.account;
  }
  // Reads the account from a page snapshot (the official login window or a hidden page on the same session).
  adoptPage(html) {
    const account = accountFromHtml(html || '');
    if (account) this.setAccount(account, csrfFromHtml(html));
    return account;
  }
  async accountFromId(id) {
    try {
      const user = await this.api(`user/${id}`, { full: 1 });
      return { id, name: user.name || `用户 ${id}`, premium: user.premium === true || user.premium === 1 || user.premium === '1', avatar: user.imageBig || user.image || '' };
    } catch { return { id, name: `用户 ${id}`, premium: false, avatar: '' }; }
  }
  async status({ probe = true } = {}) {
    const cookies = await this.session.cookies.get({ url: 'https://www.pixiv.net/', name: 'PHPSESSID' });
    if (!cookies.length) return this.setAccount(null);
    // Guests also receive a PHPSESSID, and a host-only copy can coexist with the .pixiv.net one.
    const sessionUser = cookies.map(c => sessionUserId(c.value)).find(Boolean) || '';
    let html = '', failure = null;
    try { html = await (await this.fetch('https://www.pixiv.net/')).text(); } catch (e) { failure = e; }
    let account = html ? accountFromHtml(html) : null, csrf = html ? csrfFromHtml(html) : '';
    if (!account && failure && probe && this.probe) {
      // The same page in a real browser view passes checks that plain requests may not (VPN exits often get them).
      try { const page = await this.probe(); account = accountFromHtml(page.html); csrf ||= csrfFromHtml(page.html); } catch {}
    }
    if (account && sessionUser && account.id !== sessionUser) account = null;
    if (!account && sessionUser) account = await this.accountFromId(sessionUser);
    if (!account) {
      if (failure) throw new Error(`${failure.message}；若已在官方窗口登录，请确认代理可用后点击“刷新登录状态”`);
      return this.setAccount(null);
    }
    this.csrf = '';
    return this.setAccount(account, csrf);
  }
  async ensureToken() {
    if (this.csrf) return this.csrf;
    try { await this.status(); } catch {}
    if (!this.csrf && this.probe) { try { this.csrf = csrfFromHtml((await this.probe()).html) || ''; } catch {} }
    return this.csrf;
  }
  async feed(page = 1) {
    if (!this.account) throw new Error('请先登录，查看关注画师的新作品');
    const data = await this.api('follow_latest/illust', { p: page, mode: 'all' });
    const works = (data.thumbnails?.illust || []).filter(w => w.id).map(normalizeWork);
    return { works, page, hasMore: !data.page?.isLastPage && works.length > 0, total: null };
  }
  async search({ query, page = 1, order = 'date_d', type = 'all', match = 's_tag', age = 'all' }) {
    if (!String(query).trim()) throw new Error('请输入 Tag');
    if (!['date_d', 'date', 'popular_d'].includes(order)) throw new Error('排序参数无效');
    if (order === 'popular_d' && !this.account?.premium) throw new Error('热门排序需要已登录的 Pixiv Premium 账号');
    const routes = { all: 'artworks', illust: 'illustrations', manga: 'manga' };
    const data = await this.api(`search/${routes[type] || 'artworks'}/${encodeURIComponent(String(query).slice(0, 150))}`, {
      p: page, order, mode: ['all','safe','r18'].includes(age) ? age : 'all', s_mode: ['s_tag','s_tag_full','s_tc','s_tag_tc'].includes(match) ? match : 's_tag', type: type === 'illust' ? 'illust_and_ugoira' : 'all'
    });
    const block = data.illustManga || data.illust || data.manga;
    if (!block || !Array.isArray(block.data)) throw new Error('搜索结果格式发生变化');
    const works = block.data.filter(w => w.id && !w.isAdContainer).map(normalizeWork);
    const size = block.data.length;
    return { works, total: block.total, page, hasMore: size > 0 && (block.lastPage ? page < block.lastPage : page * 60 < block.total), tags: data.relatedTags || [] };
  }
  async artist(id, page = 1, title = '') {
    id = validateId(id);
    let cache = this.artistCache.get(id);
    if (!cache || Date.now() - cache.time > 300000) {
      const user = await this.api(`user/${id}`, { full: 1 });
      const profile = await this.api(`user/${id}/profile/all`);
      const ids = [...new Set([...Object.keys(profile.illusts || {}), ...Object.keys(profile.manga || {})])].sort((a,b) => Number(b)-Number(a));
      cache = { user: { id, name: user.name, avatar: user.imageBig || user.image, comment: user.comment || '', isFollowed:!!user.isFollowed }, ids, works: new Map(), time: Date.now() };
      this.artistCache.set(id, cache);
    }
    const load = async ids => {
      const missing = ids.filter(x => !cache.works.has(x));
      if (!missing.length) return;
      const data = await this.api(`user/${id}/profile/illusts`, { 'ids[]': missing, work_category: 'illustManga', is_first_page: 0 });
      for (const w of Object.values(data.works || {})) cache.works.set(String(w.id), normalizeWork(w));
    };
    let ids = cache.ids;
    if (title.trim()) {
      // Search the complete title index, not only cards already visible in the UI.
      for (let i = 0; i < ids.length; i += 48) { await load(ids.slice(i, i + 48)); if (i + 48 < ids.length) await wait(180); }
      const needle = title.trim().toLocaleLowerCase();
      ids = ids.filter(x => cache.works.get(x)?.title.toLocaleLowerCase().includes(needle));
    }
    const visible = ids.slice((page - 1) * 48, page * 48);
    await load(visible);
    return { user: cache.user, works: visible.map(x => cache.works.get(x)).filter(Boolean), total: ids.length, allTotal: cache.ids.length, page, hasMore: page * 48 < ids.length };
  }
  async detail(id, signal) {
    const data = await this.api(`illust/${validateId(id)}`, {}, signal);
    const pages = await this.api(`illust/${validateId(id)}/pages`, {}, signal);
    if (!Array.isArray(pages) || !pages.length) throw new Error('没有可用的作品页面');
    return { ...normalizeWork(data), cover: data.urls?.regular || data.urls?.small, description: String(data.description || '').replace(/<[^>]*>/g, ''), pages: pages.map(p => ({ original: p.urls.original, regular: p.urls.regular || p.urls.original, width: p.width, height: p.height })) };
  }
  async ugoira(id, signal) {
    const meta = await this.api(`illust/${validateId(id)}/ugoira_meta`, {}, signal);
    const frames = (Array.isArray(meta.frames) ? meta.frames : []).map(f => ({ file: String(f.file || ''), delay: Math.max(10, Math.min(65535, Math.round(Number(f.delay) || 100))) }));
    if (!frames.length || frames.length > 2000 || frames.some(f => !/^[\w.-]{1,64}$/.test(f.file))) throw new Error('动图帧信息无效');
    return { src: imageUrl(meta.src), original: imageUrl(meta.originalSrc || meta.src), mime: /^image\/(jpeg|png|gif|webp)$/.test(meta.mime_type) ? meta.mime_type : 'image/jpeg', frames };
  }
  // Returns the frames of an animated work, in order, with their display time in milliseconds.
  async ugoiraFrames(id, { original = false, signal } = {}) {
    const meta = await this.ugoira(id, signal);
    const response = await this.fetch(original ? meta.original : meta.src, { archive: true, signal });
    const size = Number(response.headers.get('content-length')) || 0;
    if (size > 400 * 1024 * 1024) { await response.body?.cancel(); throw new Error('动图文件过大'); }
    const files = readZip(Buffer.from(await response.arrayBuffer()));
    const frames = meta.frames.map(f => { const data = files.get(f.file); if (!data) throw new Error('动图压缩包缺少帧'); return { file: f.file, delay: f.delay, data }; });
    return { mime: meta.mime, frames };
  }
  async related(id, ids) {
    id = validateId(id);
    const data = ids?.length
      // Pixiv rejects repeated plain "illust_ids" with HTTP 400; the PHP array form is required.
      ? await this.api('illust/recommend/illusts', { 'illust_ids[]': ids.slice(0,18).map(validateId) })
      : await this.api(`illust/${id}/recommend/init`, { limit:18 });
    return { works:(data.illusts || []).filter(w=>w.id && !w.isAdContainer).map(normalizeWork), nextIds:(data.nextIds || []).filter(x=>/^[1-9]\d{0,15}$/.test(String(x))).map(String) };
  }
}
module.exports = { PixivClient };
