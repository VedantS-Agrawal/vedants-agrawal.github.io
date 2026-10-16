/* Reading layer for note pages (loaded by article.js): hover previews, stacked notes,
   "Linked from" backlinks with context, sidenotes, reading focus, local graph. No libraries. */
(() => {
  'use strict';
  if (window.__notesLayer) return;
  window.__notesLayer = true;

  const root = document.documentElement;
  const body = document.body;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const normPath = u => { let s = String(u || ''); try { s = decodeURIComponent(s); } catch { /* keep raw */ } return s.replace(/[?#].*$/, '').replace(/\.html$/, '').replace(/\/index$/, '').replace(/\/+$/, '') || '/'; };
  const pageHref = p => `${p}.html`;
  const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } };
  const mq = q => window.matchMedia(q);
  const reduceMotion = mq('(prefers-reduced-motion: reduce)');
  const canHover = mq('(hover: hover) and (pointer: fine)');
  const stackMQ = mq('(min-width: 1100px)');
  const sideMQ = mq('(min-width: 1200px)');
  const behavior = () => (reduceMotion.matches ? 'auto' : 'smooth');
  const onMQ = (m, fn) => (m.addEventListener ? m.addEventListener('change', fn) : m.addListener(fn));

  const TYPE_LABEL = { writing: 'Writing', reflection: 'Reflection', photo: 'Photo', literature: 'Library', concept: 'Concept', evergreen: 'Note', project: 'Project', activity: 'Training', page: 'Page', month: 'Archive', block: 'Training block' };
  const MEDIUM_LABEL = { book: 'Book', article: 'Article', film: 'Film', video: 'Video', podcast: 'Podcast', paper: 'Paper' };
  const typeLabel = e => (e && ((e.type === 'literature' && MEDIUM_LABEL[e.medium]) || TYPE_LABEL[e.type])) || '';
  const parseDay = s => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d, 12); };
  const whenOf = e => {
    const d = e && /^\d{4}-\d{2}-\d{2}/.test(String(e.date || '')) ? String(e.date).slice(0, 10) : '';
    if (!d) return '';
    if (e.datePrecision === 'year') return d.slice(0, 4);
    if (e.datePrecision === 'month') return new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' }).format(parseDay(d));
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(parseDay(d));
  };

  const basePath = normPath(location.pathname);
  const baseSearchPath = location.pathname;

  /* ---------------- data ---------------- */
  const getJSON = url => fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null);
  const known = new Map(); // normalized path -> site-data entry
  const siteReady = getJSON('/site-data.json').then(d => {
    ((d && d.entries) || []).forEach(e => { if (e && e.url) known.set(normPath(e.url), e); });
    return d;
  });
  const linksReady = getJSON('/data/links.json');
  const stackable = p => { const e = known.get(p); return !!e && e.type !== 'activity' && e.type !== 'month' && e.type !== 'block'; };

  /* ---------------- fetching notes (previews + panes) ---------------- */
  const noteCache = new Map();
  const clean = art => {
    $$('script, style, link, iframe, object, embed, noscript, form', art).forEach(n => n.remove());
    $$('*', art).forEach(n => {
      Array.from(n.attributes).forEach(a => {
        if (/^on/i.test(a.name)) n.removeAttribute(a.name);
        else if (/^(href|src|xlink:href)$/i.test(a.name) && /^\s*javascript:/i.test(a.value)) n.removeAttribute(a.name);
      });
    });
  };
  const fetchNote = path => {
    if (noteCache.has(path)) return noteCache.get(path);
    const pr = fetch(pageHref(path)).then(r => { if (!r.ok) throw new Error(String(r.status)); return r.text(); }).then(t => {
      const doc = new DOMParser().parseFromString(t, 'text/html');
      const art = doc.querySelector('article');
      if (!art) throw new Error('no article');
      const title = (doc.querySelector('.article-title') || {}).textContent || doc.title || path;
      clean(art);
      const ex = art.cloneNode(true);
      $$('sup, .footnotes, section[data-footnotes], .activity-panel, h1', ex).forEach(n => n.remove());
      const text = ex.textContent.replace(/\s+/g, ' ').trim();
      return { title: title.trim(), html: art.innerHTML, text, base: new URL(pageHref(path), location.origin) };
    });
    noteCache.set(path, pr);
    pr.catch(() => noteCache.delete(path));
    return pr;
  };

  /* Resolve a link to a stackable internal target ({path, hash}) or null. */
  const targetOf = a => {
    if (!a || !a.hasAttribute('href') || a.target === '_blank' || a.hasAttribute('download')) return null;
    const raw = a.getAttribute('href');
    if (!raw || raw.startsWith('#')) return null;
    let u;
    try { u = new URL(raw, a.baseURI || location.href); } catch { return null; }
    if (u.origin !== location.origin) return null;
    const path = normPath(u.pathname);
    return stackable(path) ? { path, hash: u.hash } : null;
  };
  const linkScope = a => a.closest('article, .note-after');

  /* Quartz's own popovers would collide with ours: stop its mouseenter handlers and hide its cards. */
  window.addEventListener('mouseenter', e => {
    if (e.target && e.target.closest && e.target.closest('a.internal')) e.stopImmediatePropagation();
  }, true);

  /* ================================================================
     1. Hover previews
  ================================================================ */
  let card = null, showTimer = 0, hideTimer = 0, cardLink = null, mouseX = 0, mouseY = 0;
  const ensureCard = () => {
    if (card) return card;
    card = document.createElement('div');
    card.className = 'hover-card';
    card.id = 'hover-card';
    card.setAttribute('role', 'tooltip');
    card.hidden = true;
    card.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    card.addEventListener('mouseleave', () => hideCard());
    body.append(card);
    return card;
  };
  const hideCard = (now) => {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    pending = null;
    const go = () => {
      if (card) { card.classList.remove('on'); card.hidden = true; }
      if (cardLink) { cardLink.removeAttribute('aria-describedby'); cardLink = null; }
    };
    if (now) go(); else hideTimer = setTimeout(go, 140);
  };
  const excerpt = text => {
    if (text.length <= 600) return text;
    const cut = text.slice(0, 600);
    return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 480))}…`;
  };
  const placeCard = a => {
    const c = card;
    c.style.left = '0px'; c.style.top = '0px';
    const w = c.offsetWidth, h = c.offsetHeight;
    const vw = document.documentElement.clientWidth, vh = window.innerHeight;
    const rects = Array.from(a.getClientRects());
    const r = rects.find(k => mouseX >= k.left - 2 && mouseX <= k.right + 2 && mouseY >= k.top - 2 && mouseY <= k.bottom + 2) || rects[0] || a.getBoundingClientRect();
    let left = Math.min(Math.max(12, r.left), vw - w - 12);
    let top = r.bottom + 8;
    if (top + h > vh - 12) top = r.top - h - 8 >= 12 ? r.top - h - 8 : Math.max(12, vh - h - 12);
    c.style.left = `${Math.round(left)}px`;
    c.style.top = `${Math.round(top)}px`;
  };
  const showCard = async (a, t) => {
    let note;
    try { note = await fetchNote(t.path); } catch { return; }
    if (pending !== a || !a.isConnected) return;
    const e = known.get(t.path);
    const meta = [typeLabel(e), whenOf(e)].filter(Boolean).join(' · ');
    const c = ensureCard();
    c.innerHTML = `<p class="hc-title">${esc(note.title)}</p>${meta ? `<p class="hc-meta">${esc(meta)}</p>` : ''}${note.text ? `<p class="hc-text">${esc(excerpt(note.text))}</p>` : ''}`;
    c.hidden = false;
    placeCard(a);
    cardLink = a;
    a.setAttribute('aria-describedby', 'hover-card');
    requestAnimationFrame(() => c.classList.add('on'));
  };
  let pending = null;
  const scheduleCard = a => {
    if (!canHover.matches) return;
    if (a === cardLink && card && !card.hidden) { clearTimeout(hideTimer); return; }
    const t = targetOf(a);
    if (!t || !linkScope(a)) return;
    const pane = a.closest('.pane');
    if (t.path === (pane ? pane.dataset.path : basePath) && !t.hash) return;
    clearTimeout(hideTimer); clearTimeout(showTimer);
    hideCard(true);
    pending = a;
    showTimer = setTimeout(() => showCard(a, t), 300);
  };
  document.addEventListener('mousemove', e => { mouseX = e.clientX; mouseY = e.clientY; }, { passive: true });
  document.addEventListener('mouseover', e => {
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a || a.hasAttribute('data-nostack')) return;
    if (e.relatedTarget && a.contains(e.relatedTarget)) return;
    scheduleCard(a);
  });
  document.addEventListener('mouseout', e => {
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    if (e.relatedTarget && (a.contains(e.relatedTarget) || (card && card.contains(e.relatedTarget)))) return;
    clearTimeout(showTimer);
    if (pending === a || cardLink === a) hideCard();
  });
  document.addEventListener('focusin', e => {
    const a = e.target.closest && e.target.closest('a[href]');
    if (a && !a.hasAttribute('data-nostack') && a.matches(':focus-visible')) scheduleCard(a);
  });
  document.addEventListener('focusout', e => { if (e.target.closest && e.target.closest('a[href]')) hideCard(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') hideCard(true); });
  document.addEventListener('scroll', () => hideCard(true), { capture: true, passive: true });

  /* ================================================================
     2. Stacked notes
  ================================================================ */
  const PW_MAX = 640, SPINE = 40;
  let active = false, stack = [], panes = [], stackEl = null, qbody = null, qroot = null, paneSeq = 0;
  const forced = new Set();
  const header = $('.site-header');

  const parseStack = () => {
    const raw = new URLSearchParams(location.search).get('stack') || '';
    const out = [];
    raw.split(',').map(s => normPath(s.trim())).forEach(p => { if (p !== '/' && p !== basePath && !out.includes(p)) out.push(p); });
    return out;
  };
  const stackUrl = s => baseSearchPath + (s.length ? `?stack=${s.map(x => x.split('/').map(encodeURIComponent).join('/')).join(',')}` : '');
  const setTop = () => { if (stackEl && header) stackEl.style.setProperty('--stack-top', `${header.offsetHeight}px`); };

  const fit = () => {
    if (!active) return;
    setTop();
    const avail = stackEl.clientWidth;
    const n = panes.length;
    const pw = avail >= 2 * PW_MAX ? PW_MAX : Math.max(480, Math.floor(avail / 2));
    stackEl.style.setProperty('--pw', `${pw}px`);
    const collapsed = new Set();
    const total = () => panes.reduce((s, _, i) => s + (collapsed.has(i) ? SPINE : pw), 0);
    [true, false].forEach(keepPrev => {
      for (let i = 0; i < n && total() > avail; i++) {
        if (collapsed.has(i) || i === n - 1 || forced.has(panes[i].path) || (keepPrev && i === n - 2)) continue;
        collapsed.add(i);
      }
    });
    panes.forEach((p, i) => {
      const c = collapsed.has(i);
      p.el.classList.toggle('collapsed', c);
      p.scroll.toggleAttribute('inert', c);
      p.spine.tabIndex = c ? 0 : -1;
      p.spine.setAttribute('aria-expanded', String(!c));
    });
  };
  const revealLast = () => {
    const last = panes[panes.length - 1];
    if (!last) return;
    const want = last.el.offsetLeft + last.el.offsetWidth - stackEl.clientWidth;
    if (want > stackEl.scrollLeft) stackEl.scrollTo({ left: want, behavior: behavior() });
  };

  const buildPaneShell = (path, title, isBase) => {
    const el = document.createElement('section');
    el.className = 'pane';
    el.dataset.path = path;
    el.setAttribute('aria-label', title);
    el.innerHTML = `<button type="button" class="pane-spine" aria-label="Expand ${esc(title)}" aria-expanded="true" tabindex="-1"><span>${esc(title)}</span></button>${isBase ? '' : '<button type="button" class="pane-close">close</button>'}<div class="pane-scroll"><div class="pane-inner"></div></div>`;
    const p = { path, el, title, spine: $('.pane-spine', el), scroll: $('.pane-scroll', el), inner: $('.pane-inner', el) };
    p.spine.addEventListener('click', () => {
      forced.add(path); fit();
      stackEl.scrollTo({ left: Math.max(0, el.offsetLeft - SPINE * panes.indexOf(p)), behavior: behavior() });
      p.scroll.focus({ preventScroll: true });
    });
    const close = $('.pane-close', el);
    if (close) close.addEventListener('click', () => { const i = panes.indexOf(p); go(stack.slice(0, i - 1), true); });
    return p;
  };

  const activate = () => {
    if (active) return true;
    qbody = $('#quartz-body');
    qroot = qbody && qbody.parentNode;
    if (!qbody) return false;
    active = true;
    const y = window.scrollY;
    stackEl = document.createElement('div');
    stackEl.className = 'stack';
    stackEl.setAttribute('role', 'region');
    stackEl.setAttribute('aria-label', 'Stacked notes');
    const title = ($('.article-title') || {}).textContent || document.title;
    const p0 = buildPaneShell(basePath, title.trim(), true);
    p0.inner.append(qbody);
    stackEl.append(p0.el);
    panes = [p0];
    root.classList.add('has-stack');
    header.after(stackEl);
    p0.scroll.scrollTop = y;
    teardownSidenotes();
    hideCard(true);
    requestAnimationFrame(updateFocus);
    return true;
  };
  const deactivate = () => {
    if (!active) return;
    const y = panes[0].scroll.scrollTop;
    qroot.append(qbody);
    stackEl.remove();
    stackEl = null; panes = []; active = false; forced.clear();
    root.classList.remove('has-stack');
    window.scrollTo(0, y);
    buildSidenotes();
    requestAnimationFrame(updateFocus);
  };

  const mountArticle = (p, note) => {
    const art = document.createElement('article');
    art.innerHTML = note.html;
    const uid = `p${++paneSeq}-`;
    $$('[id]', art).forEach(n => { n.id = uid + n.id; });
    $$('[aria-describedby]', art).forEach(n => n.setAttribute('aria-describedby', uid + n.getAttribute('aria-describedby')));
    $$('a[href]', art).forEach(a => {
      const h = a.getAttribute('href');
      if (h.startsWith('#')) { a.setAttribute('href', `#${uid}${h.slice(1)}`); return; }
      try { const u = new URL(h, note.base); if (u.origin === location.origin) a.setAttribute('href', u.pathname + u.search + u.hash); } catch { /* leave */ }
    });
    $$('[src]', art).forEach(n => { try { const u = new URL(n.getAttribute('src'), note.base); if (u.origin === location.origin) n.setAttribute('src', u.pathname + u.search); } catch { /* leave */ } });
    return art;
  };
  const loadPane = async p => {
    const e = known.get(p.path);
    const meta = [typeLabel(e), whenOf(e)].filter(Boolean).join(' · ');
    const head = t => `<div class="page-header"><h1 class="article-title" tabindex="-1">${esc(t)}</h1></div>${meta ? `<p class="pane-meta">${esc(meta)}</p>` : ''}`;
    p.inner.innerHTML = `${head((e && e.title) || p.title)}<p class="pane-note">Loading…</p>`;
    try {
      const note = await fetchNote(p.path);
      if (!p.el.isConnected) return;
      p.title = note.title;
      p.el.setAttribute('aria-label', note.title);
      p.spine.setAttribute('aria-label', `Expand ${note.title}`);
      $('span', p.spine).textContent = note.title;
      p.inner.innerHTML = head(note.title);
      p.inner.append(mountArticle(p, note));
      const h = $('.article-title', p.inner);
      if (p === panes[panes.length - 1] && !p.el.classList.contains('collapsed')) h.focus({ preventScroll: true });
      updateFocus();
    } catch {
      p.inner.innerHTML = `${head((e && e.title) || p.title)}<p class="pane-note">This note could not be loaded. <a data-nostack href="${esc(pageHref(p.path))}">Open it on its own page</a>.</p>`;
    }
  };

  const render = () => {
    if (!stack.length) { deactivate(); return; }
    if (!stackMQ.matches) return;
    if (!activate()) return;
    let i = 0;
    while (i < stack.length && panes[i + 1] && panes[i + 1].path === stack[i]) i++;
    panes.slice(i + 1).forEach(p => p.el.remove());
    panes.length = i + 1;
    const fresh = [];
    for (let j = i; j < stack.length; j++) {
      const e = known.get(stack[j]);
      const p = buildPaneShell(stack[j], (e && e.title) || stack[j], false);
      stackEl.append(p.el);
      panes.push(p);
      fresh.push(p);
      p.el.classList.add('enter');
    }
    forced.forEach(path => { if (!panes.some(p => p.path === path)) forced.delete(path); });
    fit();
    fresh.forEach(loadPane);
    revealLast();
  };

  /* change the stack and the URL together */
  const go = (next, push) => {
    stack = next;
    if (push && stackUrl(stack) !== location.pathname + location.search) history.pushState({ stack }, '', stackUrl(stack));
    forced.clear();
    render();
  };
  const openFrom = (fromIdx, path) => {
    const kept = stack.slice(0, fromIdx);
    if (path === basePath) {
      if (!active) return;
      go(kept, true); forced.add(basePath); fit();
      stackEl.scrollTo({ left: 0, behavior: behavior() });
      return;
    }
    const at = kept.indexOf(path);
    if (at >= 0) { go(kept, true); return; }
    go([...kept, path], true);
  };

  document.addEventListener('click', e => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (!stackMQ.matches || !stackReady) return;
    const a = e.target.closest && e.target.closest('a[href]:not([data-nostack])');
    if (!a || !linkScope(a)) return;
    const t = targetOf(a);
    if (!t) return;
    const pane = a.closest('.pane');
    const idx = pane ? panes.findIndex(p => p.el === pane) : 0;
    if (t.path === (pane ? pane.dataset.path : basePath)) return;
    e.preventDefault();
    hideCard(true);
    openFrom(Math.max(idx, 0), t.path);
  });
  window.addEventListener('popstate', () => {
    if (!stackReady) return;
    stack = parseStack();
    render();
  });
  let stackReady = false;

  /* ================================================================
     3. Linked from (backlinks with context)
  ================================================================ */
  const ctxHtml = c => {
    const a = c.indexOf('⁣');
    const b = a >= 0 ? c.indexOf('⁤', a) : -1;
    const strip = s => esc(s.replace(/[⁣⁤]/g, ''));
    if (a < 0 || b < 0) return strip(c);
    return `${strip(c.slice(0, a))}<mark class="lf-mark">${strip(c.slice(a + 1, b))}</mark>${strip(c.slice(b + 1))}`;
  };

  /* ================================================================
     6. Local graph
  ================================================================ */
  const GW = 640, GH = 220, GV = 1.8;
  const graphOf = (links, here) => {
    const nodes = new Map((links.nodes || []).map(n => [n.url, n]));
    if (!nodes.has(here)) return null;
    const adj = new Map();
    const add = (a, b) => { if (!adj.has(a)) adj.set(a, new Set()); adj.get(a).add(b); };
    (links.edges || []).forEach(([a, b]) => { if (nodes.has(a) && nodes.has(b) && a !== b) { add(a, b); add(b, a); } });
    const direct = [...(adj.get(here) || [])].sort((a, b) => nodes.get(a).title.localeCompare(nodes.get(b).title));
    if (!direct.length) return null;
    const ds = new Set(direct);
    const count = new Map();
    direct.forEach(d => (adj.get(d) || new Set()).forEach(n => { if (n !== here && !ds.has(n)) count.set(n, (count.get(n) || 0) + 1); }));
    const second = [...count.entries()].sort((a, b) => b[1] - a[1] || nodes.get(a[0]).title.localeCompare(nodes.get(b[0]).title)).slice(0, 14).map(x => x[0]);
    const ids = [here, ...direct, ...second];
    const idx = new Map(ids.map((u, i) => [u, i]));
    const edges = [];
    ids.forEach(a => (adj.get(a) || new Set()).forEach(b => { if (idx.has(b) && idx.get(a) < idx.get(b)) edges.push([idx.get(a), idx.get(b)]); }));
    /* layout in a taller virtual space (y is squashed at the end) so the force model stays roughly isotropic */
    const VW = GW, VH = GH * GV, cx = VW / 2, cy = VH / 2;
    const P = ids.map((u, i) => {
      if (i === 0) return { x: cx, y: cy, r: 0 };
      const k = direct.length, j = i - 1;
      if (j < k) { const t = -Math.PI / 2 + ((j + 0.5) / k) * Math.PI * 2; return { x: cx + Math.cos(t) * 140, y: cy + Math.sin(t) * 105 }; }
      const nb = direct.filter(d => (adj.get(d) || new Set()).has(u)).map(d => -Math.PI / 2 + ((direct.indexOf(d) + 0.5) / k) * Math.PI * 2);
      const t = nb.length ? Math.atan2(nb.reduce((s, v) => s + Math.sin(v), 0), nb.reduce((s, v) => s + Math.cos(v), 0)) + ((j - k) % 3 - 1) * 0.22 : (j - k) * 0.7;
      return { x: cx + Math.cos(t) * 255, y: cy + Math.sin(t) * 165 };
    });
    P.forEach(p => { p.vx = 0; p.vy = 0; });
    const padX = 34, padY = 26 * GV;
    const iters = 320;
    for (let it = 0; it < iters; it++) {
      const temp = 1 - it / iters * 0.92;
      for (let i = 0; i < P.length; i++) {
        for (let j = i + 1; j < P.length; j++) {
          let dx = P[i].x - P[j].x, dy = P[i].y - P[j].y;
          const d2 = dx * dx + dy * dy + 0.5, d = Math.sqrt(d2), f = 2600 / d2;
          dx /= d; dy /= d;
          P[i].vx += dx * f; P[i].vy += dy * f; P[j].vx -= dx * f; P[j].vy -= dy * f;
        }
      }
      edges.forEach(([a, b]) => {
        const dx = P[b].x - P[a].x, dy = P[b].y - P[a].y, d = Math.sqrt(dx * dx + dy * dy) + 0.01;
        const rest = (a === 0 || b === 0) ? 100 : 75, f = (d - rest) * 0.07;
        P[a].vx += dx / d * f; P[a].vy += dy / d * f; P[b].vx -= dx / d * f; P[b].vy -= dy / d * f;
      });
      P.forEach((p, i) => {
        if (i === 0) { p.x = cx; p.y = cy; return; }
        p.vx += (cx - p.x) * 0.006; p.vy += (cy - p.y) * 0.006;
        const m = Math.hypot(p.vx, p.vy) || 1, step = Math.min(m, 14) * temp;
        p.x = Math.min(VW - padX, Math.max(padX, p.x + p.vx / m * step));
        p.y = Math.min(VH - padY, Math.max(padY, p.y + p.vy / m * step));
        p.vx *= 0.4; p.vy *= 0.4;
      });
    }
    /* stretch the settled layout to fill the frame */
    const xs = P.map(p => p.x), ys = P.map(p => p.y / GV);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const fx = x1 - x0 > 1 ? (GW - 2 * 40) / (x1 - x0) : 1, fy = y1 - y0 > 1 ? (GH - 2 * 30) / (y1 - y0) : 1;
    const out = P.map(p => ({ x: 40 + (p.x - x0) * Math.min(fx, 2.4) + Math.max(0, (GW - 80 - (x1 - x0) * Math.min(fx, 2.4)) / 2), y: 30 + (p.y / GV - y0) * Math.min(fy, 2.4) + Math.max(0, (GH - 60 - (y1 - y0) * Math.min(fy, 2.4)) / 2) }));
    return { ids, nodes, P: out, edges, nDirect: direct.length };
  };
  const graphSvg = g => {
    const level = i => (i === 0 ? 0 : i <= g.nDirect ? 1 : 2);
    const lines = g.edges.map(([a, b]) => {
      const l = Math.max(level(a), level(b));
      return `<line class="lg-edge lg-l${l}${a === 0 || b === 0 ? ' lg-cur' : ''}" x1="${g.P[a].x.toFixed(1)}" y1="${g.P[a].y.toFixed(1)}" x2="${g.P[b].x.toFixed(1)}" y2="${g.P[b].y.toFixed(1)}"/>`;
    }).join('');
    const dots = g.ids.map((u, i) => {
      const n = g.nodes.get(u), p = g.P[i], l = level(i);
      const r = l === 0 ? 5 : l === 1 ? 3.6 : 2.6;
      const inner = `<circle class="lg-hit" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="11"/><circle class="lg-dot" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r}"/>`;
      return l === 0
        ? `<g class="lg-node lg-l0" data-i="${i}"><title>${esc(n.title)} (this note)</title>${inner}</g>`
        : `<a class="lg-node lg-l${l}" data-i="${i}" data-nostack href="${esc(pageHref(u))}" aria-label="${esc(n.title)}"><title>${esc(n.title)}</title>${inner}</a>`;
    }).join('');
    const labels = g.ids.map((u, i) => {
      const n = g.nodes.get(u), p = g.P[i];
      const t = n.title.length > 44 ? `${n.title.slice(0, 43)}…` : n.title;
      const w = t.length * 6.3;
      const anchor = p.x < w / 2 + 6 ? 'start' : p.x > GW - w / 2 - 6 ? 'end' : 'middle';
      const x = anchor === 'start' ? Math.max(4, p.x - 6) : anchor === 'end' ? Math.min(GW - 4, p.x + 6) : p.x;
      const y = p.y < 20 ? p.y + 20 : p.y - 10;
      return `<text class="lg-label${i === 0 ? ' lg-label-cur on' : ''}" data-i="${i}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}">${esc(t)}</text>`;
    }).join('');
    return `<svg class="lg-svg" viewBox="0 0 ${GW} ${GH}" role="group" aria-label="Notes linked to and from this note"><g class="lg-edges">${lines}</g><g class="lg-nodes">${dots}</g><g class="lg-labels">${labels}</g></svg>`;
  };
  const wireGraph = box => {
    const lab = i => $(`.lg-label[data-i="${i}"]`, box);
    const set = (el, on) => { const l = lab(el.dataset.i); if (l && !l.classList.contains('lg-label-cur')) l.classList.toggle('on', on); };
    $$('.lg-node', box).forEach(n => {
      n.addEventListener('mouseenter', () => set(n, true));
      n.addEventListener('mouseleave', () => set(n, false));
      n.addEventListener('focus', () => set(n, true));
      n.addEventListener('blur', () => set(n, false));
    });
  };

  const renderAfter = links => {
    const art = $('article');
    if (!art) return;
    const bq = $('.backlinks');
    if (bq) bq.hidden = true;
    const here = basePath;
    const back = (links && links.backlinks && links.backlinks[here]) || [];
    const g = links ? graphOf(links, here) : null;
    if (!back.length && !g) return;
    const sec = document.createElement('div');
    sec.className = 'note-after';
    if (g) {
      sec.insertAdjacentHTML('beforeend', `<section class="local-graph" aria-labelledby="lg-h"><h3 class="na-h" id="lg-h">Connections</h3>${graphSvg(g)}</section>`);
      wireGraph(sec);
    }
    if (back.length) {
      const items = back.map(b => {
        const lbl = typeLabel(known.get(b.url)) || TYPE_LABEL[b.type] || '';
        return `<li><a class="lf-title" href="${esc(pageHref(b.url))}">${esc(b.title)}</a>${lbl ? `<span class="lf-type">${esc(lbl)}</span>` : ''}${b.context ? `<p class="lf-ctx">${ctxHtml(b.context)}</p>` : ''}</li>`;
      }).join('');
      sec.insertAdjacentHTML('beforeend', `<section class="linked-from" aria-labelledby="lf-h"><h3 class="na-h" id="lf-h">Linked from</h3><ul>${items}</ul></section>`);
    }
    art.after(sec);
  };

  /* ================================================================
     4. Sidenotes
  ================================================================ */
  let sideItems = [], sideRO = null, sideArt = null;
  const layoutSidenotes = () => {
    if (!sideItems.length || !sideArt) return;
    const ar = sideArt.getBoundingClientRect();
    let floor = 0;
    sideItems.map(it => ({ it, top: it.ref.getBoundingClientRect().top - ar.top - 3 })).sort((a, b) => a.top - b.top).forEach(({ it, top }) => {
      const t = Math.max(top, floor);
      it.el.style.top = `${Math.round(t)}px`;
      floor = t + it.el.offsetHeight + 10;
    });
  };
  function teardownSidenotes() {
    if (sideRO) { sideRO.disconnect(); sideRO = null; }
    sideItems.forEach(it => it.el.remove());
    sideItems = [];
    if (sideArt) sideArt.classList.remove('has-sidenotes');
    sideArt = null;
    root.classList.remove('has-sidenotes');
  }
  function buildSidenotes() {
    teardownSidenotes();
    if (!sideMQ.matches || active) return;
    const art = $('article');
    if (!art) return;
    const refs = $$('a[data-footnote-ref]', art);
    if (!refs.length) return;
    const items = [];
    refs.forEach(ref => {
      let id = (ref.getAttribute('href') || '').replace(/^#/, '');
      try { id = decodeURIComponent(id); } catch { /* raw */ }
      const li = id && document.getElementById(id);
      if (!li) return;
      const clone = li.cloneNode(true);
      $$('[data-footnote-backref], .footnote-backref, a[href^="#user-content-fnref"]', clone).forEach(n => n.remove());
      const el = document.createElement('aside');
      el.className = 'sidenote';
      el.dataset.for = id;
      el.innerHTML = `<span class="sn-num">${esc(ref.textContent.trim())}</span><div class="sn-body">${clone.innerHTML}</div>`;
      items.push({ ref, el });
    });
    if (!items.length) return;
    sideArt = art;
    art.classList.add('has-sidenotes');
    items.forEach(it => art.append(it.el));
    sideItems = items;
    root.classList.add('has-sidenotes');
    layoutSidenotes();
    sideRO = new ResizeObserver(layoutSidenotes);
    sideRO.observe(art);
  }
  let snTimer = 0;
  document.addEventListener('click', e => {
    const ref = e.target.closest && e.target.closest('a[data-footnote-ref]');
    if (!ref || !sideItems.length) return;
    const it = sideItems.find(x => x.ref === ref);
    if (!it) return;
    e.preventDefault();
    sideItems.forEach(x => x.el.classList.remove('active'));
    it.el.classList.add('active');
    const r = it.el.getBoundingClientRect();
    if (r.top < 70 || r.bottom > window.innerHeight - 20) window.scrollBy({ top: r.top - window.innerHeight * 0.3, behavior: behavior() });
    clearTimeout(snTimer);
    snTimer = setTimeout(() => it.el.classList.remove('active'), 3200);
  });

  /* ================================================================
     5. Reading focus
  ================================================================ */
  const FOCUS_KEY = 'reading-focus';
  let focusOn = lsGet(FOCUS_KEY) === '1';
  const focusState = new WeakMap(); // article -> {blocks, bar, cur}
  const blocksOf = art => {
    let s = focusState.get(art);
    if (s) return s;
    const blocks = $$('p, li, blockquote, h2, h3, h4', art).filter(b => !b.closest('.footnotes, section[data-footnotes], .sidenote, .activity-panel, table, .note-meta, .note-after') && !(b.tagName === 'P' && b.parentElement.closest('blockquote') && art.contains(b.parentElement.closest('blockquote'))) && b.textContent.trim());
    blocks.forEach(b => b.classList.add('rf-block'));
    const bar = document.createElement('span');
    bar.className = 'rf-bar'; bar.setAttribute('aria-hidden', 'true');
    art.append(bar);
    s = { blocks, bar, cur: null };
    focusState.set(art, s);
    return s;
  };
  let focusRaf = 0;
  function updateFocus() {
    focusRaf = 0;
    if (!focusOn) return;
    $$('article').forEach(art => {
      if (!art.getClientRects().length) return;
      const s = blocksOf(art);
      const sc = art.closest('.pane-scroll');
      const vr = sc ? sc.getBoundingClientRect() : { top: 0, bottom: window.innerHeight, height: window.innerHeight };
      const line = vr.top + vr.height * 0.35;
      const ar = art.getBoundingClientRect();
      let best = null, bestH = Infinity, near = null, nearD = Infinity;
      if (ar.bottom > vr.top && ar.top < vr.bottom) {
        s.blocks.forEach(b => {
          const r = b.getBoundingClientRect();
          if (!r.height) return;
          if (r.top <= line && r.bottom >= line) { if (r.height < bestH) { best = b; bestH = r.height; } }
          else { const d = Math.min(Math.abs(r.top - line), Math.abs(r.bottom - line)); if (d < nearD) { near = b; nearD = d; } }
        });
      }
      const pick = best || (nearD < 140 ? near : null);
      if (pick !== s.cur) {
        if (s.cur) s.cur.classList.remove('rf-active');
        if (pick) pick.classList.add('rf-active');
        s.cur = pick;
      }
      if (pick) {
        const r = pick.getBoundingClientRect();
        s.bar.style.transform = `translateY(${Math.round(r.top - ar.top)}px)`;
        s.bar.style.height = `${Math.round(r.height)}px`;
        s.bar.classList.add('on');
      } else s.bar.classList.remove('on');
    });
  }
  const queueFocus = () => { if (focusOn && !focusRaf) focusRaf = requestAnimationFrame(updateFocus); };
  const applyFocus = on => {
    focusOn = on;
    if (on) root.setAttribute('data-focus', 'on'); else root.removeAttribute('data-focus');
    if (on) updateFocus();
    else $$('article').forEach(a => { const s = focusState.get(a); if (s) { if (s.cur) s.cur.classList.remove('rf-active'); s.cur = null; s.bar.classList.remove('on'); } });
  };
  window.addEventListener('scroll', queueFocus, { capture: true, passive: true });
  window.addEventListener('resize', queueFocus);

  const readingBtn = $('.reading-toggle');
  if (readingBtn) {
    const fb = document.createElement('button');
    fb.type = 'button';
    fb.className = 'reading-toggle focus-toggle';
    fb.textContent = 'Focus';
    fb.title = 'Highlight the paragraph you are reading';
    fb.setAttribute('aria-pressed', String(focusOn));
    readingBtn.before(fb);
    fb.addEventListener('click', () => {
      const on = !focusOn;
      fb.setAttribute('aria-pressed', String(on));
      lsSet(FOCUS_KEY, on ? '1' : '0');
      applyFocus(on);
    });
  }
  if (focusOn) applyFocus(true);

  /* ================================================================
     boot + responsive wiring
  ================================================================ */
  buildSidenotes();
  window.addEventListener('load', () => { layoutSidenotes(); queueFocus(); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { layoutSidenotes(); queueFocus(); });
  onMQ(sideMQ, buildSidenotes);
  let resizeT = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => {
      if (active) { if (!stackMQ.matches) { deactivate(); } else fit(); }
      else if (stackMQ.matches && stackReady) { stack = parseStack(); render(); }
      layoutSidenotes();
    }, 80);
  });

  Promise.all([siteReady, linksReady]).then(([, links]) => {
    renderAfter(links);
    stackReady = true;
    stack = parseStack().filter(stackable);
    if (stack.length && stackMQ.matches) render();
    queueFocus();
  });
})();
