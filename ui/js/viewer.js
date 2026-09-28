/* Artwork viewer: pages, animated works, bookmarks, follows and the related-works grid. */
const pendingSaves = new Set(), relatedCache = new Map(), following = new Map();
let relatedWorks = [], relatedObserver = null, lastViewerId = '', player = null;

async function openDetail(id) {
  const revision = ++state.viewerRevision;
  stopUgoira();
  $('#viewer-content').innerHTML = '<div class="busy-note">正在载入作品…</div>';
  if (!$('#viewer').open) $('#viewer').showModal();
  try {
    const work = await bridge.call('detail', { id });
    if (revision !== state.viewerRevision || !$('#viewer').open) return;
    state.detail = work; state.detailPage = 0; renderViewer();
  } catch (e) {
    if (revision !== state.viewerRevision) return;
    $('#viewer-content').innerHTML = empty('作品暂时无法打开', e.message, '<button class="secondary" data-viewer-close>关闭</button>');
  }
}
// A bookmarked work the artist deleted or hid: show what the local archive kept about it.
function openArchived(work) {
  state.viewerRevision++; stopUgoira(); relatedObserver?.disconnect(); state.detail = null;
  const saved = work.savedAt ? new Date(work.savedAt).toLocaleDateString(I18N.locale) : '';
  const tags = (work.tags || []).map(t => typeof t === 'string' ? t : t.tag).filter(Boolean);
  $('#viewer-content').innerHTML = `<div class="viewer-layout archived"><div class="viewer-image-area"><div class="viewer-image-stage">${work.cover ? `<img src="${esc(imageSrc(work.cover))}" alt="${esc(work.title)}">` : `<span class="missing-art large">${icon('image')}<small>没有保存缩略图</small></span>`}</div><div class="viewer-pagination"><span>${work.archived ? '本地存档的缩略图' : '没有本地存档'}</span></div></div>
  <aside class="viewer-info"><button class="icon-button viewer-close" data-viewer-close aria-label="关闭">${icon('close')}</button><div class="eyebrow">ARCHIVED / ${esc(work.id)}</div><h2 translate="no">${esc(work.title)}</h2>${work.userId ? `<button class="author" translate="no" data-artist="${esc(work.userId)}">${icon('user')}${esc(work.userName)}</button>` : ''}
  <div class="archive-note">${icon('info')}<span>作者已删除这部作品，或将其设为非公开。${work.archived ? `以下是澄阅${saved ? `在 ${esc(saved)} ` : ''}保存的存档信息，仅保存在这台电脑上。` : '澄阅没有这部作品的存档：只有在软件中浏览过的收藏才会被记录。'}</span></div>
  ${work.archived ? `<div class="viewer-meta">${work.type === 2 ? '动图' : `${Number(work.pageCount) || 1} 页 · 插画 / 漫画`}${work.date ? `<br>投稿于 ${esc(new Date(work.date).toLocaleDateString(I18N.locale))}` : ''}</div><div class="tags" translate="no">${tags.map(t => `<button data-tag="${esc(t)}"># ${esc(t)}</button>`).join('')}</div>` : ''}
  <button class="secondary" data-open-pixiv="${esc(work.id)}">${icon('external')}在 Pixiv 中查看</button><div class="viewer-bookmark">${heart(work, 'viewer-heart')}</div></aside></div>`;
  if (!$('#viewer').open) $('#viewer').showModal();
}
function closeViewer() { state.viewerRevision++; if ($('#viewer').open) $('#viewer').close(); }
$('#viewer').addEventListener('close', () => { state.viewerRevision++; stopUgoira(); relatedObserver?.disconnect(); relatedObserver = null; lastViewerId = ''; closeMenus(); });
dismissOnBackdrop($('#viewer'), closeViewer);

