/* Search palette, keyboard shortcuts, and the header search button.
   Self-contained; loaded on app-shell pages and Quartz note pages.
   Cmd/Ctrl-K or "/" opens search; "g h|s|w|l|t|a" navigates; "?" shows help. */
(() => {
  'use strict';
  if (window.__palette) return;
  window.__palette = true;

  const doc = document;
  const IS_MAC = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '');
  const MOD = IS_MAC ? '⌘' : 'Ctrl';

  const HUBS = [
    { title: 'Home', href: '/', keys: 'index introduction start' },
    { title: 'Stream', href: '/stream/', keys: 'timeline feed latest recent' },
    { title: 'Writing', href: '/writing/', keys: 'essays posts reflections notes articles' },
    { title: 'Library', href: '/library/', keys: 'books reading films papers podcasts projects shelves' },
    { title: 'Training history', href: '/stream/training/', keys: 'running cycling swimming workouts activities sport' },
    { title: 'Sleep', href: '/stream/sleep/', keys: 'sleep bedtime hrv rest nights schedule' },
    { title: 'Archive', href: '/archive/', keys: 'months years past' },
    { title: 'About', href: '/about.html', keys: 'bio contact links me' }
  ];
  const GO = { h: '/', s: '/stream/', w: '/writing/', l: '/library/', t: '/stream/training/', a: '/archive/' };
  const SHORTCUTS = [
    [[MOD, 'K'], 'Search'], [['/'], 'Search'], [['g', 'h'], 'Go to home'], [['g', 's'], 'Go to stream'],
    [['g', 'w'], 'Go to writing'], [['g', 'l'], 'Go to library'], [['g', 't'], 'Go to training history'],
    [['g', 'a'], 'Go to archive'], [['?'], 'Show this help'], [['Esc'], 'Close']
  ];
  const TYPE_LABEL = {
    'literature-note': 'Reading note', writing: 'Writing', reflection: 'Reflection', photo: 'Photo', literature: 'Library', concept: 'Concept',
    evergreen: 'Note', project: 'Project', activity: 'Training', page: 'Page', month: 'Archive', block: 'Training block'
  };
  const MEDIUM_LABEL = { book: 'Book', article: 'Article', film: 'Film', video: 'Video', podcast: 'Podcast', paper: 'Paper' };

  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parseDay = s => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d, 12); };
  const fmtDate = s => (/^\d{4}-\d{2}-\d{2}/.test(String(s || '')) ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(parseDay(s)) : '');
  const entryHref = u => (u && u.startsWith('/') && !u.endsWith('/') && !/\.html(?:[?#]|$)/.test(u) ? `${u}.html` : u);
  const isEditable = t => !!(t && (t.isContentEditable || (t.closest && t.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"], [role="combobox"]'))));
  const ICON = '<svg class="pal-ico" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="7" cy="7" r="4.6"/><path d="m10.6 10.6 3.4 3.4"/></svg>';

  /* ---------------- modal plumbing ---------------- */
  const makeDialog = (cls, label) => {
    const d = doc.createElement('dialog');
    d.className = `pal ${cls}`;
    d.setAttribute('aria-label', label);
    let from = null;
    d._open = () => {
      if (d.open) return;
      from = doc.activeElement;
      if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
    };
    d.addEventListener('close', () => {
      const f = from; from = null;
      if (f && f.isConnected && typeof f.focus === 'function') { try { f.focus({ preventScroll: true }); } catch { /* ignore */ } }
    });
    d.addEventListener('mousedown', e => { if (e.target === d) d.close(); });
    doc.body.append(d);
    return d;
  };
  const anyOpen = () => !!doc.querySelector('dialog.pal[open]');

  /* ---------------- search index ---------------- */
  let indexPromise = null;
  let index = [];
  let loadError = false;

  const norm = s => String(s || '').toLowerCase();
  const labelFor = e => (e.type === 'literature' && MEDIUM_LABEL[e.medium]) || TYPE_LABEL[e.type] || 'Entry';
  const buildIndex = data => {
    const hubs = HUBS.map(h => ({
      hub: true, title: h.title, href: h.href, label: 'Page', date: '', summary: '', topics: [], body: h.keys,
      t: norm(h.title), k: norm(h.keys)
    }));
    const hubHrefs = new Set(hubs.map(h => h.href));
    const entries = (data && Array.isArray(data.entries) ? data.entries : []).map(e => {
      const act = e.activity || {};
      /* tags (falling back to topics) */
      const topics = [...new Set((Array.isArray(e.tags) ? e.tags : Array.isArray(e.topics) ? e.topics : []).map(t => String(t).toLowerCase().replace(/^#/, '').trim()).filter(Boolean))];
      const body = [e.search, e.creator, act.sport, e.medium].filter(Boolean).join(' ');
      return {
        hub: false, title: e.title || e.url, href: entryHref(e.url), label: labelFor(e), type: e.type, date: e.date || '',
        summary: e.summary || '', topics, body,
        t: norm(e.title), k: norm(topics.join(' ')), l: norm(`${labelFor(e)} ${e.type} ${e.creator || ''}`), s: norm(e.summary), b: norm(body)
      };
    }).filter(e => e.href && !hubHrefs.has(e.href));
    index = hubs.concat(entries);
  };
  const load = () => {
    if (!indexPromise) {
      indexPromise = fetch('/site-data.json')
        .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(d => { buildIndex(d); })
        .catch(() => { loadError = true; buildIndex(null); });
    }
    return indexPromise;
  };

  const wordPrefix = (text, t) => (text.startsWith(t) || text.includes(` ${t}`) || text.includes(`-${t}`) || text.includes(`/${t}`));
  const scoreEntry = (e, tokens, full) => {
    let total = 0;
    for (const t of tokens) {
      let s = 0;
      if (e.t.startsWith(t)) s = 100;
      else if (wordPrefix(e.t, t)) s = 70;
      else if (e.t.includes(t)) s = 45;
      else if (e.k && wordPrefix(e.k, t)) s = 35;
      else if (e.k && e.k.includes(t)) s = 25;
      else if (e.l && e.l.includes(t)) s = 20;
      else if (e.s && e.s.includes(t)) s = 15;
      else if (e.b && e.b.includes(t)) s = 8;
      if (!s) return 0;
      total += s;
    }
    if (e.t.startsWith(full)) total += 60;
    else if (e.t === full) total += 100;
    if (e.hub) total += 5;
    return total;
  };
  const search = q => {
    const full = norm(q).trim().replace(/\s+/g, ' ');
    if (!full) {
      const recent = index.filter(e => !e.hub && !['activity', 'month', 'block', 'page'].includes(e.type))
        .sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 6);
      return { groups: [['Go to', index.filter(e => e.hub)], ['Recent', recent]], tokens: [] };
    }
    const tokens = full.split(' ');
    const out = [];
    for (const e of index) { const s = scoreEntry(e, tokens, full); if (s) out.push([s, e]); }
    out.sort((a, b) => b[0] - a[0] || String(b[1].date).localeCompare(String(a[1].date)));
    return { groups: [[null, out.slice(0, 30).map(x => x[1])]], tokens };
  };

  /* ---------------- rendering ---------------- */
  const highlight = (text, tokens) => {
    if (!tokens.length) return esc(text);
    const re = new RegExp(`(${tokens.map(reEsc).join('|')})`, 'gi');
    return String(text).split(re).map((part, i) => (i % 2 ? `<mark>${esc(part)}</mark>` : esc(part))).join('');
  };
  const snippet = (e, tokens) => {
    const clip = (txt, n) => (txt.length > n ? `${txt.slice(0, n - 1).trimEnd()}…` : txt);
    if (!tokens.length) return clip(e.summary, 140);
    const hit = txt => { const l = norm(txt); return tokens.some(t => l.includes(t)); };
    if (e.summary && hit(e.summary)) return clip(e.summary, 140);
    if (!e.hub && e.body) {
      const flat = e.body.replace(/\s+/g, ' ');
      const l = flat.toLowerCase();
      const pos = tokens.map(t => l.indexOf(t)).filter(i => i >= 0).sort((a, b) => a - b)[0];
      if (pos != null) {
        const start = Math.max(0, pos - 50);
        return `${start ? '…' : ''}${flat.slice(start, start + 140).trim()}${start + 140 < flat.length ? '…' : ''}`;
      }
    }
    return clip(e.summary, 140);
  };

  /* ---------------- search dialog ---------------- */
  let dlg = null, input, list, status, shown = [], active = -1;

  const setActive = (i, scroll = true) => {
    const opts = list.querySelectorAll('[role="option"]');
    opts.forEach((o, k) => o.setAttribute('aria-selected', String(k === i)));
    active = i;
    const o = opts[i];
    if (o) { input.setAttribute('aria-activedescendant', o.id); if (scroll) o.scrollIntoView({ block: 'nearest' }); } else input.removeAttribute('aria-activedescendant');
  };
  const render = () => {
    const q = input.value;
    const { groups, tokens } = search(q);
    shown = []; let html = '', n = 0;
    for (const [name, items] of groups) {
      if (!items.length) continue;
      if (name) html += `<li class="pal-group" role="presentation">${esc(name)}</li>`;
      for (const e of items) {
        const sn = snippet(e, tokens);
        html += `<li role="option" id="pal-o-${n}" aria-selected="false" data-i="${n}"><a href="${esc(e.href)}" tabindex="-1"><span class="pal-main"><span class="pal-head"><span class="pal-title">${highlight(e.title, tokens)}</span>${e.topics.length ? `<span class="pal-tags">${e.topics.slice(0, 3).map(t => `#${esc(t)}`).join(' ')}</span>` : ''}</span>${sn ? `<span class="pal-snip">${highlight(sn, tokens)}</span>` : ''}</span><span class="pal-meta"><span class="pal-type">${esc(e.label)}</span>${e.date ? `<span class="pal-date">${esc(fmtDate(e.date))}</span>` : ''}</span></a></li>`;
        shown.push(e); n++;
      }
    }
    if (!n) html = `<li class="pal-empty" role="presentation">${loadError && q ? 'Search index unavailable.' : `No results for “${esc(q.trim())}”`}</li>`;
    list.innerHTML = html;
    setActive(n ? 0 : -1, false);
    list.scrollTop = 0;
    status.textContent = q.trim() ? (n ? `${n} result${n === 1 ? '' : 's'}` : 'No results') : '';
  };
  const go = href => { dlg.close(); location.href = href; };

  const buildSearch = () => {
    dlg = makeDialog('pal-search', 'Search');
    dlg.innerHTML = `<div class="pal-box"><div class="pal-field">${ICON}<input class="pal-input" type="text" role="combobox" aria-label="Search the site" aria-expanded="true" aria-controls="pal-list" aria-autocomplete="list" placeholder="Search writing, library, training…" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="go"><button type="button" class="pal-esc" aria-label="Close search"><kbd>esc</kbd></button></div><ul class="pal-list" id="pal-list" role="listbox" aria-label="Results"></ul><div class="pal-foot" aria-hidden="true"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> open</span><span><kbd>?</kbd> shortcuts</span></div><div class="sr-only" role="status" aria-live="polite" id="pal-status"></div></div>`;
    input = dlg.querySelector('.pal-input'); list = dlg.querySelector('.pal-list'); status = dlg.querySelector('#pal-status');
    input.addEventListener('input', render);
    dlg.querySelector('.pal-esc').addEventListener('click', () => dlg.close());
    input.addEventListener('keydown', e => {
      const n = shown.length;
      if (e.key === 'ArrowDown') { e.preventDefault(); if (n) setActive((active + 1) % n); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (n) setActive((active - 1 + n) % n); }
      else if (e.key === 'Enter') {
        if (e.isComposing) return;
        e.preventDefault();
        const t = shown[active];
        if (!t) return;
        if (e.metaKey || e.ctrlKey) { window.open(t.href, '_blank', 'noopener'); return; }
        go(t.href);
      } else if (e.key === 'Tab') { e.preventDefault(); }
    });
    list.addEventListener('mousemove', e => { const o = e.target.closest('[role="option"]'); if (o && +o.dataset.i !== active) setActive(+o.dataset.i, false); });
    list.addEventListener('click', e => {
      const a = e.target.closest('a');
      if (!a) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
      e.preventDefault(); go(a.getAttribute('href'));
    });
  };

  const openSearch = () => {
    if (!dlg) buildSearch();
    if (helpDlg && helpDlg.open) helpDlg.close();
    if (dlg.open) { input.focus(); input.select(); return; }
    input.value = '';
    // Render hub pages immediately; refine once the index has loaded.
    if (!index.length) buildIndex(null);
    render();
    dlg._open();
    input.focus();
    load().then(() => { if (dlg.open) render(); });
  };

  /* ---------------- help dialog ---------------- */
  let helpDlg = null;
  const openHelp = () => {
    if (dlg && dlg.open) return;
    if (!helpDlg) {
      helpDlg = makeDialog('pal-help', 'Keyboard shortcuts');
      helpDlg.innerHTML = `<div class="pal-box"><div class="pal-help-head"><h2>Keyboard shortcuts</h2><button type="button" class="pal-esc" aria-label="Close"><kbd>esc</kbd></button></div><dl class="pal-keys">${SHORTCUTS.map(([k, d]) => `<div><dt>${k.map((x, i) => `${i ? `<span class="pal-then">${k[0] === 'g' ? 'then' : '+'}</span>` : ''}<kbd>${esc(x)}</kbd>`).join('')}</dt><dd>${esc(d)}</dd></div>`).join('')}</dl></div>`;
      helpDlg.querySelector('.pal-esc').addEventListener('click', () => helpDlg.close());
    }
    if (helpDlg.open) { helpDlg.close(); return; }
    helpDlg._open();
    const b = helpDlg.querySelector('.pal-esc');
    if (b) b.focus();
  };

  /* ---------------- global keys ---------------- */
  let pending = 0, timer = 0;
  const clearSeq = () => { pending = 0; clearTimeout(timer); };
  doc.addEventListener('keydown', e => {
    if (e.defaultPrevented) return;
    const k = e.key;
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && (k === 'k' || k === 'K')) {
      e.preventDefault(); clearSeq(); openSearch(); return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing || k === 'Shift') return;
    if (isEditable(e.target) || anyOpen()) {
      // Inside the help dialog, "?" toggles it closed again.
      if (k === '?' && helpDlg && helpDlg.open && !isEditable(e.target)) { e.preventDefault(); helpDlg.close(); }
      return;
    }
    if (pending) {
      const dest = GO[String(k).toLowerCase()];
      clearSeq();
      if (dest && !e.shiftKey) { e.preventDefault(); location.href = dest; return; }
    }
    if (k === '/') { e.preventDefault(); openSearch(); }
    else if (k === '?') { e.preventDefault(); openHelp(); }
    else if (k === 'g' && !e.shiftKey) { pending = 1; timer = setTimeout(clearSeq, 1000); }
  });
  doc.addEventListener('visibilitychange', clearSeq);

  /* ---------------- header button ---------------- */
  const addButton = () => {
    const header = doc.querySelector('.site-header');
    if (!header) return false;
    if (header.querySelector('.pal-btn')) return true;
    const b = doc.createElement('button');
    b.type = 'button'; b.className = 'pal-btn';
    b.setAttribute('aria-label', 'Search'); b.setAttribute('aria-keyshortcuts', 'Control+K Meta+K /');
    b.innerHTML = `${ICON}<span class="pal-btn-text">Search</span><kbd class="pal-btn-kbd" aria-hidden="true">${MOD === '⌘' ? '⌘K' : 'Ctrl K'}</kbd>`;
    b.addEventListener('click', openSearch);
    b.addEventListener('pointerenter', load, { once: true });
    b.addEventListener('focus', load, { once: true });
    const nav = header.querySelector('.main-nav') || header.querySelector('nav');
    const right = header.querySelector('.header-right');
    if (nav && nav.parentNode) nav.after(b);
    else if (right) right.append(b);
    else (header.querySelector('.header-inner') || header).append(b);
    return true;
  };
  const initButton = () => {
    if (addButton()) return;
    // The header may be injected by another script (note pages); wait briefly.
    const mo = new MutationObserver(() => { if (addButton()) mo.disconnect(); });
    mo.observe(doc.body || doc.documentElement, { childList: true, subtree: true });
    setTimeout(() => mo.disconnect(), 8000);
  };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', initButton, { once: true }); else initButton();
})();
