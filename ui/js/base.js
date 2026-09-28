/* Shared helpers, state and UI primitives. All account and file work goes through window.pixiv. */
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const bridge = window.pixiv;
const icons = {
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  'arrow-right': '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  'chevron-right': '<path d="m9 5 7 7-7 7"/>', 'chevron-left': '<path d="m15 5-7 7 7 7"/>', 'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  sparkles: '<path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4ZM20 2v4m-2-2h4"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m16 8-2 6-6 2 2-6Z"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20v-1a6.5 6.5 0 0 1 13 0v1M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 5.5V20"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
  settings: '<path d="m10 3-.7 2.5-2 .9-2.3-.7L3 9l1.8 1.8v2.4L3 15l2 3.3 2.3-.7 2 .9L10 21h4l.7-2.5 2-.9 2.3.7 2-3.3-1.8-1.8v-2.4L21 9l-2-3.3-2.3.7-2-.9L14 3Z"/><circle cx="12" cy="12" r="3"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  'check-square': '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="m7 12 3 3 7-7"/>',
  check: '<path d="m5 12 4 4L19 6"/>', refresh: '<path d="M20 7v5h-5M4 17v-5h5M5.3 7a8 8 0 0 1 13-2L20 7M4 17l1.7 2a8 8 0 0 0 13-2"/>',
  layers: '<rect x="3" y="7" width="14" height="14" rx="2"/><path d="M7 3h12a2 2 0 0 1 2 2v12"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>', folder: '<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  archive: '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M11 3v2h2v3h-2v3h2v3h-2v3h3v2h-4v-3"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 3-6 6 7"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 4v16M17 4v16M3 9h4m10 0h4M3 15h4m10 0h4"/>',
  play: '<path d="M7 5v14l12-7Z"/>', pause: '<path d="M8 5v14m8-14v14"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>', globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>', external: '<path d="M14 3h7v7m0-7-11 11M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/>',
  minimize: '<path d="M5 19h14M12 4v10m-4-4 4 4 4-4"/>', power: '<path d="M12 3v8M6.3 6.3a8 8 0 1 0 11.4 0"/>'
};
const icon = name => `<i><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.image}</svg></i>`;

const state = {
  account: null, settings: {}, jobs: [], view: 'recommend', mode: 'preview',
  works: [], people: [], selected: new Map(), page: 1, hasMore: false, total: null, busy: false, error: '', notice: '', revision: 0,
  query: '', order: 'date_d', type: 'all', match: 's_tag',
  artistId: '', artist: null, title: '',
  recKind: 'for-you', allowR18: false, interests: [],
  followTag: '', followRest: 'show', followTags: [],
  bm: { rest: 'show', tag: '', age: 'all', order: 'newest', artworkTag: '', bm: '' }, bmTags: { public: [], private: [] }, bmPeriods: [],
  bmManage: false, bmPicked: new Map(), bmBusy: false,
  detail: null, detailPage: 0, viewerRevision: 0
};

function toast(message, error = false) {
  const el = document.createElement('div'); el.className = 'toast' + (error ? ' error' : ''); el.textContent = message;
  $('#toasts').append(el); setTimeout(() => el.remove(), error ? 8000 : 4500);
}
// Runs an action and shows its error. Programming errors (TypeError etc.) are also written to the log;
// ordinary failures such as "please sign in" are already explained to the user.
function guarded(fn) { return (...args) => Promise.resolve().then(() => fn(...args)).catch(e => { toast(e?.message || String(e), true); reportError(e); }); }
function reportError(e) {
  if (!(e instanceof Error) || e.name === 'Error') return;
  bridge.call('report-error', { message: `${e.name}: ${e.message}`, stack: e.stack }).catch(() => {});
}
window.addEventListener('error', e => bridge.call('report-error', { message: e.message, stack: e.error?.stack || `${e.filename}:${e.lineno}` }).catch(() => {}));
window.addEventListener('unhandledrejection', e => reportError(e.reason));

