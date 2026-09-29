/* Preferences, theme and the close-button prompt. */
function applyTheme(systemDark) {
  const theme = state.settings.theme;
  document.documentElement.dataset.theme = theme === 'dark' || (theme === 'system' && systemDark) ? 'dark' : 'light';
}
bridge.on('theme-changed', applyTheme);

const imageRoutes = [
  ['official', '官方线路', '直接连接 i.pximg.net，需要网络能访问 Pixiv'],
  ['auto', '自动切换（推荐）', '优先官方线路；连接失败时自动改用镜像'],
  ['mirror', '始终使用镜像', '图片全部经镜像加载，可不依赖代理看图']
];
function settingsHtml() {
  const s = state.settings, a = state.account;
  return `<div class="dialog-heading"><h2>偏好设置</h2><button class="icon-button" data-dialog-close aria-label="关闭设置">${icon('close')}</button></div>
  <section class="setting-section"><h3>我的 Pixiv 账号</h3><p>${a ? `${esc(a.name)} · UID ${esc(a.id)} · ${a.premium ? 'Premium 会员' : '普通账号'}` : '在独立的 Pixiv 官方登录窗口完成登录；登录状态保留在这台电脑上。软件不收集或保存账号密码。'}</p><div class="dialog-actions"><button class="primary" data-set="login">${a ? '打开 Pixiv 登录窗口' : '登录 Pixiv'}</button><button class="secondary" data-set="refresh-account">刷新登录状态</button>${a ? '<button class="secondary" data-set="logout">退出登录</button>' : ''}</div></section>
  <section class="setting-section"><h3>外观与关闭行为</h3><div class="filter-row">${selectField('theme-setting', '界面主题', [['light', '浅色'], ['dark', '深色'], ['system', '跟随系统']], s.theme || 'light')}${selectField('language-setting', '界面语言', [['system', '跟随系统'], ['zh', '简体中文'], ['en', 'English']], s.language || 'system')}${selectField('close-setting', '点击关闭按钮时', [['ask', '每次询问'], ['exit', '直接退出软件'], ['tray', MAC ? '关闭窗口，在后台运行' : '最小化到系统托盘']], s.closeBehavior || 'ask')}</div><p>${MAC ? '后台运行会保留下载与本次浏览历史；点击程序坞中的图标即可恢复窗口，按 ⌘Q 真正退出。' : '托盘模式会保留下载与本次浏览历史；右键托盘图标可以真正退出。'}</p></section>
  <section class="setting-section"><h3>下载保存位置</h3><p>${esc(s.downloadDir)}</p><button class="secondary" data-set="directory">${icon('folder')}选择文件夹</button><p>ZIP 默认名称为“作品名称_作者名字”。同名文件自动编号，不覆盖已有文件。动图可保存为 GIF，或原始帧加帧时长文件。</p></section>
  <section class="setting-section"><h3>网络代理</h3><p>默认使用系统代理。若无法连接 Pixiv，可填写本机已有代理地址。</p><form id="proxy-form" class="dialog-actions"><input class="text-input" aria-label="代理地址" placeholder="http://127.0.0.1:7890" value="${esc(s.proxy)}"><button type="submit" class="secondary">保存</button></form></section>
  <section class="setting-section"><h3>图片线路 · 镜像加速</h3><p>作品图片与原图下载可以改走公共镜像（例如 i.pixiv.re，它转发 i.pximg.net 的公开图片）。镜像只经手图片地址，不会收到你的账号或 Cookie；登录、搜索、收藏与关注仍直接连接 www.pixiv.net。</p><div class="choice-grid three">${imageRoutes.map(([value, title, note]) => `<label class="choice-card"><input type="radio" name="image-mode" value="${value}" ${value === (s.imageMode || 'official') ? 'checked' : ''}><span><strong>${title}</strong><small>${note}</small></span></label>`).join('')}</div><form id="mirror-form" class="dialog-actions"><input class="text-input" id="mirror-host" aria-label="镜像域名" value="${esc(s.imageMirror || 'i.pixiv.re')}" placeholder="i.pixiv.re" maxlength="100"><button type="submit" class="secondary">保存镜像</button><button type="button" class="secondary" data-set="test-mirror">测试线路</button></form><p id="mirror-result" class="route-result" aria-live="polite"></p><p class="help-text">登录后关闭代理时，图片可由镜像加载；作品信息、搜索和收藏是否可用，取决于当前网络能否直连 www.pixiv.net。</p></section>
  <section class="setting-section"><h3>推荐偏好与隐私</h3><p>浏览记录只在本次运行的内存中保留。推荐会在本机按账号保存汇总的 Tag 偏好，不保存浏览作品清单；随时可重置。</p><div class="dialog-actions"><button class="secondary" data-set="reset-taste">重置 Tag 偏好</button></div></section>
  <section class="setting-section"><h3>收藏存档</h3><p>在软件中浏览过的收藏作品，会在本机记录标题、画师、标签和一张小缩略图。之后即使作者删除或隐藏了作品，「我的收藏」里仍能看到它原来是什么。存档只保存在这台电脑上，不会上传。</p>${switchField('archive-setting', '自动存档浏览过的收藏', s.archiveBookmarks !== false)}<p class="help-text" id="archive-stats">${a ? '正在统计…' : '登录后按账号分别存档。'}</p>${a ? '<div class="dialog-actions"><button class="secondary danger" data-set="clear-archive">清空本账号存档</button></div>' : ''}</section>
  <section class="setting-section"><h3>错误日志</h3><p>出现问题时，软件会把错误写入本机日志（最多约 2 MB，自动轮换）。日志不包含密码、Cookie 或操作令牌，可在反馈问题时附上。</p><div class="dialog-actions"><button class="secondary" data-set="open-logs">${icon('folder')}打开日志文件夹</button></div></section>
  <section class="setting-section"><h3>关于澄阅 · ${esc(state.version || '')}</h3><p>独立的 Pixiv 轻阅览与下载工具。支持插画、漫画原图与动图；暂不支持小说及自动断点续传。仅下载账号有权访问的作品，尊重画师的使用约定。</p><div class="dialog-actions"><button class="secondary" data-set="quit">${icon('power')}退出软件</button></div></section>`;
}
async function settingsDialog() {
  const dialog = $('#settings-dialog'), scroll = dialog.open ? dialog.scrollTop : 0;
  openDialog(dialog, settingsHtml());
  dialog.scrollTop = scroll;
  if (state.account) bridge.call('archive-stats').then(({ count, bytes }) => { const el = $('#archive-stats'); if (el) el.textContent = `已存档 ${count} 部作品 · 占用 ${(bytes / 1048576).toFixed(1)} MB`; }).catch(() => {});
}
const settingActions = {
  login: () => bridge.call('login'),
  async 'refresh-account'() {
    state.account = await bridge.call('account-status'); updateAccount(); settingsDialog();
    if (state.account) { toast('登录状态已更新'); navigate('recommend'); } else toast('尚未登录，请在官方登录窗口完成登录');
  },
  async logout() {
    await bridge.call('logout'); state.account = null; state.selected.clear(); updateAccount(); settingsDialog(); navigate('recommend');
  },
  async directory() { state.settings = await bridge.call('choose-directory'); settingsDialog(); },
  async 'reset-taste'() { await bridge.call('clear-interests'); state.interests = []; toast('已重置本机 Tag 推荐偏好'); },
  'open-logs': () => bridge.call('open-logs'),
  async 'clear-archive'() {
    if (!await confirmAction({ title: '清空收藏存档？', message: '将删除本账号在这台电脑上的全部收藏存档（标题、标签与缩略图）。已被作者删除的作品将无法再显示原来的信息。Pixiv 上的收藏不受影响。', confirm: '清空存档' })) return;
    await bridge.call('archive-clear'); toast('已清空本账号的收藏存档'); settingsDialog();
  },
  quit: () => bridge.call('quit'),
  async 'test-mirror'() {
    const button = $('[data-set="test-mirror"]'), result = $('#mirror-result');
    button.disabled = true; result.textContent = '正在测试…';
    try { result.innerHTML = (await bridge.call('test-image-mirror', { host: $('#mirror-host').value })).map(r => `<span class="${r.ok ? 'ok' : 'bad'}">${esc(r.host)} · ${r.ok ? `${r.ms} ms` : esc(r.error || `HTTP ${r.status}`)}</span>`).join(''); }
    finally { button.disabled = false; }
  }
};
async function saveRoute(mode, host) {
  state.settings = await bridge.call('save-image-mirror', { mode, host });
  toast(mode === 'official' ? '已切换到官方图片线路' : mode === 'auto' ? `图片线路：官方优先，失败时改用 ${state.settings.imageMirror}` : `图片将通过 ${state.settings.imageMirror} 加载`);
}
const settingsEl = $('#settings-dialog');
dismissOnBackdrop(settingsEl);
// macOS: the app menu's Settings… item (⌘,).
bridge.on('open-settings', () => guarded(settingsDialog)());
settingsEl.addEventListener('click', e => {
  if (e.target.closest('[data-dialog-close]')) return settingsEl.close();
  const button = e.target.closest('[data-set]'); if (button) guarded(settingActions[button.dataset.set])();
});
settingsEl.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'theme-setting') guarded(async () => { state.settings = await bridge.call('save-settings', { theme: t.value }); applyTheme((await bridge.call('init')).dark); })();
  if (t.id === 'language-setting') guarded(async () => { state.settings = await bridge.call('save-settings', { language: t.value }); })();
  if (t.id === 'close-setting') guarded(async () => { state.settings = await bridge.call('save-settings', { closeBehavior: t.value }); toast('关闭方式已保存'); })();
  if (t.id === 'archive-setting') guarded(async () => { state.settings = await bridge.call('save-settings', { archiveBookmarks: t.checked }); toast(t.checked ? '已开启收藏存档' : '已关闭收藏存档，已有存档会保留'); })();
  if (t.name === 'image-mode') guarded(() => saveRoute(t.value, $('#mirror-host').value))();
});
settingsEl.addEventListener('submit', e => {
  e.preventDefault();
  if (e.target.id === 'proxy-form') guarded(async () => { state.settings = await bridge.call('save-proxy', { proxy: $('input', e.target).value }); toast('代理设置已保存'); })();
  if (e.target.id === 'mirror-form') guarded(() => saveRoute($('[name="image-mode"]:checked', settingsEl).value, $('#mirror-host').value))();
});

