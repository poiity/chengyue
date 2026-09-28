const path = require('node:path');

function parsePages(input, count) {
  if (!Number.isSafeInteger(count) || count < 1 || count > 10000) throw new Error('作品页数无效');
  const text = String(input ?? '').trim();
  if (!text || /^(all|全部)$/i.test(text)) return Array.from({ length: count }, (_, i) => i + 1);
  const result = new Set();
  for (const token of text.replace(/[，、；;]/g, ',').split(',')) {
    const match = token.trim().match(/^(\d+)\s*(?:[-–—~至]\s*(\d+))?$/);
    if (!match) throw new Error('页码格式不正确，请输入如 1-4,9-13 或 2,5,8');
    const start = Number(match[1]), end = Number(match[2] || match[1]);
    if (start < 1 || end > count || start > end) throw new Error(`页码必须在 1–${count} 之间，区间由小到大填写`);
    for (let i = start; i <= end; i++) result.add(i);
  }
  return [...result].sort((a, b) => a - b);
}

function safeName(value, max = 90) {
  let s = String(value || '').normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[.\s]+$/g, '').trim();
  s = [...s].slice(0, max).join('').replace(/[.\s]+$/g, '');
  if (!s) s = '未命名';
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(s)) s = '_' + s;
  return s;
}
function artworkName(work) { return safeName(`${safeName(work.title, 48)}_${safeName(work.userName, 28)}`, 80); }
function validateId(id) {
  const s = String(id || '').trim();
  if (!/^[1-9]\d{0,15}$/.test(s)) throw new Error('请输入正确的数字 PID / UID');
  return s;
}
function imageUrl(value) {
  const u = new URL(value);
  if (u.protocol !== 'https:' || !/(^|\.)pximg\.net$/i.test(u.hostname) || u.username || u.password || u.port) throw new Error('图片地址不属于 Pixiv 图片服务器');
  return u.href;
}
// Image mirrors only receive public i.pximg.net paths; never cookies or Pixiv API traffic.
function mirrorHost(value) {
  const host = String(value || '').trim().toLowerCase().replace(/^https:\/\//, '').replace(/\/+$/, '');
  if (!/^(?=.{4,100}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(host) || /(^|\.)pixiv\.net$/.test(host) || /^\d+(\.\d+)+$/.test(host) || host === 'localhost') {
    throw new Error('镜像地址只填写域名，例如 i.pixiv.re');
  }
  return host;
}
function normalizeWork(w) {
  return {
    // IDs are digits only; anything else from an API response is dropped rather than rendered.
    id: /^\d{1,16}$/.test(String(w.id || w.illustId)) ? String(w.id || w.illustId) : '', title: String(w.title || w.illustTitle || '未命名'),
    userId: /^\d{1,16}$/.test(String(w.userId || '')) ? String(w.userId) : '', userName: String(w.userName || '未知画师'),
    width: Number(w.width) || 0, height: Number(w.height) || 0,
    cover: w.url || w.urls?.small || w.urls?.regular || '',
    pageCount: Number(w.pageCount) || 1, type: Number(w.illustType) || 0,
    date: w.createDate || w.uploadDate || '', tags: Array.isArray(w.tags) ? w.tags : (w.tags?.tags || []).map(t => t.tag),
    bookmarkCount: Number(w.bookmarkCount) || 0,
    xRestrict: Number(w.xRestrict ?? w.x_restrict ?? 0), sl: Number(w.sl) || 0,
    bookmarkData: w.bookmarkData || null, bookmarkKnown: Object.hasOwn(w, 'bookmarkData'),
    bookmarkDate: w.bookmarkDate || w.bookmarkData?.createDate || '',
    isFollowed: !!w.isFollowed, bookmarkTags: w.bookmarkTags || []
  };
}
// Adult works (R-18 / R-18G), works tagged as such, and Pixiv's "sensitive" level (sl >= 6, which the
// website hides unless sensitive content is enabled) stay out of all-ages views.
function tagText(t) { return typeof t === 'string' ? t : t?.tag || ''; }
function restrictedWork(w) {
  return Number(w.xRestrict) > 0 || Number(w.sl) >= 6 || (w.tags || []).some(t => /^r-?18(?:g)?$/i.test(tagText(t).trim()));
}
function decodeEntities(s) {
  return s.replace(/&quot;/g, '"').replace(/&#(?:39|x27);/gi, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
function accountFromHtml(html) {
  let user;
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    if (!/\b(?:id|name)=["'](?:meta-)?global-data["']/i.test(tag)) continue;
    const raw = tag.match(/\bcontent=(["'])([\s\S]*?)\1/i)?.[2];
    try { const data = JSON.parse(decodeEntities(raw || '')); user = data.userData?.self || data.userData; } catch {}
  }
  if (!user?.id && !user?.userId) {
    const raw = html.match(/<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
    try {
      const data = JSON.parse(raw || '{}').props?.pageProps;
      const state = typeof data?.serverSerializedPreloadedState === 'string' ? JSON.parse(data.serverSerializedPreloadedState) : data?.serverSerializedPreloadedState;
      user = state?.userData?.self || state?.userData || data?.userData;
    } catch {}
  }
  const id = user?.id || user?.userId;
  if (!id) return null;
  return { id: String(id), name: user.name || user.userName || `用户 ${id}`, premium: user.premium === true || user.isPremium === true || user.premium === '1' || user.isPremium === '1' || user.premium === 1, avatar: user.image || user.profileImg || '' };
}
function csrfFromHtml(html) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    if (!/\b(?:id|name)=["'](?:meta-)?global-data["']/i.test(tag)) continue;
    try { return JSON.parse(decodeEntities(tag.match(/\bcontent=(["'])([\s\S]*?)\1/i)?.[2] || '{}')).token || ''; } catch {}
  }
  try {
    const data = JSON.parse(html.match(/<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1] || '{}').props?.pageProps;
    const state = typeof data?.serverSerializedPreloadedState === 'string' ? JSON.parse(data.serverSerializedPreloadedState) : data?.serverSerializedPreloadedState;
    return state?.api?.token || '';
  } catch { return ''; }
}
module.exports = { parsePages, safeName, artworkName, validateId, imageUrl, mirrorHost, normalizeWork, restrictedWork, tagText, accountFromHtml, csrfFromHtml };
