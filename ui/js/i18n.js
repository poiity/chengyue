/* Interface language. Chinese is the source text; in English mode every piece of interface text is
   looked up in LOCALE_EN as it appears (views, dialogs, toasts, messages from the main process).
   User content — artwork titles, artist names, tags, descriptions — is marked translate="no" and never touched. */
const I18N = (() => {
  const lang = window.pixiv?.language === 'en' ? 'en' : 'zh';
  const locale = lang === 'en' ? 'en-US' : 'zh-CN';
  document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
  const { strings = {}, patterns = [] } = window.LOCALE_EN || {};
  const CJK = /[぀-ヿ㐀-鿿]/;
  const ATTRS = ['title', 'placeholder', 'aria-label', 'alt'];
  function tr(text) {
    if (lang !== 'en' || text == null) return text;
    const value = String(text);
    if (!CJK.test(value)) return value;
    const core = value.trim(), lead = value.slice(0, value.indexOf(core)), trail = value.slice(value.indexOf(core) + core.length);
    if (Object.hasOwn(strings, core)) return lead + strings[core] + trail;
    for (const [pattern, replacement] of patterns) {
      const m = core.match(pattern);
      if (m) return lead + (typeof replacement === 'function' ? replacement(tr, ...m.slice(1)) : core.replace(pattern, replacement)) + trail;
    }
    return value;
  }
  const skipped = node => !!node.parentElement?.closest('[translate="no"], script, style');
  function translateText(node) { if (!skipped(node)) { const next = tr(node.nodeValue); if (next !== node.nodeValue) node.nodeValue = next; } }
  function translateAttrs(el) {
    if (el.closest('[translate="no"]')) return;
    for (const name of ATTRS) { const v = el.getAttribute(name); if (v && CJK.test(v)) { const next = tr(v); if (next !== v) el.setAttribute(name, next); } }
  }
  function translateTree(root) {
    if (root.nodeType === 3) return translateText(root);
    if (root.nodeType !== 1) return;
    translateAttrs(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) n.nodeType === 3 ? translateText(n) : translateAttrs(n);
  }
  if (lang === 'en') {
    document.title = tr(document.title);
    translateTree(document.body);
    new MutationObserver(records => {
      for (const r of records) {
        if (r.type === 'characterData') translateText(r.target);
        else if (r.type === 'attributes') translateAttrs(r.target);
        else r.addedNodes.forEach(translateTree);
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  return { lang, locale, tr };
})();