function imageSrc(url) {
  if (/^archive:\d{1,16}$/.test(url || '')) return `pixiv-image://archive/?id=${url.slice(8)}`;
  try { const u = new URL(url); if (u.protocol === 'https:' && /(^|\.)pximg\.net$/i.test(u.hostname)) return `pixiv-image://image/?url=${encodeURIComponent(u.href)}`; } catch {}
  return 'assets/unavailable.svg';
}
function parseRange(input, count) {
  const text = String(input || '').trim();
  if (!text) return Array.from({ length: count }, (_, i) => i + 1);
  const pages = new Set();
  for (const part of text.replace(/[，、；;]/g, ',').split(',')) {
    const m = part.trim().match(/^(\d+)\s*(?:[-–—~至]\s*(\d+))?$/);
    if (!m) throw new Error('请输入 1-4,9-13 或 2,5,8');
    const a = Number(m[1]), b = Number(m[2] || m[1]);
    if (a < 1 || b > count || a > b) throw new Error(`请输入 1–${count} 范围内的页码`);
    for (let i = a; i <= b; i++) pages.add(i);
  }
  return [...pages].sort((a, b) => a - b);
}
function dateLabel(value) { const d = new Date(value); return value && !Number.isNaN(d.valueOf()) ? `${d.getMonth() + 1}.${String(d.getDate()).padStart(2, '0')}` : ''; }
function empty(title, description, action = '') { return `<div class="empty"><div class="empty-icon">${icon('image')}</div><h2>${esc(title)}</h2><p>${esc(description)}</p>${action}</div>`; }
const option = (value, text, current, note = '') => `<option value="${esc(value)}" ${value === current ? 'selected' : ''} ${note ? `data-note="${esc(note)}"` : ''}>${esc(text)}</option>`;
const selectField = (id, label, options, current) => `<label class="field">${label}<select id="${id}">${options.map(([v, t]) => option(v, t, current)).join('')}</select></label>`;
const switchField = (id, label, checked, note = '') => `<label class="switch"><input type="checkbox" id="${id}" ${checked ? 'checked' : ''}><span class="switch-track" aria-hidden="true"><span></span></span><span class="switch-text">${label}${note ? `<small>${note}</small>` : ''}</span></label>`;

/* Unified dropdown: every native <select> is replaced by the same rounded menu. The native element
   stays in the DOM as the value store, so existing change listeners keep working. */
