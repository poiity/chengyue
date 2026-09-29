/* Gallery views (recommend, feed, following, bookmarks, history, search, artist), selection and downloads. */
const viewNames = { recommend: '为你推荐', feed: '关注动态', following: '关注画师', bookmarks: '我的收藏', history: '浏览历史', search: '搜索结果', artist: '画师主页', downloads: '下载中心' };
const navFor = { recommend: 'recommend', feed: 'feed', following: 'following', bookmarks: 'bookmarks', history: 'history', downloads: 'downloads' };
const heart = (w, cls = 'cover-heart') => `<button type="button" class="${cls} ${w.bookmarkData ? 'saved' : ''}" data-save="${esc(w.id)}" aria-pressed="${!!w.bookmarkData}" aria-label="${w.bookmarkData ? '取消收藏' : '收藏作品'}" title="${w.bookmarkData ? '已收藏 · 再次点击取消收藏' : '加入公开收藏'}">${icon('heart')}${cls === 'viewer-heart' ? `<span>${w.bookmarkData ? '已收藏' : '收藏作品'}</span>` : ''}</button>`;

function cardExtra(w) {
  if (state.view === 'recommend') return `<div class="card-note"><span title="${esc(w.reason || '发现新的画师')}">${esc(w.reason || '发现新的画师')}</span><button class="dismiss" data-dismiss="${esc(w.id)}" title="不感兴趣" aria-label="对这部作品不感兴趣">×</button></div>`;
  if (state.view === 'history') return `<div class="card-note">${esc(new Date(w.viewedAt).toLocaleTimeString(I18N.locale, { hour: '2-digit', minute: '2-digit' }))} 浏览</div>`;
  if (state.view === 'bookmarks') return `<div class="card-note">${icon(w.bookmarkData?.private ? 'lock' : 'globe')}<span>${w.bookmarkData?.private ? '不公开' : '公开'} · ${w.masked ? (w.archived ? '作者已删除或隐藏 · 本地存档' : '作者已删除或隐藏 · 无本地存档') : w.bookmarkDate ? `${esc(w.bookmarkDate.slice(0, 10))} 收藏` : w.bookmarkMonth ? `${monthLabel(w.bookmarkMonth)} 收藏` : '收藏时间未同步'}</span></div>`;
  return '';
}
function artCard(w) {
  const badge = w.masked ? `<span class="badge warn">${w.archived ? '本地存档' : '已删除'}</span>` : w.type === 2 ? `<span class="badge">${icon('film')}动图</span>` : w.pageCount > 1 ? `<span class="badge">${icon('layers')}${w.pageCount}</span>` : '';
  return `<article class="art-card" data-id="${esc(w.id)}"><div class="art-cover" role="button" tabindex="0" data-open="${esc(w.id)}" aria-label="${esc(w.title)}" aria-pressed="false">${w.masked && !w.cover ? `<span class="missing-art">${icon('image')}<small>作品已删除或非公开</small></span>` : `<img src="${esc(imageSrc(w.cover))}" alt="" loading="lazy">`}<span class="select-indicator">${icon('check')}</span>${badge}${heart(w)}</div><h3 class="art-title" translate="no" title="${esc(w.title)}">${esc(w.title)}</h3><div class="art-meta"><span class="tiny-avatar" translate="no">${esc(w.userName?.slice(0, 1))}</span><button class="artist-link" translate="no" data-artist="${esc(w.userId)}" title="查看画师 ${esc(w.userName)}">${esc(w.userName)}</button><span class="date">${dateLabel(w.date)}</span></div><button class="range-chip" data-range-chip="${esc(w.id)}" title="编辑下载内容"></button>${cardExtra(w)}</article>`;
}
function pagination() { return `<div class="pagination"><button class="secondary" data-page="-1" ${state.page <= 1 ? 'disabled' : ''}>${icon('chevron-left')}上一页</button><span>第 ${state.page} 页</span><button class="secondary" data-page="1" ${state.hasMore ? '' : 'disabled'}>下一页${icon('chevron-right')}</button></div>`; }
// Account views without a signed-in account show one sign-in prompt instead of filters and errors.
const needsLogin = () => ['feed', 'following', 'bookmarks'].includes(state.view) && !state.account;
function galleryBody() {
  if (needsLogin()) return empty('登录后查看你的 Pixiv 内容', { feed: '登录后，这里会按时间显示关注画师的新作品，也可以按画师分类查看。', following: '登录后，这里会列出你关注的画师，并支持按分类筛选。', bookmarks: '登录后，这里会显示你的公开与不公开收藏。' }[state.view], '<button class="primary" data-action="login">登录 Pixiv</button>');
  if (state.busy) return `<div class="loading-line"></div><p class="help-text">${{ bookmarks: '正在读取收藏；组合筛选会检索全部匹配收藏，请稍候。', artist: state.title ? '正在搜索画师的全部作品标题，首次索引可能需要一些时间…' : '正在读取画师作品…', feed: state.followTag ? '正在汇总该分类画师的作品…' : '正在读取关注动态…' }[state.view] || '正在为你准备作品…'}</p><div class="grid">${'<div class="skeleton"></div>'.repeat(8)}</div>`;
  if (state.view === 'following') return state.people.length ? `<div class="people-grid">${state.people.map(u => `<button class="person-card" data-person="${esc(u.id)}"><img src="${esc(imageSrc(u.avatar))}" alt=""><strong translate="no">${esc(u.name)}</strong><small>UID ${esc(u.id)}</small><span class="person-works">${u.works.slice(0, 3).map(w => `<img src="${esc(imageSrc(w.cover))}" alt="" loading="lazy">`).join('')}</span><span class="person-go">浏览作品 ${icon('arrow-right')}</span></button>`).join('')}</div>${pagination()}` : empty('这个分类暂时没有画师', '请选择其他关注分类，或切换公开 / 不公开关注。');
  if (state.works.length) return `<div class="grid">${state.works.map(artCard).join('')}</div>${pagination()}`;
  return state.view === 'history' ? empty('本次还没有浏览记录', MAC ? '打开一部作品，它就会出现在这里。真正退出软件后自动清空；关闭窗口在后台运行时不会清空。' : '打开一部作品，它就会出现在这里。真正退出软件后自动清空；最小化到托盘不会清空。') : empty('暂时没有匹配的作品', '可以调整筛选条件，或点击刷新。');
}
function followFilters(includeAll) {
  const tags = state.followTags.map(t => [t, t]);
  return `<select id="follow-tag" aria-label="画师分类">${[includeAll ? ['', '全部关注动态'] : ['', '全部关注画师'], ...tags].map(([v, t]) => option(v, t, state.followTag)).join('')}</select><select id="follow-rest" aria-label="关注公开性">${option('show', '公开关注', state.followRest)}${option('hide', '不公开关注', state.followRest)}</select>`;
}
function heading() {
  const v = state.view;
  if (needsLogin()) return `<div class="section-heading"><h2>${viewNames[v]}</h2></div>`;
  if (v === 'recommend') return `<section class="page-hero"><div><h1>发现下一份喜欢<span>✦</span></h1><p>沿着你的兴趣，遇见新的画师；也找回错过的好作品。</p></div>${switchField('recommend-r18', '展示 18+ 内容', state.allowR18, '遵循账号权限')}</section><div class="toolbar"><button class="tab-button ${state.recKind === 'for-you' ? 'active' : ''}" data-rec="for-you">为你推荐</button><button class="tab-button ${state.recKind === 'hot' ? 'active' : ''}" data-rec="hot">当前热门</button><span class="spacer"></span><span class="subtitle">已收藏与本次看过的作品会被过滤</span></div><div class="interest-strip">${state.interests.length ? `近期偏好 ${state.interests.map(t => `<button translate="no" data-interest="${esc(t.tag)}"># ${esc(t.tag)}</button>`).join('')}` : '从热门与新作开始，浏览作品后逐渐了解你的 Tag 偏好。'}</div>`;
  if (v === 'feed') return `<div class="section-heading"><h2>关注动态</h2><span class="subtitle">${state.followTag ? `分类「${esc(state.followTag)}」中画师的作品 · 从新到旧` : '关注画师的最新作品'}</span></div><div class="toolbar"><span class="subtitle">画师分类</span>${followFilters(true)}</div>`;
  if (v === 'following') return `<div class="section-heading"><h2>关注画师</h2><span class="subtitle">${state.total == null ? '' : `${state.total} 位画师`}</span></div><div class="toolbar"><span class="subtitle">画师分类</span>${followFilters(false)}</div>`;
  if (v === 'bookmarks') return `<div class="section-heading"><h2>我的收藏</h2><span class="subtitle">${state.total == null ? '' : `${state.total} 部作品`}</span><div class="heading-right"><button class="secondary" data-action="official-bookmarks">${icon('external')}官网收藏</button></div></div><form id="bookmark-filters" class="filter-panel bm-panel"><div class="bm-filters"><div class="filter-row">${selectField('bm-rest', '可见性', [['show', '公开收藏'], ['hide', '不公开收藏']], state.bm.rest)}${selectField('bm-order', '排序', [['newest', '最近收藏在前'], ['oldest', '最早收藏在前']], state.bm.order)}${selectField('bm-age', '年龄限制', [['all', '全部'], ['safe', '全年龄'], ['r18', '18+']], state.bm.age)}${selectField('bm-tag', '收藏标签', [['', '全部收藏标签'], ['未分類', '未分类'], ...(state.bm.rest === 'hide' ? state.bmTags.private : state.bmTags.public).map(t => [t, t])], state.bm.tag)}${monthField()}</div><div class="filter-row"><label class="field grow">作品标签<input id="bm-artwork-tag" class="text-input" value="${esc(state.bm.artworkTag)}" placeholder="空格分隔，同时匹配多个标签"></label><button type="submit" class="primary">应用筛选</button><button type="button" class="secondary" data-action="bm-reset">重置</button></div><p class="help-text" id="bm-sync-note">${monthSyncNote()}</p></div>${manageBox()}</form>`;
  if (v === 'history') return `<div class="section-heading"><h2>浏览历史</h2><span class="pill">仅本次运行</span><div class="heading-right"><button class="secondary" data-action="clear-history">清空历史</button></div></div><p class="help-text">只保存在内存中，最多 500 部。退出软件即清空。</p>`;
  if (v === 'search') return `<div class="tag-heading"><div class="eyebrow">DISCOVER YOUR NEXT FAVORITE</div><h1 translate="no"># ${esc(state.query)}</h1><p>${state.total == null ? '正在搜索…' : `找到 ${Number(state.total).toLocaleString('en-US')} 部作品`}</p><p class="help-text">空格连接多个关键词，同时匹配：风景 夜景 · 用 -标签 排除</p></div><div class="toolbar">${[['all', '插画 · 漫画'], ['illust', '插画'], ['manga', '漫画']].map(([t, label]) => `<button class="tab-button ${state.type === t ? 'active' : ''}" data-type="${t}">${label}</button>`).join('')}<span class="spacer"></span><select id="match" aria-label="标签匹配方式">${option('s_tag', 'Tag 部分一致', state.match)}${option('s_tag_full', 'Tag 完全一致', state.match)}${option('s_tc', '标题、说明文字', state.match)}${option('s_tag_tc', '标签、标题、说明文字', state.match)}</select><select id="sort" aria-label="排序方式">${option('date_d', '最新发布', state.order)}${option('date', '最早发布', state.order)}<option value="popular_d" ${state.order === 'popular_d' ? 'selected' : ''} ${state.account?.premium ? '' : 'disabled'}>热门排序 · Premium</option></select></div>`;
  if (v === 'artist') {
    const a = state.artist;
    return `<section class="artist-header">${a?.avatar ? `<img class="artist-avatar" src="${esc(imageSrc(a.avatar))}" alt="">` : `<span class="artist-avatar">${esc((a?.name || '画').slice(0, 1))}</span>`}<div class="artist-info"><h1 ${a ? 'translate="no"' : ''}>${esc(a?.name || '正在读取画师…')}</h1><p>UID ${esc(state.artistId)} · ${state.total == null ? '正在读取作品' : `${state.total} 部${state.title ? '匹配' : ''}作品`} · 从新到旧</p>${a ? followButton(state.artistId, a.isFollowed) : ''}</div><form class="artist-filter" id="artist-filter">${icon('search')}<input aria-label="按作品名称筛选" placeholder="在全部作品中搜索标题" value="${esc(state.title)}" maxlength="100"><button type="submit" class="icon-button" title="搜索标题">${icon('arrow-right')}</button></form></section>`;
  }
  return '';
}
function render() {
  $$('.nav-item[data-nav]').forEach(el => el.classList.toggle('active', el.dataset.nav === navFor[state.view]));
  $('#page-context').textContent = viewNames[state.view] || '澄阅';
  $('#modebar').classList.toggle('hidden', ['downloads', 'following'].includes(state.view));
  $('#refresh').disabled = state.busy;
  if (state.view === 'downloads') return renderDownloads();
  $('#main').innerHTML = `${heading()}${state.notice ? `<div class="info-banner">${esc(state.notice)}</div>` : ''}<div id="selection-bar" class="select-bar hidden"><span id="selection-count"></span><button data-action="select-page">选择本页</button><button data-action="clear-selection">清空选择</button></div>${state.error ? `<div class="error-banner">${esc(state.error)} <button class="secondary" data-action="retry">重试</button></div>` : ''}${galleryBody()}`;
  updateSelection(); updateManage();
}

