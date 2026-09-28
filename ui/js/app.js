/* Search box, navigation, account display, mascot and start-up. */
$$('[data-icon]').forEach(el => { el.outerHTML = icon(el.dataset.icon); });

function updateAccount() {
  const a = state.account;
  $('#account-name').textContent = a?.name || I18N.tr('尚未登录');
  $('#account-caption').textContent = a ? (a.premium ? 'Pixiv Premium 已连接' : 'Pixiv 账号已连接') : '连接你的 Pixiv 账号';
  $('#account-avatar').textContent = a?.name?.slice(0, 1) || 'P';
  $('#login-top span').textContent = a ? '账号已连接' : '登录 Pixiv';
  $('#connection-label').textContent = a ? '已连接 Pixiv' : '未登录 · 公开浏览';
}

/* ---- Search: Tag / artist UID / artwork PID; links to Pixiv pages are accepted too ---- */
const queryInput = $('#query'), modeSelect = $('#search-mode');
const placeholders = { tag: '搜索标签，发现下一份喜欢…', artist: '输入画师 UID / PID 或画师主页链接', artwork: '输入作品 PID 或作品链接' };
modeSelect.addEventListener('change', () => { queryInput.placeholder = placeholders[modeSelect.value]; hideSuggestions(); queryInput.focus(); });
function runSearch(mode, text) { modeSelect.value = mode; Dropdown.sync(modeSelect); queryInput.value = text; return guarded(search)(); }
async function search() {
  const query = queryInput.value.trim().replace(/\s+/g, ' '), mode = modeSelect.value;
  if (!query) return toast('先输入标签、画师 UID 或作品 PID');
  hideSuggestions();
  if (mode === 'tag') return navigate('search', { query, total: null });
  const match = query.match(/^(?:https:\/\/www\.pixiv\.net\/(?:[a-z-]+\/)?(?:artworks|users)\/)?([1-9]\d{0,15})\/?(?:\?.*)?$/i);
  if (!match) throw new Error('请输入数字 PID / UID，或对应的 Pixiv 作品 / 画师链接');
  return mode === 'artist' ? openArtist(match[1]) : openDetail(match[1]);
}
$('#search-form').addEventListener('submit', e => { e.preventDefault(); guarded(search)(); });

// Tag suggestions replace only the word at the caret, keeping the other AND-search terms.
const suggestionBox = $('#tag-suggestions');
let suggestionRevision = 0, suggestionTimer, suggestions = [], activeSuggestion = -1, composing = false;
function hideSuggestions() { suggestionRevision++; suggestionBox.classList.add('hidden'); queryInput.setAttribute('aria-expanded', 'false'); queryInput.removeAttribute('aria-activedescendant'); activeSuggestion = -1; }
function tokenAtCaret() {
  const value = queryInput.value, caret = queryInput.selectionStart ?? value.length, start = value.slice(0, caret).search(/\S*$/), tail = value.slice(caret).search(/\s/);
  const end = tail < 0 ? value.length : caret + tail; return { start, end, word: value.slice(start, end) };
}
function acceptSuggestion(i) {
  const candidate = suggestions[i]; if (!candidate) return;
  const t = tokenAtCaret(), prefix = t.word.startsWith('-') ? '-' : '', after = queryInput.value.slice(t.end);
  queryInput.value = queryInput.value.slice(0, t.start) + prefix + candidate.tag + (after || ' ');
  hideSuggestions(); queryInput.focus();
  const position = t.start + prefix.length + candidate.tag.length + (after ? 0 : 1); queryInput.setSelectionRange(position, position);
}
async function suggest() {
  const revision = ++suggestionRevision, word = tokenAtCaret().word.replace(/^-/, '');
  if (modeSelect.value !== 'tag' || !word || composing) return hideSuggestions();
  try {
    const list = await bridge.call('suggestions', { keyword: word });
    if (revision !== suggestionRevision || document.activeElement !== queryInput) return;
    suggestions = list; activeSuggestion = -1;
    suggestionBox.innerHTML = list.length ? `<div class="suggestion-hint">选择日语 Tag · 保留其他关键词，空格继续添加</div>${list.map((s, i) => `<button type="button" role="option" translate="no" id="tag-option-${i}" aria-selected="false" data-suggestion="${i}"><strong># ${esc(s.tag)}</strong><small>${esc(s.translation)}</small></button>`).join('')}` : '<div class="suggestion-hint">暂无联想，可直接搜索当前关键词</div>';
  } catch { if (revision !== suggestionRevision) return; suggestionBox.innerHTML = '<div class="suggestion-hint">联想暂不可用，仍可直接搜索</div>'; }
  suggestionBox.classList.remove('hidden'); queryInput.setAttribute('aria-expanded', 'true');
}
suggestionBox.addEventListener('mousedown', e => { const b = e.target.closest('[data-suggestion]'); if (b) { e.preventDefault(); acceptSuggestion(Number(b.dataset.suggestion)); } });
queryInput.addEventListener('compositionstart', () => { composing = true; });
queryInput.addEventListener('compositionend', () => { composing = false; clearTimeout(suggestionTimer); suggestionTimer = setTimeout(suggest, 200); });
queryInput.addEventListener('input', () => { suggestionRevision++; clearTimeout(suggestionTimer); if (!composing) suggestionTimer = setTimeout(suggest, 250); });
queryInput.addEventListener('keydown', e => {
  if (suggestionBox.classList.contains('hidden') || composing) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault(); activeSuggestion = Math.max(0, Math.min(suggestions.length - 1, activeSuggestion + (e.key === 'ArrowDown' ? 1 : -1)));
    $$('[role="option"]', suggestionBox).forEach((b, i) => b.setAttribute('aria-selected', String(i === activeSuggestion)));
    queryInput.setAttribute('aria-activedescendant', `tag-option-${activeSuggestion}`);
  } else if (e.key === 'Enter' && activeSuggestion >= 0) { e.preventDefault(); acceptSuggestion(activeSuggestion); }
  else if (e.key === 'Escape') { e.preventDefault(); hideSuggestions(); }
});