const Dropdown = (() => {
  let openMenu = null;
  function close() { if (!openMenu) return; openMenu.menu.hidden = true; openMenu.button.setAttribute('aria-expanded', 'false'); openMenu = null; }
  function sync(select) {
    const box = select.closest('.dropdown'); if (!box) return;
    const button = $('.dropdown-trigger', box), current = select.selectedOptions[0];
    $('.dropdown-label', button).textContent = current?.text || '';
    button.disabled = select.disabled;
  }
  function open(select) {
    const box = select.closest('.dropdown'), button = $('.dropdown-trigger', box), menu = $('.dropdown-menu', box);
    if (openMenu?.menu === menu) return close();
    close();
    menu.innerHTML = [...select.options].map((o, i) => `<button type="button" role="option" data-index="${i}" aria-selected="${o.selected}" ${o.disabled ? 'disabled' : ''}><span><strong>${esc(o.text)}</strong>${o.dataset.note ? `<small>${esc(o.dataset.note)}</small>` : ''}</span>${icon('check')}</button>`).join('');
    const rect = button.getBoundingClientRect();
    menu.style.minWidth = `${Math.max(rect.width, 150)}px`;
    menu.hidden = false;
    const height = menu.offsetHeight, viewW = document.documentElement.clientWidth, viewH = document.documentElement.clientHeight, below = viewH - rect.bottom;
    menu.style.left = `${Math.max(8, Math.min(rect.left, viewW - menu.offsetWidth - 12))}px`;
    menu.style.top = `${below < height + 12 && rect.top > height + 12 ? rect.top - height - 6 : rect.bottom + 6}px`;
    button.setAttribute('aria-expanded', 'true'); openMenu = { menu, button };
    ($('[aria-selected="true"]', menu) || $('button:not(:disabled)', menu))?.focus();
  }
  function choose(select, index) {
    close();
    if (select.selectedIndex !== index) { select.selectedIndex = index; select.dispatchEvent(new Event('change', { bubbles: true })); }
    sync(select); select.closest('.dropdown')?.querySelector('.dropdown-trigger')?.focus();
  }
  function enhance(select) {
    if (select.dataset.dropdown) return;
    select.dataset.dropdown = '1';
    const box = document.createElement('span');
    box.className = `dropdown ${select.className}`;
    select.before(box); box.append(select);
    select.classList.add('dropdown-native'); select.tabIndex = -1; select.setAttribute('aria-hidden', 'true');
    box.insertAdjacentHTML('beforeend', `<button type="button" class="dropdown-trigger" aria-haspopup="listbox" aria-expanded="false" aria-label="${esc(select.getAttribute('aria-label') || select.closest('label')?.firstChild?.textContent?.trim() || '')}"><span class="dropdown-label"></span>${icon('chevron-down')}</button><div class="dropdown-menu" role="listbox" hidden></div>`);
    const button = $('.dropdown-trigger', box), menu = $('.dropdown-menu', box);
    button.onclick = e => { e.preventDefault(); open(select); };
    button.onkeydown = e => { if (['ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); open(select); } };
    menu.onclick = e => { const item = e.target.closest('[data-index]'); if (item && !item.disabled) choose(select, Number(item.dataset.index)); };
    menu.onkeydown = e => {
      const items = $$('button:not(:disabled)', menu), at = items.indexOf(document.activeElement);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
        e.preventDefault();
        items[e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
      } else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); close(); button.focus(); }
    };
    select.addEventListener('change', () => sync(select));
    sync(select);
  }
  // Selects are created by many views; enhance them wherever they appear.
  new MutationObserver(records => { for (const r of records) for (const node of r.addedNodes) if (node.nodeType === 1) (node.matches('select') ? [node] : $$('select', node)).forEach(enhance); })
    .observe(document.body, { childList: true, subtree: true });
  document.addEventListener('pointerdown', e => { if (openMenu && !e.target.closest('.dropdown')) close(); }, true);
  addEventListener('resize', close); document.addEventListener('scroll', e => { if (openMenu && !openMenu.menu.contains(e.target)) close(); }, true);
  $$('select').forEach(enhance);
  return { enhance, sync, close };
})();

/* Dialogs close with Escape (native) and by clicking the dimmed area beside them. */
function dismissOnBackdrop(dialog, onClose = () => dialog.close()) {
  dialog.addEventListener('pointerdown', e => {
    if (e.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose();
  });
}
function openDialog(dialog, html) { dialog.innerHTML = html; if (!dialog.open) dialog.showModal(); }
// Asks before an irreversible action. Resolves true only when the confirm button is pressed.
function confirmAction({ title, message, confirm = '确认', danger = true }) {
  const dialog = $('#confirm-dialog');
  openDialog(dialog, `<div class="dialog-heading"><h2>${esc(title)}</h2><button class="icon-button" data-answer="no" aria-label="取消">${icon('close')}</button></div><p class="help-text dialog-message">${esc(message)}</p><div class="dialog-actions end"><button class="secondary" data-answer="no">取消</button><button class="${danger ? 'primary danger-fill' : 'primary'}" data-answer="yes">${esc(confirm)}</button></div>`);
  $('[data-answer="no"].secondary', dialog).focus();
  return new Promise(resolve => {
    const done = answer => { dialog.removeEventListener('click', onClick); dialog.removeEventListener('close', onClose); if (dialog.open) dialog.close(); resolve(answer); };
    const onClick = e => { const b = e.target.closest('[data-answer]'); if (b) done(b.dataset.answer === 'yes'); };
    const onClose = () => done(false);
    dialog.addEventListener('click', onClick); dialog.addEventListener('close', onClose);
  });
}
dismissOnBackdrop($('#confirm-dialog'));