async function load(refresh = false) {
  const revision = ++state.revision, view = state.view;
  Object.assign(state, { busy: !needsLogin(), error: '', notice: '', works: [], people: [], total: null });
  closeMenus(); render();
  if (needsLogin()) return;
  try {
    let result = { works: [], hasMore: false, total: null };
    if (view === 'recommend') {
      result = await bridge.call('recommendations', { page: state.page, kind: state.recKind, allowR18: state.allowR18, refresh });
      if (result.interests) state.interests = result.interests;
    } else if (view === 'feed' || view === 'following') {
      if (view === 'following' || state.followTag) {
        const call = view === 'following' ? 'following' : 'following-works';
        result = await bridge.call(call, { page: state.page, tag: state.followTag, rest: state.followRest });
      } else result = await bridge.call('feed', { page: state.page });
      // Category names come with the following list; fetch them once when the current call lacks them.
      if (result.tags) state.followTags = result.tags;
      else if (!state.followTags.length || refresh) state.followTags = (await bridge.call('following', { page: 1, rest: state.followRest }).catch(() => ({ tags: [] }))).tags;
      if (result.users) Object.assign(result, { works: [], people: result.users });
    } else if (view === 'bookmarks') {
      const [bookmarks, tags, periods] = await Promise.all([bridge.call('bookmarks', { ...state.bm, page: state.page }), bridge.call('bookmark-tags').catch(() => null), bridge.call('bookmark-periods', { rest: state.bm.rest }).catch(() => [])]);
      result = bookmarks; if (tags) state.bmTags = tags; state.bmPeriods = periods;
      syncMonths();
    } else if (view === 'history') {
      const works = await bridge.call('history');
      result = { works: works.slice((state.page - 1) * 48, state.page * 48), total: works.length, hasMore: state.page * 48 < works.length };
    } else if (view === 'search') {
      result = await bridge.call('search', { query: state.query, page: state.page, order: state.order, type: state.type, match: state.match });
    } else if (view === 'artist') {
      result = await bridge.call('artist', { id: state.artistId, page: state.page, title: state.title });
      state.artist = result.user;
    }
    if (revision !== state.revision) return;
    Object.assign(state, { works: result.works || [], people: result.people || [], total: result.total ?? null, hasMore: !!result.hasMore, notice: result.notice || '' });
  } catch (e) { if (revision !== state.revision) return; state.error = e.message; state.hasMore = false; reportError(e); }
  state.busy = false; render();
}
function navigate(view, extra = {}) {
  if (state.busy && state.view === 'bookmarks') bridge.call('refresh-library').catch(() => {});
  state.bmManage = false; state.bmPicked.clear();
  closeViewer();
  Object.assign(state, { view, page: 1, title: '', total: null, ...extra });
  load(); window.scrollTo(0, 0);
}
async function openArtist(id) {
  if (!id) throw new Error('无法读取画师 ID');
  navigate('artist', { artistId: String(id), artist: null });
}