function followButton(id, followed) { return `<button type="button" class="secondary follow-artist ${followed ? 'followed' : ''}" data-follow-id="${esc(id)}">${icon(followed ? 'check' : 'user')}<span>${followed ? '已关注' : '关注画师'}</span></button>`; }
function renderViewer() {
  const w = state.detail, content = $('#viewer-content'), keep = lastViewerId === w.id ? content.scrollTop : 0;
  const animated = w.type === 2, page = w.pages[state.detailPage];
  content.innerHTML = `<div class="viewer-layout"><div class="viewer-image-area"><div class="viewer-image-stage" id="viewer-stage"><img id="viewer-image" src="${esc(imageSrc(page.regular))}" alt="${esc(w.title)} · 第 ${state.detailPage + 1} 页"></div>${animated
    ? `<div class="viewer-pagination"><button class="icon-button" id="ugoira-toggle" aria-label="暂停动图" disabled>${icon('pause')}</button><span id="ugoira-status">动图 · 正在载入帧…</span></div>`
    : `<div class="viewer-pagination"><button class="icon-button" data-step="-1" aria-label="上一张" ${state.detailPage === 0 ? 'disabled' : ''}>${icon('chevron-left')}</button><span>第 <input type="number" id="image-page" aria-label="跳转到页码" min="1" max="${w.pages.length}" value="${state.detailPage + 1}"> / ${w.pages.length} 页</span><button class="icon-button" data-step="1" aria-label="下一张" ${state.detailPage === w.pages.length - 1 ? 'disabled' : ''}>${icon('chevron-right')}</button></div>`}</div>
  <aside class="viewer-info"><button class="icon-button viewer-close" data-viewer-close aria-label="关闭作品">${icon('close')}</button><div class="eyebrow">${animated ? 'ANIMATION' : 'ARTWORK'} / ${esc(w.id)}</div><h2 translate="no">${esc(w.title)}</h2><button class="author" translate="no" data-artist="${esc(w.userId)}">${icon('user')}${esc(w.userName)}</button>${followButton(w.userId, following.get(w.userId))}<p class="description" translate="no">${esc(w.description)}</p><div class="viewer-meta">${animated ? '动图' : `${w.pages.length} 页 · 插画 / 漫画`}<br>${esc(w.date ? new Date(w.date).toLocaleDateString(I18N.locale) : '')}${w.width ? `<br>${Number(w.width)} × ${Number(w.height)} px` : ''}</div><div class="tags" translate="no">${w.tags.map(t => typeof t === 'string' ? t : t.tag).map(t => `<button data-tag="${esc(t)}"># ${esc(t)}</button>`).join('')}</div><button class="secondary" data-open-pixiv>${icon('external')}在 Pixiv 中查看</button><div class="viewer-download"><button class="primary" id="viewer-download-button">${icon('download')}${animated ? '下载动图' : '下载作品'}${icon('chevron-down')}</button><section class="download-menu hidden" id="viewer-menu" aria-label="作品下载选项"></section></div><div class="viewer-bookmark">${heart(w, 'viewer-heart')}<button type="button" class="secondary" data-bookmark-settings="${esc(w.id)}" title="公开范围与取消收藏" ${w.bookmarkData ? '' : 'hidden'}>收藏设置</button></div><button type="button" class="related-jump" data-related-jump>向下查看相关作品${icon('chevron-down')}</button></aside></div>
  <section class="related-section" id="related-section"><div class="related-heading"><h3>相关作品</h3><small>来自 Pixiv 推荐 · 向下滚动自动加载</small></div><div id="related-content" class="related-grid"></div><div id="related-foot" class="related-foot" aria-live="polite"></div></section>`;
  $('#viewer').setAttribute('aria-label', w.title);
  if (animated) startUgoira(w);
  const followBtn = $('[data-follow-id]', content);
  followBtn.disabled = !following.has(w.userId);
  if (!following.has(w.userId)) bridge.call('artist-status', { id: w.userId }).then(r => {
    following.set(w.userId, r.isFollowed);
    if (state.detail === w) $$('[data-follow-id]', content).forEach(b => { b.outerHTML = followButton(w.userId, r.isFollowed); });
  }).catch(() => { followBtn.title = '关注状态暂不可用'; });
  watchRelated(w); loadRelated(w);
  content.scrollTop = keep; lastViewerId = w.id;
}
function showPage(n) { const w = state.detail; if (!w || n < 0 || n >= w.pages.length) return; state.detailPage = n; closeMenus(); renderViewer(); }
$('#viewer').addEventListener('click', e => {
  const t = e.target, hit = sel => t.closest(sel);
  let el;
  if (hit('[data-viewer-close]')) return closeViewer();
  if ((el = hit('[data-step]'))) return showPage(state.detailPage + Number(el.dataset.step));
  if ((el = hit('[data-artist]'))) return guarded(() => openArtist(el.dataset.artist))();
  if ((el = hit('[data-related-artist]'))) return guarded(() => openArtist(el.dataset.relatedArtist))();
  if ((el = hit('[data-related]'))) return guarded(() => openDetail(el.dataset.related))();
  if ((el = hit('[data-tag]'))) return runSearch('tag', el.dataset.tag);
  if ((el = hit('[data-open-pixiv]'))) return guarded(() => bridge.call('open-pixiv', { type: 'artwork', id: el.dataset.openPixiv || state.detail.id }))();
  if (hit('#viewer-download-button')) return $('#viewer-menu').classList.contains('hidden') ? showDownloadMenu(state.detail) : closeMenus();
  if ((el = hit('[data-bookmark-settings]'))) return guarded(() => bookmarkSettings(state.detail))();
  if ((el = hit('[data-follow-id]'))) return guarded(() => setFollow(el))();
  if (hit('[data-related-jump]')) return $('#related-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (hit('#ugoira-toggle')) return toggleUgoira();
  if (hit('#viewer-stage canvas')) return toggleUgoira();
});
$('#viewer').addEventListener('change', e => { if (e.target.id === 'image-page' && Number.isInteger(Number(e.target.value))) showPage(Number(e.target.value) - 1); });
document.addEventListener('keydown', e => {
  if (!$('#viewer').open || $('#bookmark-dialog').open || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.target.closest('input,textarea,select,[contenteditable="true"]')) return;
  if (!state.detail) return;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); showPage(state.detailPage + (e.key === 'ArrowRight' ? 1 : -1)); }
  if (e.key === ' ' && player && !e.target.closest('button')) { e.preventDefault(); toggleUgoira(); }
});

/* ---- Animated works: frames are decoded once and drawn on a canvas with their own timing ---- */
function stopUgoira() { if (!player) return; clearTimeout(player.timer); player.bitmaps?.forEach(b => b.close()); player = null; }
async function startUgoira(work) {
  if (player?.id === work.id && player.canvas) { $('#viewer-stage').replaceChildren(player.canvas); updateUgoiraControls(); return; }
  stopUgoira();
  const current = player = { id: work.id, playing: true, index: 0 };
  try {
    const data = await bridge.call('ugoira', { id: work.id });
    const bitmaps = await Promise.all(data.frames.map(f => createImageBitmap(new Blob([f.data], { type: data.mime }))));
    if (player !== current) return bitmaps.forEach(b => b.close());
    const canvas = document.createElement('canvas');
    canvas.width = bitmaps[0].width; canvas.height = bitmaps[0].height; canvas.title = '点击暂停 / 播放';
    Object.assign(current, { bitmaps, delays: data.frames.map(f => f.delay), canvas, context: canvas.getContext('2d') });
    $('#viewer-stage')?.replaceChildren(canvas);
    tickUgoira(current);
  } catch (e) {
    if (player === current) { player = null; const status = $('#ugoira-status'); if (status) status.textContent = `动图载入失败：${e.message}`; }
  }
}
function tickUgoira(p) {
  if (player !== p) return;
  p.context.drawImage(p.bitmaps[p.index], 0, 0);
  updateUgoiraControls();
  if (p.playing) p.timer = setTimeout(() => { p.index = (p.index + 1) % p.bitmaps.length; tickUgoira(p); }, p.delays[p.index]);
}
function toggleUgoira() { if (!player?.bitmaps) return; player.playing = !player.playing; clearTimeout(player.timer); tickUgoira(player); }
function updateUgoiraControls() {
  const button = $('#ugoira-toggle'), status = $('#ugoira-status'); if (!button || !player?.bitmaps) return;
  button.disabled = false; button.innerHTML = icon(player.playing ? 'pause' : 'play'); button.setAttribute('aria-label', player.playing ? '暂停动图' : '播放动图');
  status.textContent = `动图 · 第 ${player.index + 1} / ${player.bitmaps.length} 帧${player.playing ? '' : ' · 已暂停'}`;
}

/* ---- Bookmarks: the heart toggles (save publicly / remove); the dialog changes public ↔ private ---- */
function syncBookmark(work) {
  const all = [...state.works, ...relatedWorks, state.detail, ...[...state.selected.values()].map(x => x.work)];
  for (const entry of relatedCache.values()) all.push(...entry.works);
  for (const w of all) if (w?.id === work.id) w.bookmarkData = work.bookmarkData;
  $$('[data-save]').filter(b => b.dataset.save === work.id).forEach(b => { b.outerHTML = heart(work, b.classList.contains('viewer-heart') ? 'viewer-heart' : 'cover-heart'); });
  if (state.detail?.id === work.id) $('#viewer [data-bookmark-settings]')?.toggleAttribute('hidden', !work.bookmarkData);
  if (state.view === 'bookmarks' && !work.bookmarkData) { state.works = state.works.filter(w => w.id !== work.id); render(); }
}
async function toggleBookmark(work) {
  if (!work || pendingSaves.has(work.id)) return;
  if (!state.account) throw new Error('请先登录 Pixiv，再收藏作品');
  const account = state.account.id, removing = !!work.bookmarkData;
  pendingSaves.add(work.id); $$('[data-save]').filter(b => b.dataset.save === work.id).forEach(b => b.disabled = true);
  try {
    let bookmarkData = null, alreadySaved = false;
    if (removing) { try { await bridge.call('bookmark-remove', { id: work.id }); } catch (e) { if (!/不在收藏中/.test(e.message)) throw e; } }
    else ({ bookmarkData, alreadySaved } = await bridge.call('bookmark-quick', { id: work.id }));
    if (state.account?.id !== account) return;
    work.bookmarkData = bookmarkData; syncBookmark(work);
    toast(removing ? '已取消收藏' : alreadySaved ? '这部作品已经收藏' : '已加入公开收藏');
  } finally { pendingSaves.delete(work.id); $$('[data-save]').filter(b => b.dataset.save === work.id).forEach(b => b.disabled = false); }
}
document.addEventListener('click', e => {
  const button = e.target.closest('[data-save]'); if (!button) return;
  e.preventDefault(); e.stopPropagation();
  const id = button.dataset.save;
  guarded(() => toggleBookmark([state.detail, ...state.works, ...relatedWorks].find(w => w?.id === id)))();
}, true);
async function bookmarkSettings(work) {
  if (!work) return;
  if (!state.account) throw new Error('请先登录，再管理 Pixiv 收藏');
  const dialog = $('#bookmark-dialog');
  openDialog(dialog, '<div class="busy-note">读取收藏状态…</div>');
  let current;
  try { current = (await bridge.call('bookmark-state', { id: work.id })).bookmarkData; }
  catch (e) { dialog.innerHTML = empty('暂时无法读取收藏', e.message, '<button class="secondary" data-dialog-close>关闭</button>'); return; }
  const privacyCard = (value, title, note) => `<label class="choice-card"><input type="radio" name="bookmark-privacy" value="${value}" ${!!current?.private === (value === 'private') ? 'checked' : ''}><span>${icon(value === 'private' ? 'lock' : 'globe')}<strong>${title}</strong><small>${note}</small></span></label>`;
  dialog.innerHTML = `<div class="dialog-heading"><h2>收藏设置</h2><button class="icon-button" data-dialog-close aria-label="关闭">${icon('close')}</button></div><h3 class="bookmark-title" translate="no">${esc(work.title)}</h3>${current ? `<div class="choice-grid">${privacyCard('public', '公开收藏', '其他人可以在你的收藏中看到')}${privacyCard('private', '不公开收藏', '只有你自己可以看到')}</div><p class="help-text">收藏标签（分类）请在 Pixiv 官网编辑；这里修改公开范围不会改动已有标签。</p><div class="dialog-actions"><button class="secondary" data-official-edit>${icon('external')}在官网编辑标签</button><button class="secondary danger" data-remove-bookmark>取消收藏…</button></div>` : '<p class="help-text">这部作品目前不在你的收藏中。</p><div class="dialog-actions"><button class="primary" data-add-bookmark>加入公开收藏</button></div>'}<p class="help-text" id="bookmark-message" aria-live="polite"></p>`;
  $$('[name="bookmark-privacy"]', dialog).forEach(input => input.onchange = guarded(async () => {
    const privateFlag = input.value === 'private';
    $$('[name="bookmark-privacy"]', dialog).forEach(i => i.disabled = true);
    try {
      const result = await bridge.call('bookmark-privacy', { id: work.id, private: privateFlag });
      work.bookmarkData = result.bookmarkData; syncBookmark(work);
      $('#bookmark-message').textContent = `已改为${privateFlag ? '不公开' : '公开'}收藏`;
      if (state.view === 'bookmarks') load();
    } catch (e) { $$('[name="bookmark-privacy"]', dialog).forEach(i => { i.checked = (i.value === 'private') === !!current.private; }); throw e; }
    finally { $$('[name="bookmark-privacy"]', dialog).forEach(i => i.disabled = false); }
  }));
  $('[data-official-edit]', dialog)?.addEventListener('click', guarded(() => bridge.call('open-pixiv', { type: 'artwork', id: work.id })));
  $('[data-add-bookmark]', dialog)?.addEventListener('click', guarded(async () => { dialog.close(); await toggleBookmark(work); }));
  $('[data-remove-bookmark]', dialog)?.addEventListener('click', () => {
    $('#bookmark-message').innerHTML = '确认从 Pixiv 取消这部作品的收藏？ <button type="button" class="secondary danger" data-confirm-remove>确认取消收藏</button>';
    $('[data-confirm-remove]', dialog).onclick = guarded(async () => { dialog.close(); await toggleBookmark(work); });
  });
}
$('#bookmark-dialog').addEventListener('click', e => { if (e.target.closest('[data-dialog-close]')) $('#bookmark-dialog').close(); });
dismissOnBackdrop($('#bookmark-dialog'));

/* ---- Following an artist: a second click on "已关注" is required to unfollow ---- */
async function setFollow(button) {
  const id = button.dataset.followId;
  if (!state.account) throw new Error('请先登录 Pixiv，再关注画师');
  const followed = following.get(id) ?? (state.artistId === id && !!state.artist?.isFollowed);
  if (followed && !button.dataset.confirm) { button.dataset.confirm = '1'; $('span', button).textContent = '再次点击取消关注'; return; }
  button.disabled = true;
  try {
    const result = await bridge.call('follow-artist', { id, follow: !followed });
    following.set(id, result.isFollowed); if (state.artistId === id && state.artist) state.artist.isFollowed = result.isFollowed;
    $$('[data-follow-id]').filter(b => b.dataset.followId === id).forEach(b => { b.outerHTML = followButton(id, result.isFollowed); });
    toast(result.isFollowed ? '已关注画师' : '已取消关注');
  } finally { button.disabled = false; }
}

/* ---- Related works: a vertical grid that keeps loading while scrolling, like the Pixiv website ---- */
function relatedCard(w) { return `<article class="related-card"><div class="related-thumb"><button class="related-open" data-related="${esc(w.id)}" aria-label="${esc(w.title)}"><img src="${esc(imageSrc(w.cover))}" alt="" loading="lazy"></button>${w.type === 2 ? `<span class="badge">${icon('film')}动图</span>` : w.pageCount > 1 ? `<span class="badge">${icon('layers')}${w.pageCount}</span>` : ''}${heart(w)}</div><button class="related-title" translate="no" data-related="${esc(w.id)}" title="${esc(w.title)}">${esc(w.title)}</button><button class="related-artist" translate="no" data-related-artist="${esc(w.userId)}" title="${esc(w.userName)}">${esc(w.userName)}</button></article>`; }
function recheckRelated() { const foot = $('#related-foot'); if (relatedObserver && foot) { relatedObserver.unobserve(foot); relatedObserver.observe(foot); } }
function showRelated(work, entry) {
  if (!$('#viewer').open || state.detail !== work) return;
  const box = $('#related-content'), foot = $('#related-foot'); if (!box) return;
  relatedWorks = entry.works;
  if (relatedWorks.length > box.children.length) box.insertAdjacentHTML('beforeend', relatedWorks.slice(box.children.length).map(relatedCard).join(''));
  foot.innerHTML = entry.error ? `<span>${esc(entry.error)}</span><button class="secondary" data-related-retry>重试</button>`
    : entry.loading ? '<span class="spinner"></span><span>正在载入相关作品…</span>'
    : !relatedWorks.length ? '<span>Pixiv 暂未返回相关作品</span>'
    : entry.nextIds.length ? '<span>继续向下滚动，加载更多</span>' : `<span>已经看完 ${relatedWorks.length} 部相关作品</span>`;
  $('[data-related-retry]', foot)?.addEventListener('click', () => { if (entry.works.length) { entry.error = ''; loadRelated(work, true); } else { relatedCache.delete(work.id); loadRelated(work); } });
  if (!entry.loading && !entry.error) recheckRelated();
}
async function loadRelated(work, more = false) {
  let entry = relatedCache.get(work.id);
  if (entry && (!more || entry.loading || entry.error)) return showRelated(work, entry);
  if (more && !entry?.nextIds.length) return;
  const ids = more ? entry.nextIds.slice(0, 18) : undefined;
  if (more) Object.assign(entry, { nextIds: entry.nextIds.slice(18), loading: true, error: '' });
  else { entry = { works: [], nextIds: [], loading: true, error: '' }; relatedCache.set(work.id, entry); if (relatedCache.size > 40) relatedCache.delete(relatedCache.keys().next().value); }
  showRelated(work, entry);
  try {
    const result = await bridge.call('related', { id: work.id, ids });
    const seen = new Set(entry.works.map(w => w.id));
    entry.works.push(...result.works.filter(w => w.id !== work.id && !seen.has(w.id)));
    if (!more) entry.nextIds = result.nextIds;
  } catch (e) { entry.error = e.message; if (more) entry.nextIds = [...ids, ...entry.nextIds]; }
  finally { entry.loading = false; showRelated(work, entry); }
}
function watchRelated(work) {
  relatedObserver?.disconnect();
  relatedObserver = new IntersectionObserver(items => {
    if (!items.some(i => i.isIntersecting) || state.detail !== work) return;
    const entry = relatedCache.get(work.id);
    if (entry && !entry.loading && !entry.error && entry.nextIds.length) loadRelated(work, true);
  }, { root: $('#viewer-content'), rootMargin: '0px 0px 600px 0px' });
  relatedObserver.observe($('#related-foot'));
}
bridge.on('account-changed', () => { relatedCache.clear(); following.clear(); relatedWorks = []; });