/* ---- Navigation and toolbar ---- */
$$('.nav-item[data-nav]').forEach(button => button.addEventListener('click', () => {
  if (button.dataset.nav === 'downloads') { state.revision++; closeViewer(); state.view = 'downloads'; closeMenus(); return render(); }
  navigate(button.dataset.nav);
}));
$('#brand-home').addEventListener('click', e => { e.preventDefault(); navigate('recommend'); });
$('#nav-settings').addEventListener('click', guarded(settingsDialog));
$('#account-button').addEventListener('click', guarded(settingsDialog));
$('#login-top').addEventListener('click', guarded(() => state.account ? settingsDialog() : bridge.call('login')));
$('#mode-preview').addEventListener('click', () => setMode('preview'));
$('#mode-download').addEventListener('click', () => setMode('download'));
$('#download-button').addEventListener('click', () => $('#download-menu').classList.contains('hidden') ? showDownloadMenu() : closeMenus());
$('#refresh').addEventListener('click', guarded(async () => { if (state.busy) return; if (state.view === 'downloads') return render(); await bridge.call('refresh-library'); load(true); }));
document.addEventListener('click', e => {
  if (!e.target.closest('.download-anchor, .viewer-download, [data-range-chip], .dropdown-menu')) closeMenus();
  if (!e.target.closest('#search-form')) hideSuggestions();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeMenus();
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); queryInput.focus(); }
});
// Broken or blocked previews fall back to a local placeholder.
document.addEventListener('error', e => { if (e.target instanceof HTMLImageElement && !e.target.src.endsWith('/unavailable.svg')) { e.target.src = 'assets/unavailable.svg'; e.target.title = '预览暂不可用，请检查网络、登录状态或图片线路'; } }, true);

/* ---- Mascot ---- */
const mascotLines = ['今天，也一起发现喜欢的作品。', '遇见喜欢的画，就点亮爱心吧。', '再点一次爱心，就能取消收藏哦。', '看完一张，往下滑还有相关作品～', '动图也能看、也能存成 GIF 啦！', '慢慢看，我在这里陪你。'];
let mascotLine = 0, mascotTimer;
$('#mascot').addEventListener('click', () => {
  const mascot = $('#mascot');
  mascot.classList.remove('greet'); void mascot.offsetWidth; mascot.classList.add('greet');
  $('#mascot-message').textContent = mascotLines[++mascotLine % mascotLines.length];
  clearTimeout(mascotTimer); mascotTimer = setTimeout(() => mascot.classList.remove('greet'), 1400);
});

/* ---- Events from the main process and start-up ---- */
bridge.on('notice', message => toast(message, true));
bridge.on('downloads-changed', jobs => { state.jobs = jobs; $('#queue-count').textContent = jobs.filter(j => ['queued', 'running'].includes(j.status)).length; if (state.view === 'downloads') render(); });
bridge.on('account-changed', account => {
  const previous = state.account?.id; state.account = account; updateAccount();
  if ((account?.id || null) === (previous || null)) return;
  // Everything tied to the previous account is dropped, including when switching straight to another account.
  Object.assign(state, { allowR18: false, interests: [], bmTags: { public: [], private: [] }, bmPeriods: [], followTags: [], followTag: '' });
  state.selected.clear();
  if (account) toast(`已连接 ${account.name} 的 Pixiv 账号`);
  navigate('recommend');
});
(async function boot() {
  try {
    const data = await bridge.call('init');
    Object.assign(state, { settings: data.settings, jobs: data.jobs, version: data.version });
    applyTheme(data.dark);
    $('#queue-count').textContent = data.jobs.filter(j => ['running', 'queued'].includes(j.status)).length;
    $('#app-version').textContent = `澄阅 ${data.version.replace(/\.0$/, '')}`;
  } catch (e) { toast(e.message, true); }
  // Resolve an existing session first, so private bookmark state is respected by recommendations.
  state.busy = true; render();
  try { state.account = await bridge.call('account-status'); } catch (e) { toast(e.message, true); }
  updateAccount(); load();
})();