/* ---- Selection and download menu ---- */
function setMode(mode) {
  if (mode === 'download' && state.bmManage) { state.bmManage = false; state.bmPicked.clear(); updateManage(); }
  state.mode = mode; document.body.classList.toggle('download-mode', mode === 'download');
  $('#mode-preview').classList.toggle('active', mode === 'preview'); $('#mode-download').classList.toggle('active', mode === 'download');
  $('#mode-hint').textContent = mode === 'download' ? '点击封面选择作品 · 默认保存全部页码' : '发现、浏览，留住每一次心动';
  updateSelection();
}
function selectionLabel(entry) { return entry.work.type === 2 ? (entry.ugoira === 'frames' ? '动图 · 原始帧' : '动图 · GIF') : entry.range ? `页码 ${entry.range}` : `全部 ${entry.work.pageCount} 页 · 自定义范围`; }
function updateSelection() {
  const count = state.selected.size;
  $('#download-button').disabled = !count;
  $('#download-button-text').textContent = count ? `下载所选 · ${count}` : '下载作品';
  $$('.art-card', $('#main')).forEach(card => {
    const entry = state.selected.get(card.dataset.id);
    card.classList.toggle('selected', !!entry);
    $('.art-cover', card).setAttribute('aria-pressed', entry ? 'true' : 'false');
    if (entry) $('.range-chip', card).textContent = selectionLabel(entry);
  });
  const bar = $('#selection-bar');
  if (bar) { bar.classList.toggle('hidden', state.mode !== 'download'); $('#selection-count').textContent = `已选择 ${count} 部作品 · 支持跨页选择`; }
}
function toggleSelect(work) {
  if (state.selected.has(work.id)) state.selected.delete(work.id); else state.selected.set(work.id, { work, range: '', ugoira: 'gif' });
  updateSelection(); closeMenus();
}
function closeMenus() { $$('.download-menu').forEach(el => el.classList.add('hidden')); }
function showDownloadMenu(single = null) {
  const menu = single ? $('#viewer-menu') : $('#download-menu');
  const items = single ? [state.selected.get(single.id) || { work: single, range: '', ugoira: 'gif' }] : [...state.selected.values()];
  if (!menu || !items.length) return;
  closeMenus();
  const row = ({ work: w, range, ugoira }, i) => `<div class="range-row"><div class="range-row-head"><strong translate="no" title="${esc(w.title)}">${i + 1}. ${esc(w.title)}</strong><small>${w.type === 2 ? '动图' : `${w.pageCount} 页`}</small></div>${w.type === 2
    ? `<div class="range-control"><select data-ugoira="${esc(w.id)}" aria-label="${esc(w.title)} 动图保存方式">${option('gif', '合成 GIF 动图', ugoira)}${option('frames', '原始帧 + 帧时长 JSON', ugoira)}</select></div>`
    : `<div class="range-control"><select data-scope="${esc(w.id)}" aria-label="${esc(w.title)} 下载范围">${option('all', '全部页码', range ? 'custom' : 'all')}${option('custom', '自定义页码', range ? 'custom' : 'all')}</select><input class="text-input" data-range="${esc(w.id)}" aria-label="${esc(w.title)} 自定义页码" placeholder="例如 1-4,9-13" value="${esc(range)}" ${range ? '' : 'disabled'}></div><div class="range-error" data-error="${esc(w.id)}"></div>`}</div>`;
  menu.innerHTML = `<div class="menu-head"><h3>保存这份喜欢</h3><button class="icon-button" data-close-menu aria-label="关闭下载菜单">${icon('close')}</button></div><p class="help-text">${items.length} 部作品 · 按下方顺序下载原图<br>页码从 1 开始，支持跳页，例如 1-4,9-13；动图可保存为 GIF 或原始帧。</p><div class="range-list">${items.map(row).join('')}</div><button class="format-button" data-format="images">${icon('image')}<span><strong>保存为普通文件</strong><small>每部作品一个文件夹，保留原始画质</small></span></button><button class="format-button" data-format="separate">${icon('archive')}<span><strong>${items.length > 1 ? '按作品分别打包 ZIP' : '下载为 ZIP 压缩包'}</strong><small>文件名：作品名称 + 作者名字</small></span></button>${items.length > 1 ? `<button class="format-button" data-format="combined">${icon('layers')}<span><strong>全部合并为一个 ZIP</strong><small>按作品与页码顺序统一编号</small></span></button>` : ''}<div class="download-dir">${icon('folder')}<span title="${esc(state.settings.downloadDir)}">${esc(state.settings.downloadDir || '尚未选择目录')}</span><button data-choose-dir>更改目录</button></div>`;
  menu.classList.remove('hidden');
  const validate = entry => {
    const label = $(`[data-error="${esc(entry.work.id)}"]`, menu); if (!label) return true;
    const custom = $(`[data-scope="${esc(entry.work.id)}"]`, menu).value === 'custom';
    try { if (custom && !entry.range.trim()) throw new Error('请填写要下载的页码'); const pages = parseRange(entry.range, entry.work.pageCount); label.textContent = custom ? `将保存 ${pages.length} 页` : ''; label.classList.add('valid'); return true; }
    catch (e) { label.textContent = e.message; label.classList.remove('valid'); return false; }
  };
  items.forEach(entry => {
    const id = CSS.escape(entry.work.id), scope = $(`[data-scope="${id}"]`, menu), input = $(`[data-range="${id}"]`, menu), ugoira = $(`[data-ugoira="${id}"]`, menu);
    if (ugoira) ugoira.onchange = () => { entry.ugoira = ugoira.value; updateSelection(); };
    if (!scope) return;
    const update = () => { input.disabled = scope.value !== 'custom'; if (input.disabled) input.value = ''; entry.range = input.value; validate(entry); updateSelection(); };
    scope.onchange = () => { update(); if (!input.disabled) input.focus(); };
    input.oninput = update; validate(entry);
  });
  $('[data-close-menu]', menu).onclick = closeMenus;
  $('[data-choose-dir]', menu).onclick = guarded(async () => { state.settings = await bridge.call('choose-directory'); showDownloadMenu(single); });
  $$('[data-format]', menu).forEach(button => button.onclick = guarded(async () => {
    if (!items.every(validate)) return;
    button.disabled = true;
    try {
      await bridge.call('enqueue', { format: button.dataset.format, items: items.map(e => ({ id: e.work.id, title: e.work.title, range: e.range.trim(), ugoira: e.ugoira })) });
      closeMenus(); toast('已加入下载队列，可在下载中心查看进度');
    } finally { button.disabled = false; }
  }));
}

