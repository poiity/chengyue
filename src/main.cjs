// Electron main process: windows, Pixiv session, IPC surface and local data.
const { app, BrowserWindow, ipcMain, session, protocol, dialog, shell, Tray, Menu, nativeTheme, nativeImage, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { PixivClient } = require('./pixiv.cjs');
const { DownloadManager } = require('./downloads.cjs');
const { imageUrl, validateId, mirrorHost } = require('./core.cjs');
const { Library } = require('./library.cjs');
const { TasteMemory, Recommendations } = require('./recommend.cjs');
const { Logger } = require('./log.cjs');
const { Archive } = require('./archive.cjs');

protocol.registerSchemesAsPrivileged([{ scheme: 'pixiv-image', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
app.setName('PixivLight');
if (process.env.PIXIV_LIGHT_HIDDEN) app.disableHardwareAcceleration();
if (process.env.PIXIV_LIGHT_TEST_DATA) app.setPath('userData', process.env.PIXIV_LIGHT_TEST_DATA);
// One running copy only: two instances would write the same session, settings and download history.
if (!process.env.PIXIV_LIGHT_HIDDEN && !app.requestSingleInstanceLock()) app.exit(0);

const PARTITION = 'persist:pixiv-light-account';
const MAC = process.platform === 'darwin';
const uiFile = path.join(__dirname, '..', 'ui', 'index.html');
const uiUrl = pathToFileURL(uiFile).href;
const logger = new Logger(path.join(app.getPath('userData'), 'logs'));
let mainWindow, loginWindow, tray, client, downloads, library, memory, recommendations, archive, settings, dataDir;
let quitRequested = false;
// Interface language: "system" follows the system display language (Chinese or English).
const NATIVE = {
  zh: {
    title: '澄阅 · Pixiv Light', open: '打开澄阅', quit: '退出澄阅', folder: '选择图片与 ZIP 保存目录', login: '登录 Pixiv · 官方网站', failed: '澄阅启动失败',
    about: '关于澄阅', settings: '偏好设置…', hide: '隐藏澄阅', hideOthers: '隐藏其他', showAll: '全部显示',
    edit: '编辑', undo: '撤销', redo: '重做', cut: '剪切', copy: '拷贝', paste: '粘贴', pasteAndMatchStyle: '粘贴并匹配样式', delete: '删除', selectAll: '全选',
    view: '显示', resetZoom: '实际大小', zoomIn: '放大', zoomOut: '缩小', fullscreen: '进入全屏幕',
    window: '窗口', minimize: '最小化', zoom: '缩放', close: '关闭窗口', front: '前置全部窗口'
  },
  en: {
    title: 'Chengyue · Pixiv Light', open: 'Open Chengyue', quit: 'Quit Chengyue', folder: 'Choose a folder for images and ZIP files', login: 'Sign in to Pixiv · official site', failed: 'Chengyue failed to start',
    about: 'About Chengyue', settings: 'Settings…', hide: 'Hide Chengyue', hideOthers: 'Hide Others', showAll: 'Show All',
    edit: 'Edit', undo: 'Undo', redo: 'Redo', cut: 'Cut', copy: 'Copy', paste: 'Paste', pasteAndMatchStyle: 'Paste and Match Style', delete: 'Delete', selectAll: 'Select All',
    view: 'View', resetZoom: 'Actual Size', zoomIn: 'Zoom In', zoomOut: 'Zoom Out', fullscreen: 'Toggle Full Screen',
    window: 'Window', minimize: 'Minimize', zoom: 'Zoom', close: 'Close Window', front: 'Bring All to Front'
  }
};
function language() {
  if (settings?.language === 'zh' || settings?.language === 'en') return settings.language;
  const preferred = (app.getPreferredSystemLanguages?.()[0] || app.getLocale() || '').toLowerCase();
  return preferred.startsWith('zh') ? 'zh' : 'en';
}
const native = key => NATIVE[language()][key];

process.on('uncaughtException', e => logger.error('main', e));
process.on('unhandledRejection', e => logger.error('main', e instanceof Error ? e : new Error(String(e))));

function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8')); } catch { return fallback; } }
function writeJson(file, value) {
  fs.mkdirSync(dataDir, { recursive: true });
  const target = path.join(dataDir, file);
  fs.writeFileSync(target + '.tmp', JSON.stringify(value, null, 2)); fs.renameSync(target + '.tmp', target);
}
function send(channel, value) { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, value); }
// Every IPC call must come from the app's own page in the main window.
function handle(name, fn) {
  ipcMain.handle(name, async (event, arg) => {
    if (event.sender !== mainWindow?.webContents || event.senderFrame?.url !== uiUrl) { logger.warn('ipc', `拒绝来自其他页面的调用：${name}`); return { ok: false, error: '不可信的调用来源' }; }
    try { return { ok: true, data: await fn(arg ?? {}) }; }
    catch (e) { logger.warn(`ipc:${name}`, e); return { ok: false, error: e.message || '操作失败' }; }
  });
}
async function applyProxy() {
  await client.session.setProxy(settings.proxy ? { proxyRules: settings.proxy, proxyBypassRules: '<local>' } : { mode: 'system' });
  await client.session.closeAllConnections();
}

// ---- Pixiv login window and page probe -------------------------------------------------------
const pageOptions = () => ({ nodeIntegration: false, contextIsolation: true, sandbox: true, partition: PARTITION });
const onPixivHome = url => { try { return new URL(url).origin === 'https://www.pixiv.net'; } catch { return false; } };
// Only the account bootstrap data is read from the page; nothing else leaves it.
const SNAPSHOT_JS = `(() => { const parts = [...document.querySelectorAll('meta[name="global-data"],meta#meta-global-data')].map(m => m.outerHTML);
  const next = document.getElementById('__NEXT_DATA__'); if (next) parts.push(next.outerHTML);
  return { url: location.href, html: parts.join('\\n') }; })()`;
// An isolated world shares the DOM but not the page's scripts, so the page cannot alter what is read.
function snapshot(win) { return win.webContents.executeJavaScriptInIsolatedWorld(1001, [{ code: SNAPSHOT_JS }], true); }
function aborted(error) { return error?.code === 'ERR_ABORTED' || error?.errno === -3 || /ERR_ABORTED/.test(error?.message || ''); }
function secure(win) {
  win.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('https://')) event.preventDefault(); });
  win.webContents.setWindowOpenHandler(({ url }) => ({ action: url.startsWith('https://') ? 'allow' : 'deny', overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: pageOptions() } }));
  win.webContents.on('did-create-window', secure);
}
// Loads Pixiv in a hidden page on the account session and reads the signed-in user from it.
// Used when plain requests cannot confirm the login (for example a VPN exit that receives a browser check).
let probing = null;
function probePixivPage() {
  if (loginWindow && !loginWindow.isDestroyed() && onPixivHome(loginWindow.webContents.getURL()) && !loginWindow.webContents.isLoading()) return snapshot(loginWindow);
  if (probing) return probing;
  probing = (async () => {
    const win = new BrowserWindow({ show: false, webPreferences: { ...pageOptions(), images: false, backgroundThrottling: false } });
    secure(win); win.webContents.setAudioMuted(true);
    try {
      const settled = new Promise(resolve => win.webContents.once('did-stop-loading', resolve));
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('读取 Pixiv 页面超时')), 25000));
      await Promise.race([win.loadURL('https://www.pixiv.net/').catch(e => { if (!aborted(e)) throw e; return settled; }), timeout]);
      if (win.webContents.isLoading()) await Promise.race([settled, timeout]);
      if (!onPixivHome(win.webContents.getURL())) throw new Error('Pixiv 页面需要验证');
      return await snapshot(win);
    } finally { win.destroy(); probing = null; }
  })();
  return probing;
}
function login() {
  if (loginWindow && !loginWindow.isDestroyed()) { loginWindow.show(); loginWindow.focus(); return; }
  loginWindow = new BrowserWindow({ width: 1050, height: 800, title: native('login'), autoHideMenuBar: true, webPreferences: pageOptions() });
  secure(loginWindow);
  const win = loginWindow, contents = loginWindow.webContents;
  let checking = false, done = false;
  const confirmed = account => {
    if (done || !account) return;
    done = true; send('account-changed', account); logger.info('login', '已确认登录');
    // Give the page a moment to show Pixiv's own signed-in state, then return to the app.
    setTimeout(() => { if (!win.isDestroyed()) win.close(); mainWindow?.show(); mainWindow?.focus(); }, 1200);
  };
  const check = async () => {
    if (checking || done || win.isDestroyed()) return;
    checking = true;
    try {
      let account = null;
      // Reading the signed-in page directly works even when background requests are challenged.
      if (onPixivHome(contents.getURL()) && !contents.isLoading()) account = client.adoptPage((await snapshot(win)).html);
      if (!account) account = await client.status({ probe: false });
      confirmed(account);
    } catch {} finally { checking = false; }
  };
  contents.on('did-finish-load', check);
  contents.on('did-navigate-in-page', check);
  // Redirects and page scripts cancel the first navigation (ERR_ABORTED); only real failures are reported.
  contents.on('did-fail-load', (_e, code, description, _url, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    logger.warn('login', `登录页面加载失败：${description || code}`);
    send('notice', `登录页面加载失败（${description || code}）。请确认 VPN / 代理已开启，或在偏好设置中填写代理地址后重试`);
  });
  const timer = setInterval(check, 4000);
  win.on('closed', async () => {
    clearInterval(timer); if (loginWindow === win) loginWindow = null;
    if (done) return;
    try { const account = await client.status(); if (account) send('account-changed', account); }
    catch (e) { logger.warn('login', e); send('notice', `未能确认登录：${e.message}`); }
  });
  win.loadURL('https://accounts.pixiv.net/login?return_to=https%3A%2F%2Fwww.pixiv.net%2F').catch(e => { if (!aborted(e)) logger.warn('login', e); });
}