/* The window's close button asks whether to exit or keep running in the tray (the Dock on macOS). */
const closeEl = $('#close-dialog');
bridge.on('close-requested', () => {
  openDialog(closeEl, `<div class="dialog-heading"><h2>关闭澄阅</h2><button class="icon-button" data-close-cancel aria-label="取消">${icon('close')}</button></div><p class="help-text">${MAC ? '要退出软件，还是关闭窗口在后台继续运行？后台运行会保留下载任务与本次浏览历史。' : '要退出软件，还是最小化到系统托盘继续运行？托盘模式会保留下载任务与本次浏览历史。'}</p><div class="choice-grid"><button class="choice-card action" data-close-action="tray"><span>${icon('minimize')}<strong>${MAC ? '在后台运行' : '最小化到托盘'}</strong><small>${MAC ? '点击程序坞图标可恢复窗口' : '双击托盘图标可恢复窗口'}</small></span></button><button class="choice-card action" data-close-action="exit"><span>${icon('power')}<strong>退出软件</strong><small>正在进行的下载会被取消</small></span></button></div><label class="check-row"><input type="checkbox" id="close-remember">不再显示此窗口（可在偏好设置中更改）</label>`);
  $('[data-close-action="tray"]', closeEl).focus();
});
closeEl.addEventListener('click', e => {
  if (e.target.closest('[data-close-cancel]')) return closeEl.close();
  const button = e.target.closest('[data-close-action]'); if (!button) return;
  const remember = $('#close-remember').checked;
  closeEl.close();
  guarded(async () => { state.settings = await bridge.call('close-choice', { action: button.dataset.closeAction, remember }); })();
});
dismissOnBackdrop(closeEl);