/* ---- Bookmark months: read from Pixiv's "收藏时间" data and remembered per work ---- */
const monthSync = new Map();
// Filtering by bookmark month is a Pixiv Premium feature: it is enabled when the account is Premium or Pixiv
// returns month data; otherwise it is shown labelled and disabled, so it can never lead to an error.
const monthsAvailable = () => !!state.account?.premium || state.bmPeriods.length > 0;
function monthField() {
  const premium = monthsAvailable();
  const options = premium ? [['', '不限'], ...state.bmPeriods.map(p => [p.period, `${monthLabel(p.period)} · ${p.count}`])] : [['', 'Premium 会员专属']];
  return `<label class="field" title="${premium ? '' : '按收藏月份筛选是 Pixiv Premium 会员专属功能'}"><span class="field-title">收藏时间<span class="premium-tag">Premium</span></span><select id="bm-month" ${premium ? '' : 'disabled'}>${options.map(([v, t]) => option(v, t, state.bm.bm)).join('')}</select></label>`;
}
function monthLabel(period) { const [y, m] = String(period).split('-'); return `${y}年${Number(m)}月`; }
function monthSyncNote() {
  const status = state.account && monthSync.get(`${state.account.id}:${state.bm.rest}`);
  if (status === 'running') return '正在从 Pixiv 同步收藏月份…';
  if (status?.startsWith('done:')) return `收藏月份已与 Pixiv 同步（${status.slice(5)} 部作品）。通过澄阅新收藏的作品还会记录具体日期。`;
  if (state.account && !monthsAvailable()) return '按月份查看收藏是 Pixiv Premium 会员专属功能。通过澄阅收藏的作品会记录具体日期，在软件中浏览过的收藏会保存在本机存档。';
  if (status === 'unsupported') return 'Pixiv 没有提供收藏时间（网页端按月份查看收藏为 Premium 会员功能）。通过澄阅新收藏的作品仍会记录具体日期。';
  return '收藏时间来自 Pixiv 的按月统计；通过澄阅新收藏的作品会记录具体日期。';
}
async function syncMonths() {
  const key = `${state.account?.id}:${state.bm.rest}`;
  if (!state.account || !monthsAvailable() || monthSync.has(key)) return;
  monthSync.set(key, 'running');
  try {
    const result = await bridge.call('bookmark-months-sync', { rest: state.bm.rest });
    monthSync.set(key, result.supported ? `done:${result.known}` : 'unsupported');
    // Newly learned months appear on the cards once the current page is shown again.
    if (result.synced && state.view === 'bookmarks' && !state.busy && !state.bmManage) return load();
  } catch { monthSync.set(key, 'unsupported'); }
  const note = $('#bm-sync-note'); if (note) note.textContent = monthSyncNote();
}

