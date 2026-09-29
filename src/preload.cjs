// The page gets two functions only: invoke an allow-listed main-process action, or listen to an event.
const { contextBridge, ipcRenderer } = require('electron');
const channels = new Set([
  'init', 'account-status', 'login', 'logout', 'feed', 'search', 'artist', 'detail', 'ugoira', 'related',
  'suggestions', 'following', 'following-works', 'bookmarks', 'bookmark-tags', 'bookmark-periods', 'bookmark-months-sync', 'bookmark-state', 'bookmark-quick',
  'bookmark-privacy', 'bookmark-remove', 'bookmarks-privacy', 'bookmarks-remove', 'archive-stats', 'archive-clear', 'clear-downloads', 'follow-artist', 'artist-status', 'recommendations', 'dismiss-recommendation',
  'history', 'clear-history', 'clear-interests', 'refresh-library', 'save-settings', 'close-choice', 'quit',
  'choose-directory', 'save-proxy', 'save-image-mirror', 'test-image-mirror', 'enqueue', 'cancel-download',
  'retry-download', 'open-directory', 'open-logs', 'report-error', 'open-pixiv'
]);
const events = new Set(['account-changed', 'downloads-changed', 'notice', 'theme-changed', 'close-requested', 'open-settings']);
contextBridge.exposeInMainWorld('pixiv', {
  language: ipcRenderer.sendSync('language') === 'en' ? 'en' : 'zh',
  mac: process.platform === 'darwin',
  call: async (channel, args) => {
    if (!channels.has(channel)) throw new Error('不支持的操作');
    const result = await ipcRenderer.invoke(channel, args);
    if (!result.ok) throw new Error(result.error);
    return result.data;
  },
  on: (channel, callback) => {
    if (!events.has(channel)) return () => {};
    const handler = (_, value) => callback(value);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  }
});