// ---- Window, tray and close behaviour -----------------------------------------------------------
function restore() { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); }
function quit() { quitRequested = true; app.quit(); }
// Windows keeps running in the tray; macOS keeps running in the Dock, where clicking the icon reopens the window.
const canRunInBackground = () => MAC || !!tray;
function createTray() {
  if (MAC) return;
  try {
    tray = new Tray(path.join(__dirname, '..', 'ui', 'assets', 'app.png'));
    tray.on('double-click', restore);
    localizeTray();
  } catch (e) { logger.warn('tray', e); tray = null; }
}
function localizeTray() {
  if (!tray) return;
  tray.setToolTip(native('title'));
  tray.setContextMenu(Menu.buildFromTemplate([{ label: native('open'), click: restore }, { type: 'separator' }, { label: native('quit'), click: quit }]));
}
function localizeNative() { localizeTray(); if (MAC) Menu.setApplicationMenu(appMenu()); }
// The macOS menu bar: standard app, edit (clipboard shortcuts in text fields need it), view and window menus.
function appMenu() {
  const item = (role, extra) => ({ role, label: native(role), ...extra });
  return Menu.buildFromTemplate([
    { label: app.name, submenu: [
      item('about'), { type: 'separator' },
      { label: native('settings'), accelerator: 'Command+,', click: () => { restore(); send('open-settings'); } }, { type: 'separator' },
      item('hide'), item('hideOthers'), item('unhide', { label: native('showAll') }), { type: 'separator' },
      { label: native('quit'), accelerator: 'Command+Q', click: quit }
    ] },
    { label: native('edit'), submenu: ['undo', 'redo', 'separator', 'cut', 'copy', 'paste', 'pasteAndMatchStyle', 'delete', 'selectAll'].map(role => role === 'separator' ? { type: role } : item(role)) },
    { label: native('view'), submenu: [item('resetZoom'), item('zoomIn'), item('zoomOut'), { type: 'separator' }, item('togglefullscreen', { label: native('fullscreen') })] },
    { label: native('window'), role: 'windowMenu', submenu: [item('minimize'), item('zoom'), item('close'), { type: 'separator' }, item('front')] }
  ]);
}
function hideWindow() {
  // A full-screen window hidden directly would leave an empty black Space behind on macOS.
  if (MAC && mainWindow.isFullScreen()) { mainWindow.once('leave-full-screen', () => mainWindow.hide()); mainWindow.setFullScreen(false); }
  else mainWindow.hide();
}
function closeTo(action) { if (action === 'tray' && canRunInBackground()) hideWindow(); else quit(); }
function createWindow() {
  // Smaller screens (a 13-inch laptop) open a window that still fits the work area.
  const area = screen.getPrimaryDisplay().workAreaSize;
  mainWindow = new BrowserWindow({
    width: Math.max(980, Math.min(1440, area.width - 40)), height: Math.max(680, Math.min(960, area.height - 40)), minWidth: 980, minHeight: 680,
    show: !process.env.PIXIV_LIGHT_HIDDEN, title: native('title'), backgroundColor: '#f5f8fd', autoHideMenuBar: true,
    // macOS: the page draws up to the top edge and the traffic lights sit over the sidebar.
    ...(MAC ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 20, y: 20 } } : {}),
    webPreferences: { offscreen: !!process.env.PIXIV_LIGHT_HIDDEN, backgroundThrottling: !process.env.PIXIV_LIGHT_HIDDEN, preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => { if (url !== uiUrl) event.preventDefault(); });
  mainWindow.on('page-title-updated', event => { event.preventDefault(); mainWindow.setTitle(native('title')); });
  mainWindow.webContents.on('render-process-gone', (_e, details) => logger.error('renderer', `界面进程退出：${details.reason}`));
  let unresponsive = false;
  mainWindow.on('unresponsive', () => { unresponsive = true; logger.warn('renderer', '界面无响应'); });
  mainWindow.on('responsive', () => { unresponsive = false; });
  // The close button asks "exit or tray?" unless the user chose to remember an answer.
  mainWindow.on('close', event => {
    if (quitRequested || !canRunInBackground()) return;
    const behaviour = settings.closeBehavior;
    if (behaviour === 'exit' || unresponsive || mainWindow.webContents.isCrashed()) { quitRequested = true; return; }
    event.preventDefault();
    if (behaviour === 'tray') return closeTo('tray');
    restore(); send('close-requested');
  });
  return mainWindow.loadFile(uiFile);
}