/* ---- Bookmark management (top-right of the filter panel): bulk public / private / remove ---- */
function manageBox() {
  const n = state.bmPicked.size, busy = state.bmBusy ? 'disabled' : '', none = !n || state.bmBusy ? 'disabled' : '';
  if (!state.bmManage) return `<div class="bm-manage" id="bm-manage"><div class="bm-manage-copy"><strong>${icon('check-square')}收藏管理</strong><small>批量设为公开 / 不公开，或取消收藏。开始后点击封面选择作品。</small></div><button type="button" class="primary" data-action="bm-manage">开始管理</button></div>`;
  return `<div class="bm-manage active" id="bm-manage"><div class="bm-manage-copy"><strong>${icon('check-square')}已选择 ${n} 部</strong><small>点击封面选择或取消选择</small></div><div class="bm-manage-actions"><button type="button" class="secondary" data-action="bm-public" ${none}>${icon('globe')}设为公开</button><button type="button" class="secondary" data-action="bm-private" ${none}>${icon('lock')}设为不公开</button><button type="button" class="secondary" data-action="bm-pick-page" ${busy}>全选本页</button><button type="button" class="secondary danger" data-action="bm-remove" ${none}>取消收藏</button></div><button type="button" class="primary" data-action="bm-manage" ${busy}>完成</button></div>`;
}
function updateManage() {
  const box = $('#bm-manage');
  if (box) { const holder = document.createElement('div'); holder.innerHTML = manageBox(); box.replaceWith(holder.firstElementChild); }
  $('#main').classList.toggle('manage-mode', state.view === 'bookmarks' && state.bmManage);
  $$('.art-card', $('#main')).forEach(card => card.classList.toggle('picked', state.bmPicked.has(card.dataset.id)));
}
function togglePick(work) {
  if (!work?.bookmarkData?.id) return toast('无法读取这部作品的收藏编号，请刷新后重试', true);
  if (state.bmPicked.has(work.id)) state.bmPicked.delete(work.id); else state.bmPicked.set(work.id, work);
  updateManage();
}
async function manageRun(task) {
  state.bmBusy = true; updateManage();
  try { await task(); state.bmPicked.clear(); }
  finally {
    state.bmBusy = false; await load();
    // After a partial failure keep only works that are still in the list.
    for (const id of [...state.bmPicked.keys()]) if (!workById(id)) state.bmPicked.delete(id);
    updateManage();
  }
}

