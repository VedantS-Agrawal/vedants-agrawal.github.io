/* Public front end: renders /, /stream/, /writing/, /stream/training/, /library/ (and /projects/), /archive/ from
   /site-data.json, /data/training.json and (optionally) /data/wellness.json. Hand-written SVG, no libraries. */
(() => {
  'use strict';

  /* ================================================================
     Helpers
  ================================================================ */
  const app = document.getElementById('app');
  const path = decodeURI(location.pathname).replace(/\/index\.html$/, '/').replace(/\/+$/, '') || '/';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = v => { try { const u = new URL(v, location.origin); return ['http:', 'https:'].includes(u.protocol) ? u.href : '#'; } catch { return '#'; } };
  const cap = s => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
  const pad = n => String(n).padStart(2, '0');
  /* tags: lowercase, no leading #; entries without `tags` fall back to `topics` */
  const tagsOf = e => [...new Set((Array.isArray(e.tags) ? e.tags : Array.isArray(e.topics) ? e.topics : []).map(t => String(t).toLowerCase().replace(/^#/, '').trim()).filter(Boolean))];
  const tagBtn = (t, on, extra = '') => `<button type="button" class="tag${extra}" data-tag="${esc(t)}" data-topic="${esc(t)}" aria-pressed="${on}" aria-label="Filter by tag ${esc(t)}"><span class="h" aria-hidden="true">#</span>${esc(t)}</button>`;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let uidN = 0;
  const uid = p => `${p}${++uidN}`;

  /* Entry urls have no .html; Quartz writes /<slug>.html */
  const href = e => {
    const u = String(e.url || '');
    return safeUrl(u.startsWith('/') && !u.endsWith('/') && !/\.html(?:[?#]|$)/.test(u) ? `${u}.html` : u);
  };
  const urlHref = u => href({ url: u });

  /* ---- dates (all 'YYYY-MM-DD' strings; arithmetic via UTC day numbers) ---- */
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayStr = () => ymd(new Date());
  const isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
  const parse = s => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d, 12); };
  const dayNum = s => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 864e5); };
  const fromNum = n => { const d = new Date(n * 864e5); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
  const addDays = (s, n) => fromNum(dayNum(s) + n);
  const weekStart = s => { const n = dayNum(s); return fromNum(n - ((new Date(n * 864e5).getUTCDay() + 6) % 7)); };
  const daysInYear = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365;
  const doy = s => dayNum(s) - dayNum(`${s.slice(0, 4)}-01-01`) + 1;
  const DATE_FMT = {
    long: { month: 'short', day: 'numeric', year: 'numeric' },
    day: { weekday: 'short', month: 'short', day: 'numeric' },
    md: { month: 'short', day: 'numeric' },
    month: { month: 'long', year: 'numeric' },
    mon: { month: 'short' },
    monthName: { month: 'long' },
    monY: { month: 'short', year: 'numeric' },
    dow1: { weekday: 'narrow' },
  };
  const fmtCache = {};
  const fd = (s, kind = 'long') => (fmtCache[kind] ??= new Intl.DateTimeFormat('en-US', DATE_FMT[kind])).format(parse(String(s).length === 7 ? `${s}-01` : s));
  const MONTH_STARTS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

  /* ---- numbers ---- */
  const nf = (n, max = 1) => new Intl.NumberFormat('en-US', { maximumFractionDigits: max }).format(n);
  const fmtDur = s => {
    s = Math.round(s || 0);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    if (h) return `${h}h ${pad(m)}m`;
    if (m) return `${m} min`;
    return `${s} s`;
  };
  const fmtHours = h => fmtDur(h * 3600);
  /* imperial display; the data files stay metric. Swims read in yards, everything else in miles. */
  const MI = 1.609344, YD = 1093.61;
  const fmtMi = km => { const mi = km / MI; return nf(mi, mi >= 10 ? 1 : 2); };
  const fmtYd = km => { const yd = km * YD; return nf(yd < 100 ? Math.round(yd) : Math.round(yd / 10) * 10, 0); };
  const distStr = (group, km) => (group === 'swim' ? `${fmtYd(km)} yd` : `${fmtMi(km)} mi`);
  const niceCeil = v => {
    if (!(v > 0)) return 1;
    const p = 10 ** Math.floor(Math.log10(v)), f = v / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  };
  const lerp = (a, b, t) => a + (b - a) * t;
  const mixColor = (c1, c2, t) => {
    const p = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
    const a = p(c1), b = p(c2);
    return `rgb(${a.map((v, i) => Math.round(lerp(v, b[i], t))).join(',')})`;
  };
  /* purple -> orange by training minutes */
  const rampColor = mins => mixColor('#4a3a66', '#e8943f', Math.min(1, Math.sqrt(Math.max(0, mins) / 150)));
  /* chart colours (app pages are always dark): series is the default, orange marks current/selected */
  const COL = { series: '#9b84c4', dim: 'rgba(155,132,196,.35)', accent: '#ff9a3c', text: '#ece6f1', muted: '#a395b5', faint: '#6e6083', empty: 'rgba(194,179,210,.07)' };

  /* ================================================================
     Data
  ================================================================ */
  const GROUPS = ['run', 'ride', 'swim', 'strength', 'walk', 'hike', 'other'];
  const GROUP_LABEL = { run: 'Run', ride: 'Ride', swim: 'Swim', strength: 'Strength', walk: 'Walk', hike: 'Hike', other: 'Other' };
  const guessGroup = sport => {
    const s = String(sport || '').toLowerCase();
    return /run|jog|treadmill/.test(s) ? 'run' : /cycl|ride|bike/.test(s) ? 'ride' : /swim/.test(s) ? 'swim'
      : /strength|weight/.test(s) ? 'strength' : /walk/.test(s) ? 'walk' : /hike/.test(s) ? 'hike' : 'other';
  };
  /* Accepts the training.json shape and the older entry.activity shape */
  const normAct = a => ({
    id: String(a.id ?? ''),
    url: a.url || '',
    date: String(a.date || '').slice(0, 10),
    start: Number(a.start) || 0,
    sport: a.sport || 'Other',
    group: GROUPS.includes(a.group) ? a.group : guessGroup(a.sport),
    durationS: Number(a.durationS ?? a.durationSeconds) || 0,
    distanceKm: Number(a.distanceKm) || 0,
    elevGainM: a.elevGainM == null ? null : Number(a.elevGainM),
    avgHr: (a.avgHr ?? a.avgHeartRate) == null ? null : Number(a.avgHr ?? a.avgHeartRate),
    load: a.load == null ? null : Number(a.load),
    title: a.title || '',
  });
  const actName = a => (a.group === 'other' || !GROUP_LABEL[a.group] ? a.sport : GROUP_LABEL[a.group]);
  const actSort = (a, b) => b.date.localeCompare(a.date) || b.start - a.start;

  const cleanEntries = data => (Array.isArray(data.entries) ? data.entries : [])
    .filter(e => e && e.title && e.url && e.type)
    .map(e => {
      const date = String(e.date || e.published || '').slice(0, 10);
      const act = e.type === 'activity' && e.activity ? normAct({ ...e.activity, url: e.url, title: e.title, date: e.activity.date || date }) : null;
      return { ...e, date, _act: act };
    })
    .filter(e => isDay(e.date) && (e.type !== 'activity' || e._act));
  const byDateDesc = (a, b) => b.date.localeCompare(a.date) || String(b.published || '').localeCompare(String(a.published || ''));

  let trainingPromise;
  const finishTraining = t => {
    const acts = (t.activities || []).map(normAct).filter(a => isDay(a.date)).sort(actSort);
    const c = t.coverage || {};
    const start = isDay(c.start) ? c.start : acts.length ? acts[acts.length - 1].date : '';
    const end = isDay(c.end) ? c.end : acts.length ? acts[0].date : '';
    const blocks = (t.blocks || []).filter(b => b && b.title && isDay(b.start) && isDay(b.end)).sort((a, b) => a.start.localeCompare(b.start));
    return { coverage: { start, end, lastSync: c.lastSync || '' }, blocks, activities: acts };
  };
  const loadTraining = (data, entries) => (trainingPromise ??= (async () => {
    try {
      const r = await fetch('/data/training.json', { cache: 'no-cache' });
      if (!r.ok) throw new Error('missing');
      return finishTraining(await r.json());
    } catch {
      const c = data.training || {};
      return finishTraining({ coverage: { start: c.coverageStart, end: c.coverageEnd, lastSync: c.lastSync }, blocks: [], activities: entries.filter(e => e._act).map(e => e._act) });
    }
  })());

  /* ---- wellness (optional /data/wellness.json; a 404 just means "no wellness") ---- */
  const WELL_KEYS = ['sleepS', 'deepS', 'lightS', 'remS', 'awakeS', 'sleepScore', 'hrv', 'hrvLow', 'hrvHigh', 'restingHr', 'avgHr', 'stress', 'steps', 'calories', 'acuteLoad', 'chronicLoad', 'loadRatio', 'recoveryPct'];
  const normWell = d => {
    const o = { date: String(d.date).slice(0, 10) };
    WELL_KEYS.forEach(k => { const v = d[k]; if (v != null && v !== '' && Number.isFinite(Number(v))) o[k] = Number(v); });
    return o;
  };
  let wellPromise;
  const loadWellness = () => (wellPromise ??= (async () => {
    try {
      const r = await fetch('/data/wellness.json', { cache: 'no-cache' });
      if (!r.ok) return null;
      const j = await r.json();
      const days = (Array.isArray(j.days) ? j.days : []).filter(d => d && isDay(String(d.date || '').slice(0, 10))).map(normWell)
        .filter(d => Object.keys(d).length > 1).sort((a, b) => a.date.localeCompare(b.date));
      return days.length ? { days, map: new Map(days.map(d => [d.date, d])) } : null;
    } catch { return null; }
  })());
  const fmtSleep = s => { let h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); if (m === 60) { h++; m = 0; } return `${h}h${pad(m)}`; };
  const wellLine = w => {
    const p = [];
    if (w.sleepS != null) p.push(`sleep ${fmtSleep(w.sleepS)}`);
    if (w.hrv != null) p.push(`HRV ${nf(w.hrv, 0)}`);
    if (w.restingHr != null) p.push(`RHR ${nf(w.restingHr, 0)}`);
    if (w.acuteLoad != null) p.push(`load ${nf(w.acuteLoad, 0)}${w.chronicLoad != null ? `/${nf(w.chronicLoad, 0)}` : ''}`);
    else if (w.chronicLoad != null) p.push(`load –/${nf(w.chronicLoad, 0)}`);
    if (!p.length) {
      if (w.recoveryPct != null) p.push(`recovery ${nf(w.recoveryPct, 0)}%`);
      if (w.steps != null) p.push(`steps ${nf(w.steps, 0)}`);
      if (w.stress != null) p.push(`stress ${nf(w.stress, 0)}`);
    }
    return p.join(' · ');
  };
  const STAGES = [['deep', 'Deep', 'deepS'], ['light', 'Light', 'lightS'], ['rem', 'REM', 'remS'], ['awake', 'Awake', 'awakeS']];
  const wellCard = w => {
    const blocks = [];
    const st = STAGES.map(([k, l, f]) => ({ k, l, v: w[f] })).filter(x => x.v > 0);
    if (w.sleepS != null || st.length) {
      const tot = st.reduce((a, x) => a + x.v, 0);
      const seg = st.map(x => `<span class="seg-${x.k}" style="flex:${x.v} 1 0">${x.l}</span>`).join('');
      const lab = st.map(x => `${x.l} ${fmtSleep(x.v)}`).join(', ');
      blocks.push(`<div class="wc-block wide"><p class="wc-h">Sleep${w.sleepS != null ? `<span>${fmtSleep(w.sleepS)}</span>` : ''}${w.sleepScore != null ? `<span class="q">score ${nf(w.sleepScore, 0)}</span>` : ''}</p>${tot ? `<div class="stages" role="img" aria-label="Sleep stages: ${esc(lab)}">${seg}</div><ul class="stage-key" aria-hidden="true">${st.map(x => `<li><i class="seg-${x.k}"></i>${x.l} ${fmtSleep(x.v)}</li>`).join('')}</ul>` : ''}</div>`);
    }
    if (w.hrv != null) {
      let bar = '';
      if (w.hrvLow != null && w.hrvHigh != null && w.hrvHigh > w.hrvLow) {
        const lo = Math.min(w.hrvLow, w.hrv), hi = Math.max(w.hrvHigh, w.hrv), pd = (hi - lo) * .15 || 5, a = lo - pd, b = hi + pd;
        const pc = v => `${((v - a) / (b - a) * 100).toFixed(1)}%`;
        bar = `<div class="range" role="img" aria-label="HRV ${nf(w.hrv, 0)}, normal range ${nf(w.hrvLow, 0)} to ${nf(w.hrvHigh, 0)}"><i class="band" style="left:${pc(w.hrvLow)};width:${((w.hrvHigh - w.hrvLow) / (b - a) * 100).toFixed(1)}%"></i><i class="mark" style="left:${pc(w.hrv)}"></i></div><p class="range-cap"><span>${nf(w.hrvLow, 0)}</span><span>normal range</span><span>${nf(w.hrvHigh, 0)}</span></p>`;
      }
      blocks.push(`<div class="wc-block"><p class="wc-h">HRV<span>${nf(w.hrv, 0)}</span></p>${bar}</div>`);
    }
    const kv = [];
    if (w.restingHr != null) kv.push(['Resting HR', `${nf(w.restingHr, 0)}`]);
    if (w.avgHr != null) kv.push(['Average HR', `${nf(w.avgHr, 0)}`]);
    if (w.stress != null) kv.push(['Stress', `${nf(w.stress, 0)}`]);
    if (w.steps != null) kv.push(['Steps', nf(w.steps, 0)]);
    if (w.calories != null) kv.push(['Calories', nf(w.calories, 0)]);
    if (w.acuteLoad != null || w.chronicLoad != null) kv.push(['Load acute / chronic', `${w.acuteLoad != null ? nf(w.acuteLoad, 0) : '–'} / ${w.chronicLoad != null ? nf(w.chronicLoad, 0) : '–'}`]);
    if (w.loadRatio != null) kv.push(['Load ratio', nf(w.loadRatio, 2)]);
    if (w.recoveryPct != null) kv.push(['Recovery', `${nf(w.recoveryPct, 0)}%`]);
    if (kv.length) blocks.push(`<dl class="wc-kv">${kv.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`);
    return `<div class="well-card">${blocks.join('')}</div>`;
  };
  const wellHtml = (w, date) => {
    const line = w && wellLine(w);
    if (!line) return '';
    const id = uid('wc');
    return `<div class="well"><button type="button" class="well-line" aria-expanded="false" aria-controls="${id}"><span class="sr-only">Wellness for ${esc(fd(date, 'day'))}: </span>${esc(line)}</button><div id="${id}" hidden>${wellCard(w)}</div></div>`;
  };
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('.well-line');
    if (!b) return;
    const panel = document.getElementById(b.getAttribute('aria-controls'));
    const open = b.getAttribute('aria-expanded') !== 'true';
    b.setAttribute('aria-expanded', String(open));
    if (panel) panel.hidden = !open;
  });

  const dayMap = acts => {
    const m = new Map();
    acts.forEach(a => {
      const o = m.get(a.date) || { s: 0, km: 0, n: 0, acts: [] };
      o.s += a.durationS; o.km += a.distanceKm; o.n++; o.acts.push(a);
      m.set(a.date, o);
    });
    return m;
  };
  const sumActs = acts => acts.reduce((o, a) => ({ s: o.s + a.durationS, km: o.km + a.distanceKm, n: o.n + 1 }), { s: 0, km: 0, n: 0 });
  const inCoverage = (cov, d) => cov.start && cov.end && d >= cov.start && d <= cov.end;
  const blockFor = (blocks, d) => blocks.find(b => d >= b.start && d <= b.end);

  /* ================================================================
     Shared UI
  ================================================================ */
  const page = (html, wide = false) => { app.innerHTML = `<div class="page-wrap${wide ? ' wide' : ''}">${html}</div>`; };
  const setTitle = t => { document.title = t ? `${t} · Vedant Agrawal` : 'Vedant Agrawal'; };
  const head = (title, key, data, extra = '') => `<header class="page-head">${extra}<h1>${esc(title)}</h1><p class="desc">${esc((data.descriptions && data.descriptions[key]) || `[${title} description]`)}</p></header>`;
  const emptyState = t => `<p class="empty-state">${esc(t)}</p>`;

  /* tooltip (delegated, uses [data-tip] holding escaped HTML) */
  const tipEl = document.createElement('div');
  tipEl.className = 'tip'; tipEl.hidden = true; tipEl.setAttribute('role', 'presentation');
  document.body.append(tipEl);
  const showTip = (html, x, y) => {
    tipEl.innerHTML = html; tipEl.hidden = false;
    const r = tipEl.getBoundingClientRect();
    let left = x + 14, top = y + 16;
    if (left + r.width > innerWidth - 8) left = x - r.width - 14;
    if (top + r.height > innerHeight - 8) top = y - r.height - 14;
    tipEl.style.left = `${Math.max(8, left)}px`; tipEl.style.top = `${Math.max(8, top)}px`;
  };
  const hideTip = () => { tipEl.hidden = true; };
  const bindTip = c => {
    const h = e => {
      const t = e.target.closest && e.target.closest('[data-tip]');
      if (!t || !c.contains(t)) return hideTip();
      showTip(t.getAttribute('data-tip'), e.clientX, e.clientY);
    };
    c.addEventListener('pointermove', h);
    c.addEventListener('pointerdown', h);
    c.addEventListener('pointerleave', hideTip);
  };
  document.addEventListener('pointerdown', e => { if (!e.target.closest || !e.target.closest('[data-tip]')) hideTip(); });
  document.addEventListener('scroll', hideTip, { passive: true });

  /* responsive SVG: re-draws at the container's pixel width so text stays legible */
  const mount = (el, draw) => {
    let lastW = 0;
    const run = () => {
      const w = Math.floor(el.clientWidth);
      if (w < 10) return;
      lastW = w;
      const sl = el.scrollLeft;
      el.innerHTML = draw(w);
      el.scrollLeft = sl;
    };
    run();
    if ('ResizeObserver' in window) new ResizeObserver(() => { if (Math.floor(el.clientWidth) !== lastW) run(); }).observe(el);
    return run;
  };
  const hatchDef = id => `<defs><pattern id="${id}" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="4" stroke="#c2b3d2" stroke-opacity=".16" stroke-width="1"/></pattern></defs>`;

  /* ================================================================
     Timeline (Stream, Home, Archive)
  ================================================================ */
  const WRITING = new Set(['writing', 'reflection', 'concept', 'evergreen']);
  const STREAM_TYPES = new Set([...WRITING, 'photo', 'literature', 'project', 'activity']);
  const TYPE_LABEL = { writing: 'Writing', reflection: 'Reflection', concept: 'Concept', evergreen: 'Evergreen', photo: 'Photo', literature: 'Library', project: 'Project', activity: 'Training' };
  const STATUS_LABEL = { reading: 'Reading', finished: 'Finished', saved: 'Saved', abandoned: 'Set aside' };
  const FILTERS = [['all', 'All'], ['writing', 'Writing'], ['training', 'Training'], ['photos', 'Photos'], ['library', 'Library']];
  const filterOf = e => (e.type === 'activity' ? 'training' : e.type === 'photo' ? 'photos' : e.type === 'literature' || e.type === 'project' ? 'library' : 'writing');

  const photoHtml = (e, link) => {
    const imgs = e.images && e.images.length ? e.images : e.image ? [e.image] : [];
    if (!imgs.length) return '';
    const shown = imgs.slice(0, 4);
    return `<div class="photos n${shown.length > 1 ? 2 : 1}">${shown.map((src, i) => `<a href="${link}" tabindex="${i ? -1 : 0}"><img src="${safeUrl(src)}" alt="${esc(e.title)}${imgs.length > 1 ? ` (${i + 1} of ${imgs.length})` : ''}" loading="lazy" decoding="async"></a>`).join('')}</div>${imgs.length > 4 ? `<a class="photos-more" href="${link}">+${imgs.length - 4} more</a>` : ''}`;
  };
  const richHtml = e => {
    const link = href(e);
    let kicker = TYPE_LABEL[e.type] || cap(e.type);
    if (e.type === 'literature') kicker = [e.medium ? cap(e.medium) : 'Library', STATUS_LABEL[e.consumption_status]].filter(Boolean).join(' · ');
    const pill = e.type === 'project' && e.status ? `<span class="pill ${e.status === 'active' ? 'active' : ''}">${esc(e.status)}</span>` : '';
    const by = e.type === 'literature' && e.creator ? `<p class="by">${esc(e.creator)}</p>` : '';
    return `<article class="entry"><span class="kicker">${esc(kicker)}</span><h3><a href="${link}">${esc(e.title)}</a>${pill}</h3>${by}${e.summary ? `<p>${esc(e.summary)}</p>` : ''}${e.type === 'photo' ? photoHtml(e, link) : ''}</article>`;
  };
  const trainMetric = a => {
    if (['run', 'walk', 'hike', 'swim'].includes(a.group) && a.distanceKm > 0) {
      return distStr(a.group, a.distanceKm);
    }
    return a.durationS ? fmtDur(a.durationS) : '';
  };
  const trainLine = acts => `<p class="train-line"><span class="kicker">Training</span>${acts.map(a => `<a href="${urlHref(a.url)}">${esc(`${actName(a)} ${trainMetric(a)}`.trim())}</a>`).join('<span class="dot" aria-hidden="true">·</span>')}</p>`;

  const groupByDay = entries => {
    const m = new Map();
    [...entries].sort(byDateDesc).forEach(e => { if (!m.has(e.date)) m.set(e.date, []); m.get(e.date).push(e); });
    return [...m];
  };
  const dayHtml = (date, items, opts = {}, latest = false) => {
    const rich = items.filter(e => e.type !== 'activity');
    const train = items.filter(e => e.type === 'activity').map(e => e._act).sort((a, b) => a.start - b.start);
    const well = opts.well ? wellHtml(opts.well.get(date), date) : '';
    return `<li class="day ${rich.length ? 'rich' : 'train-only'}${latest ? ' latest' : ''}"><span class="node" aria-hidden="true"></span><div class="day-date"><time datetime="${date}">${esc(fd(date, 'day'))}</time></div>${well}${rich.map(richHtml).join('')}${train.length ? trainLine(train) : ''}</li>`;
  };
  const timelineHtml = (days, opts = {}) => {
    let out = '', lastM = '';
    days.forEach(([date, items], i) => {
      const m = date.slice(0, 7);
      if (opts.months && m !== lastM) {
        lastM = m;
        out += `<li class="month-sep"><h2><a href="/archive/${m}/">${esc(fd(m, 'month'))}</a></h2></li>`;
      }
      out += dayHtml(date, items, opts, !!opts.latest && i === 0);
    });
    return `<ol class="timeline">${out}</ol>`;
  };

  /* ================================================================
     Home
  ================================================================ */
  const projectsBlock = entries => {
    const act = entries.filter(e => e.type === 'project' && e.status === 'active').sort(byDateDesc);
    if (!act.length) return '';
    return `<section class="aside-block" aria-labelledby="h-proj"><h2 id="h-proj">Current projects</h2><ul class="aside-list">${act.map(p => `<li><a href="${href(p)}">${esc(p.title)}</a>${p.project_url ? `<a class="ext" href="${safeUrl(p.project_url)}" aria-label="Open ${esc(p.title)}">↗</a>` : ''}</li>`).join('')}</ul></section>`;
  };
  const weekBlock = training => {
    const acts = training.activities;
    if (!acts.length) return '';
    const cov = training.coverage;
    const end = todayStr();
    const from = addDays(end, -6);
    const within = (a, f, t) => a.date >= f && a.date <= t;
    const cur = sumActs(acts.filter(a => within(a, from, end)));
    const prev = sumActs(acts.filter(a => within(a, addDays(end, -34), addDays(end, -7))));
    const avg = { s: prev.s / 4, km: prev.km / 4, n: prev.n / 4 };
    const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
    const dm = dayMap(acts);
    const maxS = Math.max(3600, ...days.map(d => (dm.get(d) || { s: 0 }).s));
    const cw = 26, bw = 12, h = 28, hid = uid('hw');
    const bars = days.map((d, i) => {
      const o = dm.get(d), x = i * cw + (cw - bw) / 2;
      const off = !o && !inCoverage(cov, d);
      const bh = o ? Math.max(2, (o.s / maxS) * h) : 0;
      const cls = d === end ? 'b on' : o ? 'b' : 'b z';
      const tip = `<b>${fd(d, 'day')}</b><br>${o ? `${fmtDur(o.s)} · ${o.n} ${o.n === 1 ? 'session' : 'sessions'}` : off ? 'Not synced' : 'No training'}`;
      return `<g data-tip="${esc(tip)}"><rect x="${i * cw}" y="0" width="${cw}" height="${h + 16}" fill="transparent"/>${off ? `<rect x="${x}" y="${h - 6}" width="${bw}" height="6" fill="url(#${hid})"/>` : `<rect class="${cls}" x="${x}" y="${h - bh}" width="${bw}" height="${Math.max(bh, 1)}" rx="1"/>`}<text x="${x + bw / 2}" y="${h + 12}" text-anchor="middle"${d === end ? ' class="today"' : ''}>${esc(fd(d, 'dow1'))}</text></g>`;
    }).join('');
    const label = days.map(d => { const o = dm.get(d); return `${fd(d, 'day')} ${o ? fmtDur(o.s) : 'none'}`; }).join(', ');
    return `<section class="aside-block" aria-labelledby="h-week"><h2 id="h-week">This week</h2>
      <dl class="week"><div><dt>Time</dt><dd>${esc(fmtDur(cur.s))}<small>avg ${esc(fmtDur(avg.s))}</small></dd></div><div><dt>Distance</dt><dd>${fmtMi(cur.km)} mi<small>avg ${fmtMi(avg.km)}</small></dd></div><div><dt>Sessions</dt><dd>${cur.n}<small>avg ${nf(avg.n, 1)}</small></dd></div></dl>
      <div class="strip"><svg viewBox="0 0 ${7 * cw} ${h + 16}" role="img" aria-label="Daily training time, last 7 days: ${esc(label)}">${hatchDef(hid)}${bars}</svg><p class="cap"><span>${esc(fd(from, 'md'))} – ${esc(fd(end, 'md'))}</span><a href="/stream/training/">History →</a></p></div></section>`;
  };
  const INTRO_NAV = [['Stream', '/stream/'], ['Writing', '/writing/'], ['Library', '/library/'], ['Training', '/stream/training/'], ['About', '/about.html']];
  const INTRO_MORE = [['Archive', '/archive/'], ['Colophon', '/colophon.html'], ['RSS', '/index.xml']];
  const introCard = data => {
    /* introHtml is produced by the publisher (p/a/em/strong only); the plain fallback is escaped here */
    const body = data.introHtml ? String(data.introHtml)
      : `${data.intro ? `<p>${esc(data.intro)}</p>` : ''}${data.description ? `<p>${esc(data.description)}</p>` : ''}` || '<p>[Introduction]</p>';
    return `<section class="intro-card" aria-label="Introduction"><nav class="intro-nav" aria-label="Sections"><ul>${INTRO_NAV.map(([l, u]) => `<li><a href="${u}">${l}</a></li>`).join('')}</ul><ul class="more">${INTRO_MORE.map(([l, u]) => `<li><a href="${u}">${l}</a></li>`).join('')}</ul></nav><div class="intro-body">${body}</div></section>`;
  };
  const renderHome = async (data, entries) => {
    const [training, well] = await Promise.all([loadTraining(data, entries), loadWellness()]);
    const days = groupByDay(entries.filter(e => STREAM_TYPES.has(e.type))).slice(0, 8);
    setTitle('');
    page(`<h1 class="sr-only">${esc(data.name || 'Vedant Agrawal')}</h1>
      ${introCard(data)}
      <div class="home-grid">
        <section aria-label="Recent entries">${days.length ? `${timelineHtml(days, { well: well && well.map, latest: true })}<p class="more-row"><a class="link" href="/stream/">Stream →</a></p>` : emptyState('Nothing here yet.')}</section>
        <aside class="aside" aria-label="Current">${projectsBlock(entries)}${weekBlock(training)}</aside>
      </div>`, true);
    bindTip($('.aside'));
  };

  /* ================================================================
     Stream
  ================================================================ */
  const renderStream = async (data, entries) => {
    setTitle('Stream');
    const well = await loadWellness();
    const items = entries.filter(e => STREAM_TYPES.has(e.type));
    const q = new URLSearchParams(location.search).get('type');
    let filter = FILTERS.some(f => f[0] === q) ? q : 'all';
    let limit = 30;
    page(`${head('Stream', 'stream', data)}<div class="tabs" role="group" aria-label="Filter stream">${FILTERS.map(([k, l]) => `<button type="button" data-f="${k}" aria-pressed="${k === filter}">${l}</button>`).join('')}</div><div id="s-cta"></div><div id="s-list"></div>`);
    const draw = () => {
      const sel = filter === 'all' ? items : items.filter(e => filterOf(e) === filter);
      const days = groupByDay(sel);
      /* wellness-only days appear only under the Training filter, so the default stream stays quiet */
      if (filter === 'training' && well) {
        const have = new Set(days.map(d => d[0]));
        well.days.forEach(w => { if (!have.has(w.date) && wellLine(w)) days.push([w.date, []]); });
        days.sort((a, b) => b[0].localeCompare(a[0]));
      }
      $('#s-cta').innerHTML = filter === 'training' ? '<div class="train-cta"><a href="/stream/training/">Training history →</a></div>' : '';
      $('#s-list').innerHTML = days.length
        ? `${timelineHtml(days.slice(0, limit), { months: true, well: well && well.map, latest: true })}${days.length > limit ? '<p class="more-row"><button type="button" class="btn ghost" id="s-more">Show more</button></p>' : ''}`
        : emptyState('Nothing here yet.');
      $$('.tabs button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.f === filter)));
    };
    $('.tabs').addEventListener('click', e => {
      const b = e.target.closest('button[data-f]');
      if (!b) return;
      filter = b.dataset.f; limit = 30;
      history.replaceState(null, '', filter === 'all' ? '/stream/' : `/stream/?type=${filter}`);
      draw();
    });
    $('#s-list').addEventListener('click', e => { if (e.target.id === 's-more') { limit += 30; draw(); } });
    draw();
  };

  /* ================================================================
     Writing index
  ================================================================ */
  const WRITING_INDEX = new Set(['writing', 'evergreen', 'reflection']);
  const renderWriting = (data, entries) => {
    setTitle('Writing');
    const items = entries.filter(e => WRITING_INDEX.has(e.type)).sort(byDateDesc);
    const hay = e => `${e.title} ${tagsOf(e).join(' ')} ${e.summary || ''}`.toLowerCase();
    const index = items.map(e => [e, hay(e)]);
    let q = new URLSearchParams(location.search).get('q') || '';
    page(`${head('Writing', 'writing', data)}${items.length ? `<div class="toolbar"><label class="filter"><span class="sr-only">Filter writing by title, tag or summary</span><input type="search" id="w-q" placeholder="Filter" autocomplete="off" spellcheck="false" value="${esc(q)}"></label><span class="count" id="w-count" aria-live="polite"></span></div>` : ''}<div id="w-list"></div>`);
    const row = e => `<li><a class="w-title" href="${href(e)}">${esc(e.title)}</a>${tagsOf(e).length ? `<span class="topics">${tagsOf(e).map(t => tagBtn(t, false, ' sm')).join('')}</span>` : ''}<time class="w-date" datetime="${e.date}">${esc(fd(e.date, 'long'))}</time></li>`;
    const draw = () => {
      const needle = q.trim().toLowerCase();
      const list = needle ? index.filter(([, h]) => needle.split(/\s+/).every(t => h.includes(t))).map(x => x[0]) : items;
      const c = $('#w-count');
      if (c) c.textContent = `${list.length} ${list.length === 1 ? 'piece' : 'pieces'}`;
      $('#w-list').innerHTML = !items.length ? emptyState('Nothing written yet.') : list.length ? `<ul class="toc">${list.map(row).join('')}</ul>` : emptyState('No writing matches.');
    };
    const input = $('#w-q');
    if (input) {
      input.addEventListener('input', () => {
        q = input.value;
        const u = new URL(location.href);
        q ? u.searchParams.set('q', q) : u.searchParams.delete('q');
        history.replaceState(null, '', u.pathname + u.search);
        draw();
      });
      $('#w-list').addEventListener('click', e => {
        const b = e.target.closest('button[data-topic]');
        if (!b) return;
        input.value = q = b.dataset.topic; input.dispatchEvent(new Event('input')); input.focus();
      });
    }
    draw();
  };

  /* ================================================================
     Library
  ================================================================ */
  const STATUS_ICON = {
    reading: '<path d="M9 5C7.6 3.9 5.2 3.5 2.5 3.8v9.6c2.7-.3 5.1.1 6.5 1.2 1.4-1.1 3.8-1.5 6.5-1.2V3.8C12.8 3.5 10.4 3.9 9 5zM9 5v9.6"/>',
    finished: '<path d="M3.5 9.5l3.6 3.6 7.4-8.2"/>',
    saved: '<path d="M4.5 2.8h9v12.4L9 11.8l-4.5 3.4z"/>',
    abandoned: '<circle cx="9" cy="9" r="6"/><path d="M4.8 13.2l8.4-8.4"/>',
  };
  const statusIcon = st => `<svg class="st-icon" viewBox="0 0 18 18" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${STATUS_ICON[st] || STATUS_ICON.saved}</svg>`;
  const BOOKISH = new Set(['book', 'paper']);
  const bookish = e => e.type !== 'project' && (!e.medium || BOOKISH.has(e.medium));
  const placeholderCover = e => `<span class="ph-title">${esc(e.title)}</span><span class="ph-kind">${esc(e.type === 'project' ? 'project' : e.medium || '')}</span>`;
  /* one collection: projects and literature share the shelves. Projects map their status onto them. */
  const SHELVES = [['now', 'Now'], ['finished', 'Finished'], ['saved', 'Saved'], ['aside', 'Set aside']];
  const PROJECT_SHELF = { active: 'now', exploring: 'now', completed: 'finished', paused: 'aside', archived: 'aside' };
  const LIT_SHELF = { reading: 'now', finished: 'finished', saved: 'saved', abandoned: 'aside' };
  const shelfOf = e => (e.type === 'project' ? PROJECT_SHELF[e.status] || 'now' : LIT_SHELF[e.consumption_status] || 'saved');
  /* publisher-computed tags; without them, derive the obvious ones */
  const libTags = e => {
    const t = tagsOf(e);
    if (!Array.isArray(e.tags)) { if (e.type === 'project') t.push('project'); if (e.medium) t.push(String(e.medium).toLowerCase()); }
    return [...new Set(t)];
  };
  const getView = () => { try { return localStorage.getItem('library-view') === 'gallery' ? 'gallery' : 'list'; } catch { return 'list'; } };
  const setView = v => { try { localStorage.setItem('library-view', v); } catch { /* storage unavailable */ } };

  const renderLibrary = (data, entries) => {
    setTitle('Library');
    const items = entries.filter(e => e.type === 'literature' || e.type === 'project').map(e => ({ e, tags: libTags(e) }));
    const counts = new Map();
    items.forEach(({ tags }) => tags.forEach(t => counts.set(t, (counts.get(t) || 0) + 1)));
    const tagList = [...counts].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
    const fromUrl = (new URLSearchParams(location.search).get('tags') || '').split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
    let active = [...new Set(fromUrl.length ? fromUrl : path === '/projects' ? ['project'] : [])].filter(t => counts.has(t));
    let view = getView();
    page(`${head('Library', 'library', data)}${items.length ? `<div class="toolbar"><div class="tagbar" role="group" aria-label="Filter library by tag">${tagList.map(([t, n]) => `<button type="button" class="tag" data-tag="${esc(t)}" aria-pressed="${active.includes(t)}"><span class="h" aria-hidden="true">#</span>${esc(t)}<span class="n">${n}</span></button>`).join('')}<button type="button" class="tag clear" id="l-clear"${active.length ? '' : ' hidden'}>clear</button></div><div class="tb-right"><span class="count" id="l-count" aria-live="polite"></span><span class="seg" role="group" aria-label="Library view"><button type="button" data-view="list" aria-pressed="${view === 'list'}">List</button><button type="button" data-view="gallery" aria-pressed="${view === 'gallery'}">Gallery</button></span></div></div>` : ''}<div id="l-shelves"></div>`);
    const itemTags = tags => (tags.length ? `<span class="item-tags">${tags.map(t => tagBtn(t, active.includes(t), ' sm')).join('')}</span>` : '');
    const ext = e => (e.project_url ? `<a class="ext" href="${safeUrl(e.project_url)}" aria-label="Open ${esc(e.title)} (external site)">↗</a>` : '');
    const row = ({ e, tags }) => {
      if (e.type === 'project') {
        return `<li class="row"><h3><a href="${href(e)}">${esc(e.title)}</a>${ext(e)}</h3><span class="meta">${e.status ? `<span class="pill ${e.status === 'active' ? 'active' : ''}">${esc(e.status)}</span>` : 'project'}</span>${e.summary ? `<p class="sum">${esc(e.summary)}</p>` : ''}${itemTags(tags)}</li>`;
      }
      const when = e.consumption_status === 'finished' && isDay(e.finished) ? fd(e.finished, 'long') : '';
      return `<li class="row"><h3><a href="${href(e)}">${esc(e.title)}</a></h3>${e.creator ? `<p class="by">${esc(e.creator)}</p>` : ''}<span class="meta">${esc([e.medium, when].filter(Boolean).join(' · '))}</span>${itemTags(tags)}</li>`;
    };
    const card = ({ e, tags }) => {
      const frame = bookish(e) ? 'bookish' : 'natural';
      const cover = e.cover && e.type !== 'project' ? `<img src="${safeUrl(e.cover)}" alt="" loading="lazy" decoding="async">` : '';
      const st = LIT_SHELF[e.consumption_status] ? e.consumption_status : 'saved';
      const foot = e.type === 'project'
        ? `<span class="card-by">${e.status ? `<span class="pill ${e.status === 'active' ? 'active' : ''}">${esc(e.status)}</span>` : ''}</span>${ext(e)}`
        : `<span class="card-by">${esc(e.creator || '')}</span><span class="card-st" title="${esc(STATUS_LABEL[st])}">${statusIcon(st)}<span class="sr-only">${esc(STATUS_LABEL[st])}</span></span>`;
      return `<li class="card"><a href="${href(e)}"><span class="cover ${frame}${cover ? '' : ' ph'}">${cover || placeholderCover(e)}</span><span class="card-title">${esc(e.title)}</span></a><span class="card-foot">${foot}</span>${itemTags(tags)}</li>`;
    };
    const rank = ({ e }) => String(e.type === 'project' ? e.date : e.finished || e.date);
    const draw = () => {
      const list = items.filter(({ tags }) => active.every(t => tags.includes(t)));
      $('#l-count') && ($('#l-count').textContent = `${list.length} ${list.length === 1 ? 'item' : 'items'}`);
      if (!items.length) { $('#l-shelves').innerHTML = emptyState('Nothing in the library yet.'); return; }
      $('#l-shelves').innerHTML = SHELVES.map(([k, label]) => {
        const here = list.filter(x => shelfOf(x.e) === k).sort((x, y) => rank(y).localeCompare(rank(x)));
        if (!here.length) return '';
        return `<section class="shelf" aria-labelledby="sh-${k}"><h2 id="sh-${k}">${label}<span>${here.length}</span></h2>${view === 'gallery' ? `<ul class="gallery">${here.map(card).join('')}</ul>` : `<ul class="rows">${here.map(row).join('')}</ul>`}</section>`;
      }).join('') || emptyState('No items match.');
    };
    /* a cover that fails to load falls back to the typographic card */
    $('#l-shelves').addEventListener('error', ev => {
      const img = ev.target;
      if (!img || img.tagName !== 'IMG') return;
      const li = img.closest('.card'), it = li && items.find(x => href(x.e) === li.querySelector('a').href);
      const cv = img.closest('.cover');
      if (cv && it) { cv.classList.add('ph'); cv.innerHTML = placeholderCover(it.e); }
    }, true);
    const bar = $('.toolbar');
    const paint = () => {
      if (bar) {
        $$('.tagbar [data-tag]', bar).forEach(b => b.setAttribute('aria-pressed', String(active.includes(b.dataset.tag))));
        $('#l-clear').hidden = !active.length;
      }
      draw();
    };
    const syncUrl = () => history.replaceState(null, '', location.pathname + (active.length ? `?tags=${active.map(encodeURIComponent).join(',')}` : ''));
    const toggle = (t, fromList) => {
      active = active.includes(t) ? active.filter(x => x !== t) : [...active, t];
      syncUrl(); paint();
      if (fromList) { const b = $(`.tagbar [data-tag="${CSS.escape(t)}"]`); b && b.focus({ preventScroll: true }); }
    };
    bar && bar.addEventListener('click', e => {
      const v = e.target.closest('button[data-view]');
      if (v) {
        view = v.dataset.view; setView(view);
        $$('button[data-view]', bar).forEach(b => b.setAttribute('aria-pressed', String(b === v)));
        return draw();
      }
      if (e.target.closest('#l-clear')) { active = []; syncUrl(); return paint(); }
      const b = e.target.closest('button[data-tag]');
      if (b) toggle(b.dataset.tag, false);
    });
    $('#l-shelves').addEventListener('click', e => { const b = e.target.closest('button[data-tag]'); if (b) toggle(b.dataset.tag, true); });
    draw();
  };


  /* ================================================================
     Archive
  ================================================================ */
  const ARCHIVE_SKIP = new Set(['page', 'block', 'month']);
  const renderArchive = async (data, entries) => {
    const month = (path.match(/^\/archive\/(\d{4}-\d{2})$/) || [])[1];
    const pool = entries.filter(e => !ARCHIVE_SKIP.has(e.type));
    const months = [...new Set(pool.map(e => e.date.slice(0, 7)))].sort();
    if (!month) {
      setTitle('Archive');
      const counts = {};
      pool.forEach(e => { counts[e.date.slice(0, 7)] = (counts[e.date.slice(0, 7)] || 0) + 1; });
      const years = [...new Set(months.map(m => m.slice(0, 4)))].sort().reverse();
      page(`${head('Archive', 'archive', data)}${years.length ? years.map(y => `<section class="year-block" aria-labelledby="y${y}"><h2 id="y${y}">${y}</h2><div class="month-grid">${months.filter(m => m.startsWith(y)).reverse().map(m => `<a class="month-row" href="/archive/${m}/"><span>${esc(fd(m, 'monthName'))}</span><span class="n">${counts[m]}</span></a>`).join('')}</div></section>`).join('') : emptyState('Nothing archived yet.')}`);
      return;
    }
    setTitle(fd(month, 'month'));
    const training = await loadTraining(data, entries);
    const inM = e => e.date.startsWith(month);
    const mine = entries.filter(e => STREAM_TYPES.has(e.type) && inM(e));
    const intro = entries.find(e => e.type === 'month' && (inM(e) || String(e.url).includes(month)));
    const writing = mine.filter(e => WRITING.has(e.type)).sort(byDateDesc);
    const finished = entries.filter(e => e.type === 'literature' && e.consumption_status === 'finished' && (isDay(e.finished) ? e.finished.startsWith(month) : inM(e)));
    const projects = mine.filter(e => e.type === 'project').sort(byDateDesc);
    const photos = mine.filter(e => e.type === 'photo').sort(byDateDesc);
    const acts = training.activities.filter(a => a.date.startsWith(month));
    const cov = training.coverage;
    const last = `${month}-${pad(new Date(+month.slice(0, 4), +month.slice(5), 0).getDate())}`;
    const touchesCov = cov.start && cov.start <= last && cov.end >= `${month}-01`;
    const idx = months.indexOf(month);
    const prev = idx > 0 ? months[idx - 1] : '', next = idx >= 0 && idx < months.length - 1 ? months[idx + 1] : '';
    const sec = (id, title, body) => `<section class="m-section" aria-labelledby="${id}"><h2 class="section-title" id="${id}">${title}</h2>${body}</section>`;
    const list = (items, meta) => `<ul class="plain-list">${items.map(e => `<li><a href="${href(e)}">${esc(e.title)}</a><span class="meta">${esc(meta(e))}</span></li>`).join('')}</ul>`;

    let trainingHtml = '';
    if (acts.length || touchesCov) {
      const dm = dayMap(acts), tot = sumActs(acts), nDays = +last.slice(8);
      const cells = Array.from({ length: nDays }, (_, i) => {
        const d = `${month}-${pad(i + 1)}`, o = dm.get(d);
        if (o) {
          const link = o.n === 1 ? urlHref(o.acts[0].url) : `/stream/training/?date=${d}#activities`;
          return `<a href="${link}" style="background:${rampColor(o.s / 60)}" title="${esc(`${fd(d, 'day')} · ${fmtDur(o.s)}`)}" aria-label="${esc(`${fd(d, 'day')}: ${fmtDur(o.s)}, ${o.n} ${o.n === 1 ? 'session' : 'sessions'}`)}"></a>`;
        }
        return inCoverage(cov, d) ? `<span title="${esc(fd(d, 'day'))}"></span>` : `<span class="off" title="${esc(`${fd(d, 'day')} · not synced`)}"></span>`;
      }).join('');
      trainingHtml = sec('m-train', 'Training', `<dl class="totals"><div><dt>Time</dt><dd>${esc(fmtDur(tot.s))}</dd></div><div><dt>Distance</dt><dd>${fmtMi(tot.km)} mi</dd></div><div><dt>Sessions</dt><dd>${tot.n}</dd></div><div><dt>Active days</dt><dd>${dm.size}</dd></div></dl><div class="mini-ribbon" style="grid-template-columns:repeat(${nDays},1fr)" role="group" aria-label="Training by day">${cells}</div><div class="mini-axis"><span>1</span><span>${nDays}</span></div>`);
    }
    page(`<header class="page-head"><a class="crumb" href="/archive/">← Archive</a><h1>${esc(fd(month, 'month'))}</h1></header>
      <nav class="month-nav" aria-label="Months"><span>${prev ? `<a href="/archive/${prev}/">← ${esc(fd(prev, 'monY'))}</a>` : ''}</span><span>${next ? `<a href="/archive/${next}/">${esc(fd(next, 'monY'))} →</a>` : ''}</span></nav>
      ${intro ? `<div class="m-section m-intro">${intro.summary ? `<p>${esc(intro.summary)}</p>` : ''}<a class="link" href="${href(intro)}">${esc(intro.title)} →</a></div>` : ''}
      ${trainingHtml}
      ${writing.length ? sec('m-writing', 'Writing', list(writing, e => `${TYPE_LABEL[e.type]} · ${fd(e.date, 'md')}`)) : ''}
      ${finished.length ? sec('m-fin', 'Finished', list(finished, e => [e.creator, e.medium].filter(Boolean).join(' · '))) : ''}
      ${projects.length ? sec('m-proj', 'Project updates', list(projects, e => e.status || '')) : ''}
      ${photos.length ? sec('m-photos', 'Photos', `<div class="photo-wall">${photos.flatMap(p => (p.images && p.images.length ? p.images : p.image ? [p.image] : []).map(src => `<a href="${href(p)}"><img src="${safeUrl(src)}" alt="${esc(p.title)}" loading="lazy" decoding="async"></a>`)).join('')}</div>`) : ''}
      ${mine.length ? sec('m-all', 'All entries', timelineHtml(groupByDay(mine))) : emptyState('Nothing this month.')}`);
  };

  /* ================================================================
     Training history
  ================================================================ */
  /* sport groups: colour plus a distinct dash pattern and opacity, so no group relies on colour alone */
  const GSTYLE = {
    run: { c: '#ece6f1', d: '', o: .9 },
    ride: { c: '#9b84c4', d: '7 2', o: 1 },
    swim: { c: '#79b4bd', d: '1.5 2.5', o: .95 },
    strength: { c: '#c7b374', d: '4 2 1 2', o: .9 },
    walk: { c: '#86ad90', d: '3 3', o: .85 },
    hike: { c: '#b98aa0', d: '9 3', o: .85 },
    other: { c: '#6e6083', d: '1 3', o: 1 },
  };
  const ICO = {
    swim: '<path d="M2 11.2c1.4-1.2 2.8-1.2 4.2 0s2.8 1.2 4.2 0 2.8-1.2 4.2 0M2 14.4c1.4-1.2 2.8-1.2 4.2 0s2.8 1.2 4.2 0 2.8-1.2 4.2 0"/><circle cx="12.5" cy="5" r="1.6"/><path d="M4 9.2l3.6-2.4 3 1.4"/>',
    ride: '<circle cx="4.5" cy="12.5" r="3"/><circle cx="13.5" cy="12.5" r="3"/><path d="M4.5 12.5L7.6 6.6h4l2 5.9M7.6 6.6l3.1 5.9M6.6 5h2.2"/>',
    run: '<path d="M2.5 13.8V9.2l2.6-1.1 1.5 2.1 3.2.6c2 .4 4.2 1 5.2 2.4v.6zM2.5 13.8h13"/>',
    strength: '<path d="M5.5 9h7M4.2 6.2v5.6M2.5 7.5v3M13.8 6.2v5.6M15.5 7.5v3"/>',
    walk: '<circle cx="10" cy="3.6" r="1.5"/><path d="M9.6 6.6L8.2 10l-2 4.4M9.6 6.6l2.8 2.4 1.6-.6M8.2 10l3 1.5.6 3.3M9.6 6.6L7 8.6 5 8"/>',
    hike: '<path d="M1.5 14.5L7 5.5l3 5 2-3 4.5 7zM5.8 8.2l1.2 1.2 1.2-1"/>',
    other: '<circle cx="9" cy="9" r="3"/>',
  };
  const sportIcon = g => `<svg class="sport-ico" viewBox="0 0 18 18" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICO[g] || ICO.other}</svg>`;
  /* race distances in miles: swim, bike, run */
  const RACES = [['Sprint', .47, 12.4, 3.1], ['Olympic', .93, 24.9, 6.2], ['70.3', 1.2, 56, 13.1], ['Ironman', 2.4, 112, 26.2]];
  /* "distance" sports report miles (yards for swims); the rest report time */
  const totalMetric = (g, o) => (['run', 'ride', 'swim', 'walk', 'hike'].includes(g) && o.km > 0 ? distStr(g, o.km) : fmtDur(o.s));

  const renderTraining = async (data, entries) => {
    setTitle('Training history');
    const [t, well] = await Promise.all([loadTraining(data, entries), loadWellness()]);
    const acts = t.activities, blocks = t.blocks, cov = t.coverage;
    const crumb = '<a class="crumb" href="/stream/">← stream</a>';
    if (!acts.length) { page(head('Training history', 'training', data, crumb) + emptyState('No training data yet.'), true); return; }

    const today = todayStr();
    const firstDate = [cov.start, acts[acts.length - 1].date].filter(Boolean).sort()[0];
    const lastDate = [cov.end, acts[0].date].filter(Boolean).sort().pop();
    const y0 = +firstDate.slice(0, 4), y1 = +lastDate.slice(0, 4);
    const groups = GROUPS.filter(g => acts.some(a => a.group === g));
    const qd = new URLSearchParams(location.search).get('date');
    const S = { year: y1, metric: 'duration', group: 'all', range: isDay(qd) ? { from: qd, to: qd, label: fd(qd) } : null, sortKey: 'date', sortDir: -1, limit: 50, monthsAll: false };
    const yearList = []; for (let y = y1; y >= y0; y--) yearList.push(y);
    const filt = () => (S.group === 'all' ? acts : acts.filter(a => a.group === S.group));
    const isDur = () => S.metric === 'duration';
    const val = a => (isDur() ? a.durationS / 3600 : a.distanceKm / MI);
    const fmtVal = v => (isDur() ? fmtHours(v) : `${nf(v, 1)} mi`);
    const axisVal = v => (isDur() ? `${nf(v, v < 10 ? 1 : 0)}h` : `${nf(v, v < 10 ? 1 : 0)}`);
    const unitLabel = () => (isDur() ? 'Hours' : 'Miles');
    const actHref = a => urlHref(a.url);
    const longest = g => acts.filter(a => a.group === g && a.distanceKm > 0).reduce((m, a) => (!m || a.distanceKm > m.distanceKm ? a : m), null);
    const raceTable = () => {
      const L = [longest('swim'), longest('ride'), longest('run')];
      const dv = v => nf(v, 2);
      return `<table class="data race"><caption class="sr-only">Race distances in miles, with your longest swim, ride and run so far. Distances already exceeded are marked.</caption><thead><tr><th scope="col">Distance</th><th scope="col">Swim</th><th scope="col">Bike</th><th scope="col">Run</th></tr></thead><tbody>${RACES.map(r => `<tr><th scope="row">${r[0]}</th>${[1, 2, 3].map(i => { const hit = L[i - 1] && L[i - 1].distanceKm / MI >= r[i]; return `<td${hit ? ' class="hit"' : ''}>${dv(r[i])}${hit ? '<span class="sr-only"> (exceeded)</span>' : ''}</td>`; }).join('')}</tr>`).join('')}<tr class="longest"><th scope="row">Longest</th>${L.map((a, i) => `<td>${a ? `<a href="${actHref(a)}">${dv(a.distanceKm / MI)}</a>` : '—'}</td>`).join('')}</tr></tbody></table><p class="cap" style="margin-top:.5rem">Miles · longest single session so far, all synced data</p>`;
    };

    page(`${head('Training history', 'training', data, crumb)}
      <p class="cov">Synced data: ${esc(fd(cov.start))} – ${esc(fd(cov.end))}${cov.lastSync ? ` · last sync ${esc(fd(String(cov.lastSync).slice(0, 10)))}` : ''}</p>
      <div class="t-controls" role="group" aria-label="Chart settings">
        ${yearList.length > 1 ? `<div><span class="label">Year</span><span class="chips" id="year-chips">${yearList.map(y => `<button type="button" class="chip" data-y="${y}" aria-pressed="${y === S.year}">${y}</button>`).join('')}</span></div>` : ''}
        <div><span class="label">Show</span><span class="seg" id="metric-seg"><button type="button" data-metric="duration" aria-pressed="true">Duration</button><button type="button" data-metric="distance" aria-pressed="false">Distance</button></span></div>
        <div><span class="label">Sport</span><span class="chips" id="group-chips"><button type="button" class="chip" data-g="all" aria-pressed="true">All</button>${groups.map(g => `<button type="button" class="chip" data-g="${g}" aria-pressed="false">${GROUP_LABEL[g]}</button>`).join('')}</span></div>
      </div>
      <section class="t-section" aria-labelledby="t-season"><header><h2 id="t-season">Season</h2><p class="cap" id="season-cap"></p></header>
        <div class="chart season" id="season" role="group" aria-label="Season strip. Each line is one session; select a line to list that day."></div>
        <div class="legend" id="season-legend"></div>
        <ul class="sport-totals" id="sport-totals" aria-label="Totals by sport"></ul>
        <h3 class="sub-h" id="t-race">Race distances</h3>
        <div class="scroll-x">${raceTable()}</div></section>
      <section class="t-section" aria-labelledby="t-rib"><header><h2 id="t-rib">Year ribbon</h2><p class="cap">One cell per day, coloured by training time</p></header>
        <div class="scroll-x ribbon" id="ribbon" tabindex="0" role="group" aria-label="Year ribbon. Arrow keys move between days; Enter shows that day's activities."></div>
        <p class="sr-only" id="rib-live" aria-live="polite"></p>
        <div class="legend"><span><i class="sw scale"></i>Less → more time</span><span><i class="sw hatch"></i>Not synced</span></div></section>
      <section class="t-section" aria-labelledby="t-wk"><header><h2 id="t-wk">Weekly volume</h2><p class="cap" id="wk-cap"></p></header>
        <div class="chart" id="weekly"></div>
        <div class="legend"><span><i class="sw bar"></i>Week</span><span><i class="sw dash"></i>4-week average</span>${blocks.length ? '<span><i class="sw band"></i>Training block</span>' : ''}<span><i class="sw hatch"></i>Not synced</span></div></section>
      <section class="t-section" aria-labelledby="t-yoy"><header><h2 id="t-yoy">Year over year</h2><p class="cap" id="yoy-cap"></p></header>
        <div class="chart" id="yoy"></div></section>
      ${well ? `<section class="t-section" aria-labelledby="t-rec"><header><h2 id="t-rec">Recovery</h2><p class="cap" id="rec-cap"></p></header>
        <p class="chart-h">Nightly HRV</p><div class="chart" id="rec-hrv"></div>
        <div class="legend"><span><i class="sw line"></i>HRV</span><span><i class="sw band"></i>Normal range</span></div>
        <p class="chart-h">Resting heart rate</p><div class="chart" id="rec-rhr"></div></section>` : ''}
      <section class="t-section" aria-labelledby="t-mix"><header><h2 id="t-mix">Sport mix</h2><p class="cap">By time</p></header><div id="mix"></div></section>
      <section class="t-section" aria-labelledby="t-mo"><header><h2 id="t-mo">Monthly totals</h2></header><div id="months"></div></section>
      <section class="t-section" id="activities" aria-labelledby="t-list"><header><h2 id="t-list">Activities</h2><p class="cap" id="list-count" aria-live="polite"></p></header><div id="act-list"></div></section>`, true);

    /* ---------- tooltips for a day ---------- */
    let ribMap = new Map();
    const dayTip = d => {
      const o = ribMap.get(d);
      if (o) return { html: `<b>${esc(fd(d, 'day'))}</b><br>${esc(fmtDur(o.s))} · ${o.n} ${o.n === 1 ? 'session' : 'sessions'}`, text: `${fd(d, 'day')}: ${fmtDur(o.s)}, ${o.n} sessions` };
      if (!inCoverage(cov, d)) return { html: `<b>${esc(fd(d, 'day'))}</b><br>Not synced`, text: `${fd(d, 'day')}: not synced` };
      return { html: `<b>${esc(fd(d, 'day'))}</b><br>No training`, text: `${fd(d, 'day')}: no training` };
    };

    /* ---------- 1. Year ribbon ---------- */
    let kb = '';
    const drawRibbon = w => {
      ribMap = dayMap(filt());
      const labelW = 38, top = 16, cellH = 11, gap = 5;
      const W = Math.max(w, 760), cw = (W - labelW - 2) / 366;
      const yrs = []; for (let y = y1; y >= y0; y--) yrs.push(y);
      const H = top + yrs.length * (cellH + gap);
      const hid = uid('hr');
      let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true">${hatchDef(hid)}`;
      MONTH_STARTS.forEach((m, i) => { s += `<text x="${labelW + m * cw}" y="10">${esc(fd(`2025-${pad(i + 1)}-01`, 'mon'))}</text>`; });
      let selRect = '', kbRect = '';
      yrs.forEach((y, ri) => {
        const yy = top + ri * (cellH + gap), n = daysInYear(y), jan1 = dayNum(`${y}-01-01`);
        s += `<text x="${labelW - 8}" y="${yy + cellH - 1}" text-anchor="end">${y}</text>`;
        let run = -1;
        const flush = end => {
          if (run < 0) return;
          s += `<rect x="${labelW + run * cw}" y="${yy}" width="${Math.max(1, (end - run) * cw - .8)}" height="${cellH}" fill="url(#${hid})" data-tip="${esc('<b>Not synced</b>')}"/>`;
          run = -1;
        };
        for (let i = 0; i < n; i++) {
          const d = fromNum(jan1 + i);
          if (d > today) { flush(i); break; }
          const o = ribMap.get(d), x = labelW + i * cw;
          if (!o && !inCoverage(cov, d)) { if (run < 0) run = i; continue; }
          flush(i);
          const tip = dayTip(d);
          s += `<rect class="day${o ? ' has' : ''}" x="${x}" y="${yy}" width="${Math.max(1, cw - .8)}" height="${cellH}" rx="1" fill="${o ? rampColor(o.s / 60) : COL.empty}" data-date="${d}" data-tip="${esc(tip.html)}"/>`;
          if (S.range && S.range.from === d && S.range.to === d) selRect = `<rect class="sel" x="${x - 1}" y="${yy - 1}" width="${Math.max(1, cw - .8) + 2}" height="${cellH + 2}"/>`;
          if (kb === d) kbRect = `<rect class="focus" x="${x - 1.5}" y="${yy - 1.5}" width="${Math.max(1, cw - .8) + 3}" height="${cellH + 3}"/>`;
        }
        flush(n);
      });
      return `${s}${selRect}${kbRect}</svg>`;
    };

    /* ---------- 0. Season strip ---------- */
    const yearActs = () => acts.filter(a => a.date.startsWith(String(S.year)));
    const drawSeason = w => {
      const yr = S.year, n = daysInYear(yr), jan1 = dayNum(`${yr}-01-01`), ys = yearActs();
      const left = 34, right = 8, top = 8, plotH = 120, bottom = 22, H = top + plotH + bottom, plotW = w - left - right, slot = plotW / n;
      const maxH = niceCeil(Math.max(1, ...ys.map(a => a.durationS / 3600)));
      const y = v => top + plotH - (v / maxH) * plotH;
      const sw = Math.max(1, Math.min(1.6, slot * .6)), hid = uid('hs');
      let s = `<svg width="${w}" height="${H}" viewBox="0 0 ${w} ${H}" role="img" aria-label="${esc(`Season ${yr}: ${ys.length} sessions, one line each, height shows duration`)}">${hatchDef(hid)}`;
      [0, .5, 1].forEach(f => { s += `<line class="grid" x1="${left}" x2="${w - right}" y1="${y(maxH * f)}" y2="${y(maxH * f)}"/><text class="y" x="${left - 6}" y="${y(maxH * f) + 4}">${nf(maxH * f, maxH * f % 1 ? 1 : 0)}h</text>`; });
      const idx = d => dayNum(d) - jan1;
      const todayIdx = Math.min(n, dayNum(today) + 1 - jan1);
      if (cov.start) {
        const cs = Math.max(0, Math.min(n, idx(cov.start))), ce = Math.max(0, Math.min(n, idx(cov.end) + 1));
        if (cs > 0) s += `<rect x="${left}" y="${top}" width="${cs * slot}" height="${plotH}" fill="url(#${hid})" data-tip="${esc('<b>Not synced</b>')}"/>`;
        if (todayIdx > ce) s += `<rect x="${left + ce * slot}" y="${top}" width="${(todayIdx - ce) * slot}" height="${plotH}" fill="url(#${hid})" data-tip="${esc('<b>Not synced</b>')}"/>`;
      }
      let lastLx = -99;
      for (let m = 0; m < 12; m++) {
        const lx = left + (dayNum(`${yr}-${pad(m + 1)}-01`) - jan1) * slot;
        if (lx - lastLx < 34) continue;
        lastLx = lx;
        s += `<text x="${lx}" y="${H - 6}">${esc(fd(`${yr}-${pad(m + 1)}-01`, 'mon'))}</text>`;
      }
      const byDay = new Map(); ys.forEach(a => { (byDay.get(a.date) || byDay.set(a.date, []).get(a.date)).push(a); });
      let lines = '', hits = '';
      byDay.forEach((list, d) => {
        list.sort((a, b) => a.start - b.start).forEach((a, k) => {
          const st = GSTYLE[a.group] || GSTYLE.other;
          const x = left + (idx(d) + .5) * slot + (k - (list.length - 1) / 2) * (sw + .4);
          const yTop = Math.min(y(a.durationS / 3600), top + plotH - 3);
          lines += `<line x1="${x.toFixed(2)}" x2="${x.toFixed(2)}" y1="${top + plotH}" y2="${yTop.toFixed(1)}" stroke="${st.c}" stroke-opacity="${st.o}" stroke-width="${sw.toFixed(2)}"${st.d ? ` stroke-dasharray="${st.d}"` : ''}/>`;
          const tip = `<b>${esc(a.title || a.sport)}</b><br>${esc(fd(a.date, 'day'))}<br>${esc(fmtDur(a.durationS))}${a.distanceKm ? ` · ${esc(distStr(a.group, a.distanceKm))}` : ''}`;
          hits += `<line class="s-hit" data-date="${d}" x1="${x.toFixed(2)}" x2="${x.toFixed(2)}" y1="${top + plotH}" y2="${top}" stroke="transparent" stroke-width="${Math.max(5, sw + 3)}" data-tip="${esc(tip)}"/>`;
        });
      });
      return `${s}${lines}${hits}</svg>`;
    };
    const drawSeasonText = () => {
      const ys = yearActs(), tot = sumActs(ys), present = GROUPS.filter(g => ys.some(a => a.group === g));
      $('#season-cap').textContent = ys.length ? `${S.year} · ${tot.n} sessions · ${fmtDur(tot.s)}${tot.km ? ` · ${fmtMi(tot.km)} mi` : ''}` : `${S.year} · no sessions`;
      $('#season-legend').innerHTML = present.map(g => { const st = GSTYLE[g]; return `<span><svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true" style="vertical-align:middle;margin-right:6px"><line x1="5" x2="5" y1="15" y2="1" stroke="${st.c}" stroke-opacity="${st.o}" stroke-width="1.5"${st.d ? ` stroke-dasharray="${st.d}"` : ''}/></svg>${GROUP_LABEL[g]}</span>`; }).join('') + '<span><i class="sw hatch"></i>Not synced</span>';
      const per = present.map(g => ({ g, ...sumActs(ys.filter(a => a.group === g)) })).sort((a, b) => b.s - a.s);
      $('#sport-totals').innerHTML = per.map(o => `<li>${sportIcon(o.g)}<span class="nm">${GROUP_LABEL[o.g]}</span><span class="st">${o.n} ${o.n === 1 ? 'session' : 'sessions'} · ${esc(totalMetric(o.g, o))}</span></li>`).join('');
    };

    /* ---------- Recovery (HRV + resting HR) ---------- */
    const drawTrend = kind => w => {
      const key = kind === 'hrv' ? 'hrv' : 'restingHr', yr = String(S.year);
      const days = well.days.filter(d => d.date.startsWith(yr) && d[key] != null);
      if (days.length < 2) return `<p class="empty-state" style="padding:1rem 0">${days.length ? 'One night recorded' : `No ${kind === 'hrv' ? 'HRV' : 'resting heart rate'} data for ${yr}`}.</p>`;
      const left = 40, right = 34, top = 8, plotH = 110, bottom = 22, H = top + plotH + bottom, plotW = w - left - right;
      const d0 = dayNum(days[0].date), span = Math.max(1, dayNum(days[days.length - 1].date) - d0);
      const band = kind === 'hrv' ? days.filter(d => d.hrvLow != null && d.hrvHigh != null) : [];
      const vs = days.map(d => d[key]).concat(band.flatMap(d => [d.hrvLow, d.hrvHigh]));
      const step = kind === 'hrv' ? 10 : 5;
      const lo = Math.floor(Math.min(...vs) / step) * step, hi = Math.max(lo + step, Math.ceil(Math.max(...vs) / step) * step);
      const x = d => left + ((dayNum(d) - d0) / span) * plotW, y = v => top + plotH - ((v - lo) / (hi - lo)) * plotH;
      let s = `<svg width="${w}" height="${H}" viewBox="0 0 ${w} ${H}" role="img" aria-label="${esc(`${kind === 'hrv' ? 'Nightly HRV' : 'Resting heart rate'}, ${days.length} nights, ${days[0][key]} to ${days[days.length - 1][key]}, range ${Math.min(...days.map(d => d[key]))} to ${Math.max(...days.map(d => d[key]))}`)}">`;
      [lo, (lo + hi) / 2, hi].forEach(v => { s += `<line class="grid" x1="${left}" x2="${w - right}" y1="${y(v)}" y2="${y(v)}"/><text class="y" x="${left - 6}" y="${y(v) + 4}">${nf(v, 1)}</text>`; });
      const nt = Math.max(2, Math.min(6, Math.floor(plotW / 78)));
      for (let i = 0; i < nt; i++) { const dd = fromNum(d0 + Math.round((span * i) / (nt - 1))); s += `<text x="${x(dd)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === nt - 1 ? 'end' : 'middle'}">${esc(fd(dd, 'md'))}</text>`; }
      if (band.length > 1) {
        /* normal-range band, split where nights are missing */
        let seg = [];
        const flush = () => { if (seg.length > 1) s += `<path d="${seg.map((d, i) => `${i ? 'L' : 'M'}${x(d.date).toFixed(1)},${y(d.hrvHigh).toFixed(1)}`).join('')}${seg.slice().reverse().map(d => `L${x(d.date).toFixed(1)},${y(d.hrvLow).toFixed(1)}`).join('')}Z" fill="rgba(194,179,210,.08)" stroke="none"/>`; seg = []; };
        band.forEach(d => { if (seg.length && dayNum(d.date) - dayNum(seg[seg.length - 1].date) > 3) flush(); seg.push(d); });
        flush();
      }
      let path = '', prev = null;
      days.forEach(d => { path += `${prev && dayNum(d.date) - dayNum(prev) <= 3 ? 'L' : 'M'}${x(d.date).toFixed(1)},${y(d[key]).toFixed(1)}`; prev = d.date; });
      s += `<path d="${path}" fill="none" stroke="${kind === 'hrv' ? COL.text : COL.series}" stroke-width="1" stroke-linejoin="round" stroke-linecap="round"${kind === 'hrv' ? '' : ' stroke-dasharray="5 3"'}/>`;
      if (days.length <= 120) days.forEach(d => { s += `<circle cx="${x(d.date).toFixed(1)}" cy="${y(d[key]).toFixed(1)}" r="1.3" fill="${kind === 'hrv' ? COL.text : COL.series}"/>`; });
      const last = days[days.length - 1];
      s += `<circle cx="${x(last.date).toFixed(1)}" cy="${y(last[key]).toFixed(1)}" r="3" fill="${COL.accent}"/><text x="${x(last.date) + 7}" y="${y(last[key]) + 3}" style="fill:${COL.accent}">${nf(last[key], 0)}</text>`;
      const cw = Math.max(3, plotW / (span + 1));
      days.forEach(d => {
        const tip = `<b>${esc(fd(d.date, 'day'))}</b><br>${kind === 'hrv' ? `HRV ${nf(d.hrv, 0)}${d.hrvLow != null && d.hrvHigh != null ? `<br>Normal ${nf(d.hrvLow, 0)}–${nf(d.hrvHigh, 0)}` : ''}` : `Resting HR ${nf(d.restingHr, 0)}`}`;
        s += `<rect class="hv" x="${(x(d.date) - cw / 2).toFixed(1)}" y="${top}" width="${cw.toFixed(1)}" height="${plotH}" fill="transparent" data-tip="${esc(tip)}"/>`;
      });
      return `${s}</svg>`;
    };

    /* ---------- 2. Weekly volume ---------- */
    const wk0 = weekStart(firstDate), wk1 = weekStart(lastDate);
    const nWeeks = (dayNum(wk1) - dayNum(wk0)) / 7 + 1;
    const weekIdx = d => (dayNum(weekStart(d)) - dayNum(wk0)) / 7;
    let weeklySummary = '';
    const drawWeekly = w => {
      const fa = filt();
      const bk = Array.from({ length: nWeeks }, () => ({ s: 0, km: 0, n: 0 }));
      fa.forEach(a => { const i = weekIdx(a.date); if (i >= 0 && i < nWeeks) { bk[i].s += a.durationS; bk[i].km += a.distanceKm; bk[i].n++; } });
      const vals = bk.map(b => (isDur() ? b.s / 3600 : b.km / MI));
      const covered = bk.map((_, i) => cov.start && addDays(wk0, i * 7 + 6) >= cov.start && addDays(wk0, i * 7) <= cov.end);
      const avg = vals.map((_, i) => {
        const sl = []; for (let j = i; j >= 0 && sl.length < 4; j--) if (covered[j]) sl.push(vals[j]);
        return covered[i] && sl.length ? sl.reduce((a, b) => a + b, 0) / sl.length : null;
      });
      /* training blocks -> lanes */
      const bands = blocks.map(b => ({ ...b, i0: Math.max(0, weekIdx(b.start)), i1: Math.min(nWeeks, weekIdx(b.end) + 1) })).filter(b => b.i1 > 0 && b.i0 < nWeeks);
      const laneEnds = [];
      bands.forEach(b => { let l = laneEnds.findIndex(e => e <= b.i0); if (l < 0) { l = laneEnds.length; laneEnds.push(0); } laneEnds[l] = b.i1; b.lane = l; });
      const lanes = laneEnds.length;
      const left = 40, right = 6, plotH = 170, topM = 6 + lanes * 13, bottom = 22;
      const H = topM + plotH + bottom, plotW = w - left - right, bw = plotW / nWeeks;
      const x = i => left + i * bw;
      const max = niceCeil(Math.max(...vals, isDur() ? 1 : 5));
      const y = v => topM + plotH - (v / max) * plotH;
      const hid = uid('hv');
      let s = `<svg width="${w}" height="${H}" viewBox="0 0 ${w} ${H}" role="img" aria-label="${esc(weeklySummary)}">${hatchDef(hid)}`;
      [0, .5, 1].forEach(f => { s += `<line class="grid" x1="${left}" x2="${w - right}" y1="${y(max * f)}" y2="${y(max * f)}"/><text class="y" x="${left - 6}" y="${y(max * f) + 4}">${axisVal(max * f)}</text>`; });
      bands.forEach((b, k) => {
        const bx = x(b.i0), bwid = (b.i1 - b.i0) * bw, by = 2 + b.lane * 13;
        s += `<rect x="${bx}" y="${by}" width="${bwid}" height="${topM + plotH - by}" fill="rgba(194,179,210,${k % 2 ? .04 : .07})" data-tip="${esc(`<b>${esc(b.title)}</b><br>${fd(b.start)} – ${fd(b.end)}`)}"/><line x1="${bx}" x2="${bx}" y1="${by}" y2="${topM + plotH}" stroke="#c2b3d2" stroke-opacity=".3" stroke-dasharray="1 3"/>`;
        const chars = Math.floor((bwid - 6) / 6);
        if (chars >= 3) {
          const label = b.title.length > chars ? `${b.title.slice(0, chars - 1)}…` : b.title;
          const tx = `<text class="block-label" x="${bx + 3}" y="${by + 9}">${esc(label)}</text>`;
          s += b.url ? `<a href="${safeUrl(b.url.endsWith('.html') ? b.url : `${b.url}.html`)}">${tx}</a>` : tx;
        }
      });
      if (cov.start) {
        const xs = left + ((dayNum(cov.start) - dayNum(wk0)) / 7) * bw, xe = left + ((dayNum(cov.end) + 1 - dayNum(wk0)) / 7) * bw;
        if (xs > left) s += `<rect x="${left}" y="${topM}" width="${xs - left}" height="${plotH}" fill="url(#${hid})"/>`;
        if (xe < w - right) s += `<rect x="${xe}" y="${topM}" width="${w - right - xe}" height="${plotH}" fill="url(#${hid})"/>`;
      }
      const curW = cov.end ? weekIdx(cov.end) : -1;
      const gapPx = bw > 6 ? 2 : bw > 3 ? 1 : .5;
      vals.forEach((v, i) => {
        if (!covered[i] || v <= 0) return;
        s += `<rect x="${x(i) + gapPx / 2}" y="${y(v)}" width="${Math.max(1, bw - gapPx)}" height="${Math.max(1, topM + plotH - y(v))}" fill="${i === curW ? COL.accent : COL.dim}"/>`;
      });
      let path = '';
      avg.forEach((v, i) => { if (v != null) path += `${path ? 'L' : 'M'}${x(i) + bw / 2},${y(v)}`; });
      if (path) s += `<path d="${path}" fill="none" stroke="${COL.text}" stroke-width="1" stroke-dasharray="3 3" stroke-linejoin="round" opacity=".7"/>`;
      let lastLx = -99;
      for (let i = 0; i < nWeeks; i++) {
        const d = addDays(wk0, i * 7), prevD = i ? addDays(wk0, (i - 1) * 7) : '';
        if (i && d.slice(5, 7) === prevD.slice(5, 7)) continue;
        if (x(i) - lastLx < 54) continue;
        lastLx = x(i);
        s += `<text x="${x(i)}" y="${H - 6}">${esc(d.slice(5, 7) === '01' || !i ? fd(d, 'monY') : fd(d, 'mon'))}</text>`;
      }
      bk.forEach((b, i) => {
        const from = addDays(wk0, i * 7), to = addDays(from, 6), blk = blockFor(blocks, from) || blockFor(blocks, to);
        const partial = covered[i] && (from < cov.start || to > cov.end);
        const tip = `<b>${fd(from, 'md')} – ${fd(to, 'md')}</b><br>${covered[i] ? `${fmtDur(b.s)} · ${fmtMi(b.km)} mi · ${b.n} ${b.n === 1 ? 'session' : 'sessions'}${partial ? '<br>Partial week' : ''}${blk ? `<br>${esc(blk.title)}` : ''}` : 'Not synced'}`;
        if (covered[i]) s += `<rect class="hit" data-week="${i}" x="${x(i)}" y="${topM}" width="${bw}" height="${plotH}" data-tip="${esc(tip)}"/>`;
      });
      return `${s}</svg>`;
    };

    /* ---------- 3. Year over year ---------- */
    let yoyGeom = null;
    const yoyDash = ['', '6 3', '2 3', '8 3 2 3'];
    const yoyTone = ['#c2b3d2', '#a395b5', '#8576a0', '#6e6083'];
    const drawYoy = w => {
      const fa = filt();
      const years = []; for (let y = y1; y >= y0; y--) years.push(y);
      const daily = {}; fa.forEach(a => { const y = +a.date.slice(0, 4); (daily[y] ??= {}); const d = doy(a.date); daily[y][d] = (daily[y][d] || 0) + val(a); });
      const series = years.map((y, k) => {
        const sd = y === +cov.start.slice(0, 4) ? doy(cov.start) : 1;
        const ed = y === +cov.end.slice(0, 4) ? doy(cov.end) : daysInYear(y);
        let cum = 0; const pts = [];
        for (let d = sd; d <= ed; d++) { cum += (daily[y] && daily[y][d]) || 0; pts.push(cum); }
        return { y, sd, ed, pts, k };
      }).filter(se => se.pts.length);
      const max = niceCeil(Math.max(...series.map(se => se.pts[se.pts.length - 1]), isDur() ? 1 : 5));
      const left = 40, right = 46, top = 8, plotH = 200, bottom = 22, H = top + plotH + bottom, plotW = w - left - right;
      const x = d => left + ((d - 1) / 365) * plotW, y = v => top + plotH - (v / max) * plotH;
      yoyGeom = { left, plotW, series, w };
      let s = `<svg width="${w}" height="${H}" viewBox="0 0 ${w} ${H}" role="img" aria-label="${esc(`Cumulative ${isDur() ? 'training time' : 'distance'} by day of year, ${series.map(se => `${se.y}: ${fmtVal(se.pts[se.pts.length - 1])}`).join('; ')}`)}">`;
      [0, .5, 1].forEach(f => { s += `<line class="grid" x1="${left}" x2="${w - right}" y1="${y(max * f)}" y2="${y(max * f)}"/><text class="y" x="${left - 6}" y="${y(max * f) + 4}">${axisVal(max * f)}</text>`; });
      MONTH_STARTS.forEach((m, i) => { if (i % (w < 520 ? 2 : 1) === 0) s += `<text x="${x(m + 1)}" y="${H - 6}">${esc(fd(`2025-${pad(i + 1)}-01`, 'mon'))}</text>`; });
      const labels = [];
      series.slice().reverse().forEach(se => {
        const cur = se.y === y1;
        const pts = se.pts.map((v, i) => `${i ? 'L' : 'M'}${x(se.sd + i).toFixed(1)},${y(v).toFixed(1)}`).join('');
        const dash = cur ? '' : yoyDash[(se.k - 1) % yoyDash.length], tone = cur ? COL.accent : yoyTone[(se.k - 1) % yoyTone.length];
        s += `<path d="${pts}" fill="none" stroke="${tone}" stroke-width="${cur ? 1.5 : 1}"${dash ? ` stroke-dasharray="${dash}"` : ''} stroke-linejoin="round" stroke-linecap="round"/>`;
        labels.push({ y: y(se.pts[se.pts.length - 1]), text: String(se.y), tone, x: x(se.ed) });
      });
      labels.sort((a, b) => a.y - b.y);
      for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 12) labels[i].y = labels[i - 1].y + 12;
      labels.forEach(l => { s += `<text x="${Math.min(l.x + 5, w - right + 5)}" y="${l.y + 4}" style="fill:${l.tone}">${l.text}</text>`; });
      s += `<line id="yoy-xh" x1="0" x2="0" y1="${top}" y2="${top + plotH}" stroke="${COL.accent}" stroke-width="1" visibility="hidden"/>`;
      return `${s}</svg>`;
    };
    const yoyHover = e => {
      const svg = $('#yoy svg');
      if (!svg || !yoyGeom) return;
      const r = svg.getBoundingClientRect(), g = yoyGeom;
      const px = e.clientX - r.left;
      const xh = $('#yoy-xh');
      if (px < g.left || px > g.left + g.plotW) { xh.setAttribute('visibility', 'hidden'); return hideTip(); }
      const d = Math.min(366, Math.max(1, Math.round(((px - g.left) / g.plotW) * 365) + 1));
      const xx = g.left + ((d - 1) / 365) * g.plotW;
      xh.setAttribute('x1', xx); xh.setAttribute('x2', xx); xh.setAttribute('visibility', 'visible');
      const lines = g.series.filter(se => d >= se.sd && d <= se.ed).map(se => `${se.y}: ${fmtVal(se.pts[d - se.sd])}`);
      showTip(`<b>${esc(fd(fromNum(dayNum('2025-01-01') + d - 1), 'md'))}</b><br>${lines.map(esc).join('<br>')}`, e.clientX, e.clientY);
    };

    /* ---------- 4. Sport mix + monthly totals ---------- */
    const drawMix = () => {
      const m = new Map();
      filt().forEach(a => m.set(a.sport, (m.get(a.sport) || 0) + a.durationS));
      const rows = [...m].sort((a, b) => b[1] - a[1]).slice(0, 10), tot = [...m.values()].reduce((a, b) => a + b, 0), top = rows[0] ? rows[0][1] : 1;
      $('#mix').innerHTML = rows.length ? `<ul class="mix" aria-label="Time by sport">${rows.map(([name, sec]) => `<li><span>${esc(name)}</span><span class="track"><i style="width:${(sec / top) * 100}%"></i></span><span class="val">${esc(fmtDur(sec))} · ${Math.round((sec / tot) * 100)}%</span></li>`).join('')}</ul>` : emptyState('No activities.');
    };
    const drawMonths = () => {
      const fa = filt(), m = new Map();
      fa.forEach(a => { const k = a.date.slice(0, 7); const o = m.get(k) || { s: 0, km: 0, n: 0, days: new Set(), load: 0 }; o.s += a.durationS; o.km += a.distanceKm; o.n++; o.days.add(a.date); o.load += a.load || 0; m.set(k, o); });
      const keys = []; for (let k = firstDate.slice(0, 7); k <= lastDate.slice(0, 7); k = fromNum(dayNum(`${k}-01`) + 31).slice(0, 7)) keys.push(k);
      keys.reverse();
      const partial = k => (cov.start && k === cov.start.slice(0, 7) && cov.start.slice(8) !== '01') || (cov.end && k === cov.end.slice(0, 7) && cov.end < addDays(today, -3) && addDays(cov.end, 1).slice(0, 7) === k);
      const shown = S.monthsAll ? keys : keys.slice(0, 12);
      let foot = false;
      const rows = shown.map(k => {
        const o = m.get(k), p = partial(k); foot ||= p;
        return `<tr><td><a href="/archive/${k}/">${esc(fd(k, 'monY'))}</a>${p ? '<span class="muted" title="Partial coverage"> †</span>' : ''}</td><td>${o ? o.n : '—'}</td><td class="hide-s">${o ? o.days.size : '—'}</td><td>${o ? esc(fmtDur(o.s)) : '—'}</td><td>${o && o.km ? `${fmtMi(o.km)} mi` : '—'}</td><td class="hide-s">${o && o.load ? Math.round(o.load) : '—'}</td></tr>`;
      }).join('');
      $('#months').innerHTML = `<table class="data"><caption class="sr-only">Monthly training totals</caption><thead><tr><th scope="col">Month</th><th scope="col">Sessions</th><th scope="col" class="hide-s">Active days</th><th scope="col">Time</th><th scope="col">Distance</th><th scope="col" class="hide-s">Load</th></tr></thead><tbody>${rows}</tbody></table>${foot ? '<p class="cap" style="margin-top:.5rem">† Partial coverage</p>' : ''}${keys.length > 12 ? `<p class="show-more"><button type="button" class="btn ghost" id="months-toggle">${S.monthsAll ? 'Show fewer' : 'Show all months'}</button></p>` : ''}`;
    };

    /* ---------- 5. Activity list ---------- */
    const COLS = [
      { k: 'date', l: 'Date', v: a => a.date + String(a.start).padStart(11, '0') },
      { k: 'title', l: 'Activity', v: a => (a.title || a.sport).toLowerCase(), c: 'l' },
      { k: 'sport', l: 'Sport', v: a => a.sport.toLowerCase(), c: 'l hide-s' },
      { k: 'durationS', l: 'Time', v: a => a.durationS },
      { k: 'distanceKm', l: 'Distance', v: a => a.distanceKm },
      { k: 'avgHr', l: 'HR', v: a => a.avgHr, c: 'hide-s' },
      { k: 'load', l: 'Load', v: a => a.load, c: 'hide-s' },
    ];
    const drawList = () => {
      let list = filt();
      if (S.range) list = list.filter(a => a.date >= S.range.from && a.date <= S.range.to);
      const col = COLS.find(c => c.k === S.sortKey) || COLS[0];
      list = list.slice().sort((a, b) => {
        const va = col.v(a), vb = col.v(b);
        if (va == null || va === 0 && col.k === 'avgHr') return 1;
        if (vb == null || vb === 0 && col.k === 'avgHr') return -1;
        return (va < vb ? -1 : va > vb ? 1 : 0) * S.sortDir || b.date.localeCompare(a.date);
      });
      $('#list-count').textContent = `${list.length} ${list.length === 1 ? 'activity' : 'activities'}`;
      const shown = list.slice(0, S.limit);
      $('#act-list').innerHTML = `${S.range ? `<div class="filter-note"><button type="button" class="chip" id="clear-range" aria-label="Clear date filter">${esc(S.range.label)} ✕</button></div>` : ''}${list.length ? `<table class="data"><caption class="sr-only">Activities</caption><thead><tr>${COLS.map(c => `<th scope="col" class="${c.c || ''}" aria-sort="${S.sortKey === c.k ? (S.sortDir > 0 ? 'ascending' : 'descending') : 'none'}"><button type="button" data-sort="${c.k}">${c.l}</button></th>`).join('')}</tr></thead><tbody>${shown.map(a => `<tr><td>${esc(fd(a.date))}</td><td class="l"><a href="${actHref(a)}">${esc(a.title || a.sport)}</a><span class="sub">${esc(a.sport)}</span></td><td class="l hide-s">${esc(a.sport)}</td><td>${esc(fmtDur(a.durationS))}</td><td>${a.distanceKm ? distStr(a.group, a.distanceKm) : '—'}</td><td class="hide-s">${a.avgHr || '—'}</td><td class="hide-s">${a.load != null ? Math.round(a.load) : '—'}</td></tr>`).join('')}</tbody></table>${list.length > S.limit ? '<p class="show-more"><button type="button" class="btn ghost" id="list-more">Show more</button></p>' : ''}` : emptyState('No activities match.')}`;
    };

    /* ---------- wiring ---------- */
    const runRibbon = mount($('#ribbon'), drawRibbon);
    const runWeekly = mount($('#weekly'), drawWeekly);
    const runYoy = mount($('#yoy'), drawYoy);
    const runSeason = mount($('#season'), drawSeason);
    const runRecHrv = well ? mount($('#rec-hrv'), drawTrend('hrv')) : () => {};
    const runRecRhr = well ? mount($('#rec-rhr'), drawTrend('rhr')) : () => {};
    [$('#ribbon'), $('#weekly'), $('#yoy'), $('#season'), $('#rec-hrv'), $('#rec-rhr')].filter(Boolean).forEach(bindTip);
    $('#season').addEventListener('click', e => {
      const h = e.target.closest('.s-hit');
      if (!h) return;
      const d = h.dataset.date;
      S.range && S.range.from === d && S.range.to === d ? setRange('') : setRange(d, d, fd(d));
    });
    $('#yoy').addEventListener('pointermove', yoyHover);
    $('#yoy').addEventListener('pointerleave', () => { const xh = $('#yoy-xh'); xh && xh.setAttribute('visibility', 'hidden'); });
    /* start the ribbon scrolled to the most recent data */
    const rib = $('#ribbon');
    rib.scrollLeft = Math.max(0, rib.scrollWidth - rib.clientWidth);

    const caps = () => {
      const fa = filt();
      $('#wk-cap').textContent = `${unitLabel()} per week${S.group === 'all' ? '' : ` · ${GROUP_LABEL[S.group]}`}`;
      if (well) $('#rec-cap').textContent = `${S.year} · ${well.days.filter(d => d.date.startsWith(String(S.year))).length} nights`;
      $('#yoy-cap').textContent = `Cumulative ${isDur() ? 'time' : 'distance'} by day${cov.start.slice(5) !== '01-01' ? ` · ${cov.start.slice(0, 4)} from ${fd(cov.start, 'md')}` : ''}`;
      weeklySummary = `Weekly training ${isDur() ? 'time' : 'distance'}, ${fa.length} activities across ${nWeeks} weeks`;
    };
    const setRange = (from, to, label) => {
      S.range = from ? { from, to, label } : null; S.limit = 50;
      const u = new URL(location.href);
      if (from && from === to) u.searchParams.set('date', from); else u.searchParams.delete('date');
      history.replaceState(null, '', u.pathname + u.search + (from ? '#activities' : ''));
      runRibbon(); drawList();
      if (from) $('#activities').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    };
    const refresh = () => {
      caps(); runSeason(); drawSeasonText(); runRecHrv(); runRecRhr(); runRibbon(); runWeekly(); runYoy(); drawMix(); drawMonths(); drawList();
      $$('#year-chips button').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.y === S.year)));
      $$('#metric-seg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.metric === S.metric)));
      $$('#group-chips button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.g === S.group)));
    };
    $('.t-controls').addEventListener('click', e => {
      const m = e.target.closest('[data-metric]'), g = e.target.closest('[data-g]'), yb = e.target.closest('[data-y]');
      if (yb) { S.year = +yb.dataset.y; refresh(); }
      if (m) S.metric = m.dataset.metric;
      if (g) { S.group = g.dataset.g; S.limit = 50; }
      if (m || g) refresh();
    });
    rib.addEventListener('click', e => {
      const c = e.target.closest('rect.day.has');
      if (!c) return;
      const d = c.dataset.date;
      S.range && S.range.from === d && S.range.to === d ? setRange('') : setRange(d, d, fd(d));
    });
    rib.addEventListener('keydown', e => {
      let nd = '';
      const base = kb || (S.range ? S.range.from : lastDate);
      if (e.key === 'ArrowLeft') nd = addDays(base, -1);
      else if (e.key === 'ArrowRight') nd = addDays(base, 1);
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { const y = +base.slice(0, 4) + (e.key === 'ArrowUp' ? 1 : -1); nd = `${y}${base.slice(4, 10)}`; if (!isDay(fromNum(dayNum(nd))) || fromNum(dayNum(nd)) !== nd) nd = `${y}-02-28`; }
      else if (e.key === 'Enter' && kb) { const o = ribMap.get(kb); if (o) S.range && S.range.from === kb ? setRange('') : setRange(kb, kb, fd(kb)); e.preventDefault(); return; }
      else return;
      e.preventDefault();
      if (nd < `${y0}-01-01` || nd > today || +nd.slice(0, 4) > y1) return;
      kb = nd; runRibbon();
      $('#rib-live').textContent = dayTip(kb).text;
      const cw = (Math.max(rib.clientWidth, 760) - 40) / 366, cx = 38 + (doy(kb) - 1) * cw;
      if (cx < rib.scrollLeft + 40) rib.scrollLeft = cx - 60; else if (cx > rib.scrollLeft + rib.clientWidth - 40) rib.scrollLeft = cx - rib.clientWidth + 60;
    });
    rib.addEventListener('blur', () => { if (kb) { kb = ''; runRibbon(); } });
    $('#weekly').addEventListener('click', e => {
      const h = e.target.closest('rect.hit');
      if (!h) return;
      const from = addDays(wk0, +h.dataset.week * 7), to = addDays(from, 6);
      setRange(from, to, `${fd(from, 'md')} – ${fd(to, 'md')}`);
    });
    $('#months').addEventListener('click', e => { if (e.target.id === 'months-toggle') { S.monthsAll = !S.monthsAll; drawMonths(); } });
    $('#act-list').addEventListener('click', e => {
      const sb = e.target.closest('[data-sort]');
      if (sb) { const k = sb.dataset.sort; S.sortDir = S.sortKey === k ? -S.sortDir : (k === 'title' || k === 'sport' ? 1 : -1); S.sortKey = k; drawList(); }
      else if (e.target.id === 'list-more') { S.limit += 50; drawList(); }
      else if (e.target.closest('#clear-range')) setRange('');
    });
    refresh();
    if (location.hash === '#activities') $('#activities').scrollIntoView();
  };

  /* ================================================================
     Router
  ================================================================ */
  const setNav = () => {
    const key = ({ projects: 'library' })[path.split('/')[1]] || path.split('/')[1] || '';
    $$('[data-nav]').forEach(a => { if (a.dataset.nav === key) a.setAttribute('aria-current', 'page'); });
  };
  const main = async () => {
    const yr = document.getElementById('year');
    if (yr) yr.textContent = new Date().getFullYear();
    setNav();
    try {
      const r = await fetch('/site-data.json', { cache: 'no-cache' });
      if (!r.ok) throw new Error(`Site data unavailable (${r.status})`);
      const data = await r.json(), entries = cleanEntries(data);
      if (path === '/') await renderHome(data, entries);
      else if (path === '/stream') await renderStream(data, entries);
      else if (path === '/writing') renderWriting(data, entries);
      else if (path === '/stream/training') await renderTraining(data, entries);
      else if (path === '/library') renderLibrary(data, entries);
      else if (path === '/projects') renderLibrary(data, entries);
      else if (path === '/archive' || /^\/archive\/\d{4}-\d{2}$/.test(path)) await renderArchive(data, entries);
      else page('<div class="error-state"><h1 class="h-display">Not found</h1><p><a href="/">Home →</a></p></div>');
    } catch (err) {
      console.error(err);
      page(`<div class="error-state"><h1 class="h-display">Could not load</h1><p>${esc(err.message)}</p><p><a href="">Reload</a></p></div>`);
    }
  };
  main();
})();