// ---- Startup -----------------------------------------------------------------------------------
app.on('second-instance', () => { if (mainWindow) restore(); });
// macOS: clicking the Dock icon brings back a window that was closed to the background.
app.on('activate', () => { if (mainWindow && !mainWindow.isDestroyed()) restore(); });
// The page asks for its language synchronously before anything is drawn, so English never flashes Chinese first.
ipcMain.on('language', event => { event.returnValue = event.sender === mainWindow?.webContents ? language() : 'zh'; });
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', event => event.preventDefault());
});
app.whenReady().then(async () => {
  dataDir = app.getPath('userData');
  settings = { downloadDir: path.join(app.getPath('downloads'), 'PixivLight'), proxy: '', theme: 'light', closeBehavior: 'ask', imageMode: 'official', imageMirror: 'i.pixiv.re', archiveBookmarks: true, language: 'system', ...readJson('settings.json', {}) };
  if (!['system', 'zh', 'en'].includes(settings.language)) settings.language = 'system';
  delete settings.closeAction; // replaced by closeBehavior (ask / exit / tray)
  if (!['ask', 'exit', 'tray'].includes(settings.closeBehavior)) settings.closeBehavior = 'ask';
  logger.info('app', `启动 ${app.getVersion()}`);

  const pixivSession = session.fromPartition(PARTITION);
  pixivSession.setUserAgent(pixivSession.getUserAgent().replace(/\s(?:Electron|pixiv-light|PixivLight)\/\S+/gi, ''));
  for (const s of [pixivSession, session.defaultSession]) { s.setPermissionRequestHandler((_wc, _p, callback) => callback(false)); s.setPermissionCheckHandler(() => false); }
  client = new PixivClient(pixivSession);
  memory = new TasteMemory(path.join(dataDir, 'tag-interests.json'));
  const dates = readJson('bookmark-dates.json', {});
  archive = new Archive(path.join(dataDir, 'archive'), client);
  archive.enabled = settings.archiveBookmarks !== false;
  library = new Library(client, dates, value => writeJson('bookmark-dates.json', value), { archive, months: readJson('bookmark-months.json', {}), saveMonths: value => writeJson('bookmark-months.json', value) });
  recommendations = new Recommendations(client, memory);
  nativeTheme.themeSource = ['light', 'dark', 'system'].includes(settings.theme) ? settings.theme : 'light';
  client.onAccountChange = (old, id) => { memory.switchAccount(id); if (old !== id) { library.clear(); recommendations.clear(); client.artistCache.clear(); } };
  client.probe = probePixivPage; client.lang = language();
  try { client.setImageMirror({ mode: settings.imageMode, host: settings.imageMirror }); } catch { settings.imageMode = 'official'; settings.imageMirror = 'i.pixiv.re'; }
  await applyProxy();
  // Pixiv images are fetched with the right referer by the main process; the page only sees this scheme.
  session.defaultSession.protocol.handle('pixiv-image', async request => {
    try {
      const requested = new URL(request.url);
      // Locally archived thumbnails of bookmarks that were later deleted or hidden.
      if (requested.hostname === 'archive') {
        const file = client.account && archive.thumbnail(client.account.id, requested.searchParams.get('id'));
        if (!file) return new Response('', { status: 404 });
        return new Response(await fs.promises.readFile(file), { headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=3600' } });
      }
      const url = imageUrl(requested.searchParams.get('url'));
      const response = await client.fetch(url, { image: true, signal: request.signal });
      return new Response(response.body, { status: 200, headers: { 'content-type': response.headers.get('content-type'), 'cache-control': 'private, max-age=3600' } });
    } catch (e) { if (!request.signal?.aborted) logger.warn('image', e); return new Response('', { status: 502 }); }
  });
  downloads = new DownloadManager(client, path.join(dataDir, 'downloads.json'), {
    decodeImage: data => {
      const image = nativeImage.createFromBuffer(Buffer.from(data));
      if (image.isEmpty()) throw new Error('动图帧无法解码');
      const { width, height } = image.getSize();
      return { bgra: image.toBitmap(), width, height };
    }
  });
  downloads.on('change', jobs => send('downloads-changed', jobs));
  downloads.on('failure', e => logger.warn('download', e));
  registerIpc(pixivSession);
  createTray();
  if (MAC) {
    Menu.setApplicationMenu(appMenu());
    app.setAboutPanelOptions({ applicationName: native('title'), applicationVersion: app.getVersion(), version: '', copyright: 'MIT License' });
    // The packaged app carries its own icon; a development run borrows it for the Dock.
    if (!app.isPackaged) { const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.png')); if (!icon.isEmpty()) app.dock.setIcon(icon); }
  }
  nativeTheme.on('updated', () => send('theme-changed', nativeTheme.shouldUseDarkColors));
  await createWindow();
  // Packaging smoke test: capture the first screen offscreen and exit.
  if (process.env.PIXIV_LIGHT_SCREENSHOT) setTimeout(async () => { fs.writeFileSync(process.env.PIXIV_LIGHT_SCREENSHOT, (await mainWindow.webContents.capturePage()).toPNG()); app.exit(0); }, 2500);
}).catch(e => { logger.error('startup', e); dialog.showErrorBox(native('failed'), e.message); app.exit(1); });

function registerIpc(pixivSession) {
  const page = p => Math.max(1, Math.min(10000, Math.floor(Number(p) || 1)));
  const saveSettings = () => { writeJson('settings.json', settings); return settings; };
  const changed = value => { recommendations.clear(); return value; };
  handle('init', () => ({ settings, jobs: downloads.snapshot(), version: app.getVersion(), dark: nativeTheme.shouldUseDarkColors, tray: canRunInBackground(), language: language() }));
  handle('account-status', () => client.status());
  handle('login', login);
  handle('logout', async () => {
    if (downloads.snapshot().some(j => ['queued', 'running'].includes(j.status))) throw new Error('请先完成或取消下载队列，再退出账号');
    if (loginWindow && !loginWindow.isDestroyed()) loginWindow.close();
    await pixivSession.clearStorageData(); await pixivSession.clearCache();
    client.setAccount(null); send('account-changed', null);
  });
  handle('feed', args => client.feed(page(args.page)));
  handle('search', args => client.search({ ...args, page: page(args.page) }));
  handle('artist', args => client.artist(args.id, page(args.page), String(args.title || '').slice(0, 100)));
  handle('detail', async args => {
    const work = await client.detail(args.id); memory.record(work);
    if (work.bookmarkData && client.account) { archive.remember(client.account.id, [work]); archive.fetchThumbs(client.account.id, [work]); }
    return work;
  });
  // Viewer frames use the 600px archive; downloads use the original size.
  handle('ugoira', args => client.ugoiraFrames(args.id));
  handle('related', args => client.related(args.id, args.ids));
  handle('suggestions', args => library.suggestions(args.keyword));
  handle('following', args => library.following({ ...args, page: page(args.page) }));
  handle('following-works', args => library.followingWorks({ ...args, page: page(args.page) }));
  handle('bookmarks', args => library.bookmarks({ ...args, page: page(args.page) }));
  handle('bookmark-tags', () => library.bookmarkTags());
  handle('bookmark-periods', args => library.bookmarkPeriods(args));
  handle('bookmark-months-sync', args => library.syncBookmarkMonths(args));
  handle('bookmark-state', args => library.bookmarkState(args.id));
  handle('bookmark-quick', async args => changed(await library.quickBookmark(args.id)));
  handle('bookmark-privacy', async args => changed(await library.setBookmarkPrivacy(args)));
  handle('bookmark-remove', async args => changed(await library.removeBookmark(args.id)));
  handle('bookmarks-privacy', async args => changed(await library.setBookmarksPrivacy(args)));
  handle('bookmarks-remove', async args => changed(await library.removeBookmarks(args)));
  handle('archive-stats', () => client.account ? archive.stats(client.account.id) : { count: 0, bytes: 0 });
  handle('archive-clear', async () => { if (!client.account) throw new Error('请先登录'); await archive.clear(client.account.id); library.clear(); });
  handle('follow-artist', async args => changed(await library.follow(args)));
  handle('artist-status', async args => ({ isFollowed: !!(await client.api(`user/${validateId(args.id)}`, { full: 1 })).isFollowed }));
  handle('recommendations', args => recommendations.list({ ...args, page: page(args.page) }));
  handle('dismiss-recommendation', args => recommendations.dismiss(args.id));
  handle('history', () => memory.historyList());
  handle('clear-history', () => memory.clearHistory());
  handle('clear-interests', () => { memory.resetTaste(); recommendations.clear(); });
  handle('refresh-library', () => { library.clear(); client.artistCache.clear(); });
  handle('save-settings', args => {
    if (args.theme !== undefined) { if (!['light', 'dark', 'system'].includes(args.theme)) throw new Error('主题无效'); settings.theme = nativeTheme.themeSource = args.theme; }
    if (args.language !== undefined) {
      if (!['system', 'zh', 'en'].includes(args.language)) throw new Error('语言无效');
      const before = language(); settings.language = args.language;
      // Switching language reloads the page so every view is drawn in the new language.
      client.lang = language(); recommendations.clear();
      if (language() !== before) setImmediate(() => { localizeNative(); mainWindow.setTitle(native('title')); mainWindow.webContents.reload(); });
    }
    if (args.archiveBookmarks !== undefined) { if (typeof args.archiveBookmarks !== 'boolean') throw new Error('设置无效'); settings.archiveBookmarks = archive.enabled = args.archiveBookmarks; }
    if (args.closeBehavior !== undefined) { if (!['ask', 'exit', 'tray'].includes(args.closeBehavior)) throw new Error('关闭方式无效'); settings.closeBehavior = args.closeBehavior; }
    return saveSettings();
  });
  handle('close-choice', args => {
    const action = args.action === 'tray' ? 'tray' : 'exit';
    if (args.remember === true) { settings.closeBehavior = action; saveSettings(); }
    setImmediate(() => closeTo(action));
    return settings;
  });
  handle('quit', () => { setImmediate(quit); });
  handle('choose-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: native('folder'), defaultPath: settings.downloadDir, properties: ['openDirectory', 'createDirectory'] });
    if (!result.canceled && result.filePaths[0]) { settings.downloadDir = result.filePaths[0]; saveSettings(); }
    return settings;
  });
  handle('save-proxy', async args => {
    const proxy = String(args.proxy || '').trim();
    if (proxy && !/^(?:https?|socks5):\/\/(?:[a-zA-Z0-9.-]+|\[[a-fA-F0-9:]+\]):\d{1,5}$/.test(proxy)) throw new Error('代理格式示例：http://127.0.0.1:7890 或 socks5://127.0.0.1:1080');
    settings.proxy = proxy; await applyProxy(); return saveSettings();
  });
  handle('save-image-mirror', args => {
    const mode = String(args.mode || 'official'), host = mirrorHost(args.host || settings.imageMirror);
    client.setImageMirror({ mode, host });
    settings.imageMode = mode; settings.imageMirror = host; return saveSettings();
  });
  // Measures how quickly each image route answers through the current proxy settings.
  handle('test-image-mirror', args => Promise.all(['i.pximg.net', mirrorHost(args.host || settings.imageMirror)].map(async host => {
    const started = Date.now();
    try {
      const response = await client.session.fetch(`https://${host}/`, { method: 'HEAD', redirect: 'follow', cache: 'no-store', headers: { Referer: 'https://www.pixiv.net/' }, signal: AbortSignal.timeout(8000) });
      return { host, ok: response.status < 500, ms: Date.now() - started, status: response.status };
    } catch (e) { return { host, ok: false, error: e.name === 'TimeoutError' ? '超时' : '无法连接' }; }
  })));
  handle('enqueue', request => downloads.enqueue(request, settings.downloadDir));
  handle('cancel-download', args => downloads.cancel(args.id));
  handle('retry-download', args => downloads.retry(args.id));
  handle('clear-downloads', () => downloads.clearHistory());
  handle('open-directory', async args => {
    const directory = downloads.snapshot().find(j => j.id === args.id)?.directory || settings.downloadDir;
    await fs.promises.mkdir(directory, { recursive: true });
    const error = await shell.openPath(directory); if (error) throw new Error(error);
  });
  handle('open-logs', async () => {
    await fs.promises.mkdir(logger.dir, { recursive: true });
    const error = await shell.openPath(logger.dir); if (error) throw new Error(error);
  });
  handle('report-error', args => { logger.error('renderer', `${String(args.message || '').slice(0, 500)}\n${String(args.stack || '').slice(0, 1500)}`); });
  handle('open-pixiv', args => {
    if (args.type === 'artwork') return shell.openExternal(`https://www.pixiv.net/artworks/${validateId(args.id)}`);
    if (args.type === 'artist') return shell.openExternal(`https://www.pixiv.net/users/${validateId(args.id)}`);
    if (args.type === 'bookmarks') { if (!client.account) throw new Error('请先登录'); return shell.openExternal(`https://www.pixiv.net/users/${client.account.id}/bookmarks/artworks`); }
    return shell.openExternal('https://www.pixiv.net/');
  });
}
app.on('window-all-closed', () => app.quit());
let stopping = false;
app.on('before-quit', event => {
  quitRequested = true;
  if (!downloads?.active || stopping) return;
  event.preventDefault(); stopping = true; downloads.shutdown();
  // Let the aborted stream close and remove its own staging files before exiting.
  const deadline = Date.now() + 5000;
  const finish = () => { if (!downloads.active || Date.now() >= deadline) app.quit(); else setTimeout(finish, 50); };
  finish();
});
app.on('will-quit', () => { memory?.clearHistory(); tray?.destroy(); });