/* ---- Download center ---- */
const statusNames = { queued: '等待中', running: '下载中', completed: '已完成', failed: '失败', cancelled: '已取消', interrupted: '上次运行中断' };
const formatNames = { images: '普通文件', separate: '按作品 ZIP', combined: '合并 ZIP' };
function renderDownloads() {
  const jobs = state.jobs, active = jobs.filter(j => ['queued', 'running'].includes(j.status)).length;
  $('#main').innerHTML = `<div class="section-heading"><h2>下载中心</h2><span class="subtitle">喜欢的作品，正在好好保存</span><div class="heading-right"><button class="secondary" data-action="clear-downloads" ${jobs.some(j => !['queued', 'running'].includes(j.status)) ? '' : 'disabled'}>清除下载记录</button><button class="secondary" data-open-dir="">${icon('folder')}打开下载目录</button></div></div><div class="download-summary"><div class="summary-card"><strong>${active}</strong><span>进行中的任务</span></div><div class="summary-card"><strong>${jobs.filter(j => j.status === 'completed').length}</strong><span>已完成的任务</span></div><div class="summary-card"><strong>${jobs.reduce((a, j) => a + j.done, 0)}</strong><span>已保存的文件组</span></div></div>${jobs.length ? jobs.map(j => `<article class="job"><div class="job-head"><span class="job-icon">${icon(j.format === 'images' ? 'image' : 'archive')}</span><strong class="job-title" translate="no" title="${esc(j.items[0]?.title)}">${esc(j.items[0]?.title || j.items[0]?.id)}${j.items.length > 1 ? ` 等 ${j.items.length} 部作品` : ''}</strong><span class="job-status ${esc(j.status)}">${statusNames[j.status] || esc(j.status)}</span></div><div class="job-body"><p class="job-description">${esc(j.current)}<br>${esc(formatNames[j.format])} · ${esc(j.directory)}</p><div class="progress-track"><progress value="${j.total ? Math.min(100, j.done / j.total * 100) : 0}" max="100" aria-label="下载进度"></progress></div>${j.error ? `<p class="job-error">${esc(j.error)}</p>` : ''}<div class="job-bottom"><span>${j.done} / ${j.total || '…'} · ${(j.bytes / 1048576).toFixed(1)} MB · ${new Date(j.createdAt).toLocaleString(I18N.locale)}</span><div>${['queued', 'running'].includes(j.status) ? `<button class="secondary" data-cancel="${j.id}">取消</button>` : ['failed', 'cancelled', 'interrupted'].includes(j.status) ? `<button class="secondary" data-retry="${j.id}" title="重新下载所选内容；已保存的文件会保留，新文件自动避开重名">重新下载</button>` : ''} <button class="secondary" data-open-dir="${j.id}">打开目录</button></div></div></div></article>`).join('') : empty('还没有下载任务', '切换到下载模式，选择喜欢的作品，再点击右上角的下载按钮。')}`;
}

/* ---- Main area events (delegated, so re-rendering never loses handlers) ---- */
function workById(id) { return state.works.find(w => w.id === id); }
$('#main').addEventListener('click', e => {
  const t = e.target;
  const hit = sel => t.closest(sel);
  let el;
  if ((el = hit('[data-save]'))) return; // handled by the viewer module's global listener
  if ((el = hit('[data-open]'))) {
    const w = workById(el.dataset.open); if (!w) return;
    if (state.view === 'bookmarks' && state.bmManage) return togglePick(w);
    if (state.mode === 'download') return w.masked ? toast('这部作品已被作者删除或设为非公开，无法下载', true) : toggleSelect(w);
    return guarded(() => w.masked ? openArchived(w) : openDetail(w.id))();
  }
  if ((el = hit('[data-artist]'))) return guarded(() => openArtist(el.dataset.artist))();
  if ((el = hit('[data-person]'))) return guarded(() => openArtist(el.dataset.person))();
  if ((el = hit('[data-range-chip]'))) { showDownloadMenu(); return $(`#download-menu [data-range="${CSS.escape(el.dataset.rangeChip)}"]`)?.focus(); }
  if ((el = hit('[data-page]'))) { state.page += Number(el.dataset.page); load(); return window.scrollTo(0, 0); }
  if ((el = hit('[data-rec]'))) { state.recKind = el.dataset.rec; state.page = 1; return load(); }
  if ((el = hit('[data-type]'))) { state.type = el.dataset.type; state.page = 1; return load(); }
  if ((el = hit('[data-interest]'))) return runSearch('tag', el.dataset.interest);
  if ((el = hit('[data-dismiss]'))) return guarded(async () => { await bridge.call('dismiss-recommendation', { id: el.dataset.dismiss }); state.works = state.works.filter(w => w.id !== el.dataset.dismiss); render(); toast('会减少相近 Tag 的推荐'); })();
  if ((el = hit('[data-follow-id]'))) return guarded(() => setFollow(el))();
  if ((el = hit('[data-cancel]'))) return guarded(() => bridge.call('cancel-download', { id: el.dataset.cancel }))();
  if ((el = hit('[data-retry]'))) return guarded(() => bridge.call('retry-download', { id: el.dataset.retry }))();
  if ((el = hit('[data-open-dir]'))) return guarded(() => bridge.call('open-directory', { id: el.dataset.openDir || undefined }))();
  if ((el = hit('[data-action]'))) return guarded(() => action(el.dataset.action))();
});
$('#main').addEventListener('keydown', e => { const cover = e.target.closest('[data-open]'); if (cover && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); cover.click(); } });
$('#main').addEventListener('change', e => {
  const id = e.target.id;
  if (id === 'recommend-r18') {
    if (e.target.checked && !state.account) { e.target.checked = false; return toast('请先登录 Pixiv，再开启 18+ 推荐', true); }
    state.allowR18 = e.target.checked; state.page = 1; return load();
  }
  if (id === 'follow-tag' || id === 'follow-rest') { state[id === 'follow-tag' ? 'followTag' : 'followRest'] = e.target.value; if (id === 'follow-rest') state.followTags = []; state.page = 1; return load(); }
  if (id === 'match' || id === 'sort') { state[id === 'match' ? 'match' : 'order'] = e.target.value; state.page = 1; return load(); }
  if (id === 'bm-rest') { Object.assign(state.bm, { rest: e.target.value, tag: '', bm: '' }); state.page = 1; return load(); }
  if (['bm-order', 'bm-age', 'bm-tag', 'bm-month'].includes(id)) { $('#bookmark-filters').requestSubmit(); }
});
$('#main').addEventListener('submit', e => {
  e.preventDefault();
  if (e.target.id === 'artist-filter') { state.title = $('input', e.target).value; state.page = 1; load(); }
  if (e.target.id === 'bookmark-filters') { state.bm = { rest: $('#bm-rest').value, order: $('#bm-order').value, age: $('#bm-age').value, tag: $('#bm-tag').value, bm: $('#bm-month').value, artworkTag: $('#bm-artwork-tag').value }; state.page = 1; load(); }
});
async function action(name) {
  if (name === 'login') return bridge.call('login');
  if (name === 'retry') return load();
  if (name === 'select-page') { state.works.filter(w => !w.masked).forEach(w => { if (!state.selected.has(w.id)) state.selected.set(w.id, { work: w, range: '', ugoira: 'gif' }); }); return updateSelection(); }
  if (name === 'clear-selection') { state.selected.clear(); closeMenus(); return updateSelection(); }
  if (name === 'official-bookmarks') return bridge.call('open-pixiv', { type: 'bookmarks' });
  if (name === 'clear-history') { await bridge.call('clear-history'); state.page = 1; return load(); }
  if (name === 'clear-downloads') {
    const finished = state.jobs.filter(j => !['queued', 'running'].includes(j.status)).length;
    if (!await confirmAction({ title: '清除下载记录？', message: `将清除 ${finished} 条已结束的下载记录（已完成、失败、已取消）。已经保存的图片和压缩包不会被删除，进行中的任务也不受影响。`, confirm: '清除记录' })) return;
    const { removed } = await bridge.call('clear-downloads');
    return toast(`已清除 ${removed} 条下载记录`);
  }
  if (name === 'bm-manage') { state.bmManage = !state.bmManage; state.bmPicked.clear(); if (state.bmManage) setMode('preview'); return render(); }
  if (name === 'bm-pick-page') { state.works.filter(w => w.bookmarkData?.id).forEach(w => state.bmPicked.set(w.id, w)); return updateManage(); }
  if (name === 'bm-public' || name === 'bm-private') {
    const picked = [...state.bmPicked.values()], privateFlag = name === 'bm-private';
    await manageRun(() => bridge.call('bookmarks-privacy', { bookmarkIds: picked.map(w => w.bookmarkData.id), private: privateFlag }));
    return toast(`已将 ${picked.length} 部作品设为${privateFlag ? '不公开' : '公开'}收藏`);
  }
  if (name === 'bm-remove') {
    const picked = [...state.bmPicked.values()];
    if (!await confirmAction({ title: `取消 ${picked.length} 部作品的收藏？`, message: '这些作品会从你的 Pixiv 收藏中移除，原有的收藏标签也会一并失去。此操作不能撤销。', confirm: '取消收藏' })) return;
    await manageRun(() => bridge.call('bookmarks-remove', { items: picked.map(w => ({ id: w.id, bookmarkId: w.bookmarkData.id })) }));
    return toast(`已取消 ${picked.length} 部作品的收藏`);
  }
  if (name === 'bm-reset') { state.bm = { rest: 'show', tag: '', age: 'all', order: 'newest', artworkTag: '', bm: '' }; state.page = 1; return load(); }
}
