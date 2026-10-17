/* Public front end: renders /, /stream/, /writing/, /photos/, /tags/ (+ /tags/<tag>/), /stream/training/, /library/ (and /projects/), /archive/ from
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
  /* tag pages exist for every tag the publisher saw (lowercase [a-z0-9-]); other tags render as plain text */
  let shellTags = new Set();
  const tagHref = t => `/tags/${encodeURIComponent(t)}/`;
  const hasTagPage = t => /^[a-z0-9-]+$/.test(t) && shellTags.has(t);
  const tagLink = (t, extra = '') => (hasTagPage(t)
    ? `<a class="tag${extra}" href="${tagHref(t)}"><span class="h" aria-hidden="true">#</span>${esc(t)}</a>`
    : `<span class="tag${extra}"><span class="h" aria-hidden="true">#</span>${esc(t)}</span>`);
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
  const fdE = e => e.datePrecision === 'month' ? fd(e.date.slice(0, 7), 'monY') : e.datePrecision === 'year' ? e.date.slice(0, 4) : fd(e.date, 'long');
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
    lift: a.lift && Number.isFinite(Number(a.lift.sets)) ? { volumeLb: Number(a.lift.volumeLb) || 0, sets: Number(a.lift.sets) || 0 } : null,
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
  /* ---- strength and body-weight trend (optional; a 404 just means "none") ---- */
  const loadOptional = url => (async () => {
    try { const r = await fetch(url, { cache: 'no-cache' }); return r.ok ? await r.json() : null; } catch { return null; }
  })();
  const loadStrength = () => loadOptional('/data/strength.json').then(j => {
    if (!j || !Array.isArray(j.weekly)) return null;
    const weekly = j.weekly.filter(w => w && isDay(w.week)).map(w => ({ week: w.week, volumeLb: Number(w.volumeLb) || 0, sets: Number(w.sets) || 0, sessions: Number(w.sessions) || 0 })).sort((a, b) => a.week.localeCompare(b.week));
    const exercises = (Array.isArray(j.exercises) ? j.exercises : []).filter(e => e && e.title && Array.isArray(e.series) && e.series.length).map(e => ({
      title: String(e.title), sessions: Number(e.sessions) || e.series.length, best: e.best || null,
      series: e.series.filter(s => s && isDay(s.date) && Number.isFinite(Number(s.e1rmLb))).map(s => ({ date: s.date, v: Number(s.e1rmLb) })).sort((a, b) => a.date.localeCompare(b.date)) })).filter(e => e.series.length);
    const clean = o => {
      const out = {};
      Object.keys(o && typeof o === 'object' ? o : {}).filter(k => /^\d{4}-\d{2}$/.test(k)).sort().forEach(k => {
        const m = {};
        Object.keys(o[k] || {}).forEach(g => { const v = Array.isArray(o[k][g]) ? o[k][g] : Number(o[k][g]); if (Array.isArray(v) ? v.some(Number.isFinite) : v > 0) m[g] = v; });
        if (Object.keys(m).length) out[k] = m;
      });
      return out;
    };
    const muscles = clean(j.muscles), muscleSets = clean(j.muscleSets);
    /* per-day [primary, secondary] set counts; lets any date window be summed exactly */
    const muscleDays = {};
    Object.keys(j.muscleDays && typeof j.muscleDays === 'object' ? j.muscleDays : {}).filter(isDay).sort().forEach(d => {
      const m = {};
      Object.keys(j.muscleDays[d] || {}).forEach(g => { const c = j.muscleDays[d][g]; if (Array.isArray(c) && (Number(c[0]) > 0 || Number(c[1]) > 0)) m[g] = [Number(c[0]) || 0, Number(c[1]) || 0]; });
      if (Object.keys(m).length) muscleDays[d] = m;
    });
    return weekly.length ? { weekly, exercises, muscles, muscleSets, muscleDays } : null;
  });
  const loadBodyWeight = () => loadOptional('/data/weight.json').then(j => {
    const pts = j && Array.isArray(j.points) ? j.points.filter(p => p && isDay(p.date) && Number.isFinite(Number(p.deltaLb))).map(p => ({ date: p.date, v: Number(p.deltaLb) })).sort((a, b) => a.date.localeCompare(b.date)) : [];
    return pts.length >= 2 ? pts : null;
  });
  const MINUS = '\u2212';
  const signed = (v, d = 1) => { const r = Math.round(Math.abs(v) * 10 ** d) / 10 ** d; return r === 0 ? '0' : `${v < 0 ? MINUS : '+'}${nf(r, d)}`; };
  const fmtK = v => (v >= 1000 ? `${nf(v / 1000, v % 1000 ? 1 : 0)}k` : nf(v, 0));
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
  // key = null → no description line at all (Writing)
  const head = (title, key, data, extra = '') => `<header class="page-head">${extra}<h1>${esc(title)}</h1>${key && data.descriptions && data.descriptions[key] ? `<p class="desc">${esc(data.descriptions[key])}</p>` : ''}</header>`;
  const emptyState = t => `<p class="empty-state">${esc(t)}</p>`;

  /* tooltip (delegated, uses [data-tip] holding escaped HTML) */
  const tipEl = document.createElement('div');
  tipEl.className = 'tip'; tipEl.hidden = true; tipEl.setAttribute('role', 'presentation');
  document.body.append(tipEl);
  /* x/y = pointer position; `anchor` (a DOMRect) positions the tip under an element instead (keyboard focus) */
  const showTip = (html, x, y, anchor, card = false) => {
    tipEl.classList.toggle('day-card', card);
    tipEl.innerHTML = html; tipEl.hidden = false;
    const r = tipEl.getBoundingClientRect();
    let left, top;
    if (anchor) {
      left = anchor.left + anchor.width / 2 - r.width / 2; top = anchor.bottom + 10;
      if (top + r.height > innerHeight - 8) top = anchor.top - r.height - 10;
    } else {
      left = x + 14; top = y + 16;
      if (left + r.width > innerWidth - 8) left = x - r.width - 14;
      if (top + r.height > innerHeight - 8) top = y - r.height - 14;
    }
    left = Math.min(left, innerWidth - r.width - 8); top = Math.min(top, innerHeight - r.height - 8);
    tipEl.style.left = `${Math.max(8, left)}px`; tipEl.style.top = `${Math.max(8, top)}px`;
  };
  const hideTip = () => { tipEl.hidden = true; };
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !tipEl.hidden) hideTip(); });
  const bindTip = c => {
    const h = e => {
      const t = e.target.closest && e.target.closest('[data-tip]');
      if (!t || !c.contains(t)) return e.target.closest && e.target.closest('[data-date]') ? undefined : hideTip(); /* day cells own their card */
      showTip(t.getAttribute('data-tip'), e.clientX, e.clientY);
    };
    c.addEventListener('pointermove', h);
    c.addEventListener('pointerdown', h);
    c.addEventListener('pointerleave', hideTip);
  };
  document.addEventListener('pointerdown', e => { if (!e.target.closest || !e.target.closest('[data-tip], [data-date]')) hideTip(); });
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
    [...entries].sort(byDateDesc).forEach(e => { const k = e.datePrecision === 'month' ? e.date.slice(0, 7) : e.date; if (!m.has(k)) m.set(k, []); m.get(k).push(e); });
    return [...m];
  };
  const dayHtml = (date, items, opts = {}, latest = false) => {
    const rich = items.filter(e => e.type !== 'activity');
    const train = items.filter(e => e.type === 'activity').map(e => e._act).sort((a, b) => a.start - b.start);
    const well = opts.well ? wellHtml(opts.well.get(date), date) : '';
    return `<li class="day ${rich.length ? 'rich' : 'train-only'}${latest ? ' latest' : ''}"><span class="node" aria-hidden="true"></span><div class="day-date"><time datetime="${date}">${esc(date.length === 7 ? fd(date, 'monY') : fd(date, 'day'))}</time></div>${well}${rich.map(richHtml).join('')}${train.length ? trainLine(train) : ''}</li>`;
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
  const INTRO_NAV = [['Stream', '/stream/'], ['Writing', '/writing/'], ['Library', '/library/'], ['Photos', '/photos/'], ['Training', '/stream/training/'], ['About', '/about.html']];
  const INTRO_MORE = [['Archive', '/archive/'], ['Tags', '/tags/'], ['Colophon', '/colophon.html'], ['RSS', '/index.xml']];
  const introCard = data => {
    /* introHtml is produced by the publisher (p/a/em/strong only); the plain fallback is escaped here */
    const body = data.introHtml != null ? String(data.introHtml)   // '' = intentionally blank
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
        <aside class="aside" aria-label="Current">${weekBlock(training)}</aside>
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
    page(`${head('Stream', null, data)}<div class="tabs" role="group" aria-label="Filter stream">${FILTERS.map(([k, l]) => `<button type="button" data-f="${k}" aria-pressed="${k === filter}">${l}</button>`).join('')}</div><div id="s-cta"></div><div id="s-list"></div>`);
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
    page(`${head('Writing', null, data)}${items.length ? `<div class="toolbar"><label class="filter"><span class="sr-only">Filter writing by title, tag or summary</span><input type="search" id="w-q" placeholder="Filter" autocomplete="off" spellcheck="false" value="${esc(q)}"></label><span class="count" id="w-count" aria-live="polite"></span></div>` : ''}<div id="w-list"></div>`);
    const row = e => `<li><a class="w-title" href="${href(e)}">${esc(e.title)}</a>${tagsOf(e).length ? `<span class="topics">${tagsOf(e).map(t => tagLink(t, ' sm')).join('')}</span>` : ''}<time class="w-date" datetime="${e.date}">${esc(fdE(e))}</time></li>`;
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
    page(`${head('Library', null, data)}${items.length ? `<div class="toolbar"><div class="tagbar" role="group" aria-label="Filter library by tag">${tagList.map(([t, n]) => `<button type="button" class="tag" data-tag="${esc(t)}" aria-pressed="${active.includes(t)}"><span class="h" aria-hidden="true">#</span>${esc(t)}<span class="n">${n}</span></button>`).join('')}<button type="button" class="tag clear" id="l-clear"${active.length ? '' : ' hidden'}>clear</button><a class="tag all" href="/tags/">all tags →</a></div><div class="tb-right"><span class="count" id="l-count" aria-live="polite"></span><span class="seg" role="group" aria-label="Library view"><button type="button" data-view="list" aria-pressed="${view === 'list'}">List</button><button type="button" data-view="gallery" aria-pressed="${view === 'gallery'}">Gallery</button></span></div></div>` : ''}<div id="l-shelves"></div>`);
    /* the tag filters in place; the small arrow opens the tag's own page */
    const itemTags = tags => (tags.length ? `<span class="item-tags">${tags.map(t => `<span class="tg">${tagBtn(t, active.includes(t), ' sm')}${hasTagPage(t) ? `<a class="go" href="${tagHref(t)}" aria-label="All entries tagged ${esc(t)}" title="All entries tagged #${esc(t)}">→</a>` : ''}</span>`).join('')}</span>` : '');
    const ext = e => (e.project_url ? `<a class="ext" href="${safeUrl(e.project_url)}" aria-label="Open ${esc(e.title)} (external site)">↗</a>` : '');
    const row = ({ e, tags }) => {
      if (e.type === 'project') {
        return `<li class="row"><h3><a href="${href(e)}">${esc(e.title)}</a>${ext(e)}</h3><span class="meta">${e.status ? `<span class="pill ${e.status === 'active' ? 'active' : ''}">${esc(e.status)}</span>` : 'project'}</span>${e.summary ? `<p class="sum">${esc(e.summary)}</p>` : ''}${itemTags(tags)}</li>`;
      }
      const when = e.consumption_status !== 'finished' ? '' : isDay(e.finished) ? fd(e.finished, 'long') : /^\d{4}-\d{2}$/.test(String(e.finished)) ? fd(e.finished, 'monY') : '';
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
     Tags: /tags/ (index) and /tags/<tag>/ (everything carrying the tag, by kind)
  ================================================================ */
  const TAG_KINDS = [
    ['Writing', e => WRITING.has(e.type)],
    ['Library', e => e.type === 'literature' || e.type === 'project'],
    ['Photos', e => e.type === 'photo'],
  ];
  const taggable = entries => entries.filter(e => TAG_KINDS.some(([, f]) => f(e)));
  const renderTags = (data, entries) => {
    setTitle('Tags');
    const counts = new Map();
    taggable(entries).forEach(e => tagsOf(e).forEach(t => counts.set(t, (counts.get(t) || 0) + 1)));
    const list = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    page(`${head('Tags', null, data)}${list.length
      ? `<ul class="tag-index" aria-label="All tags">${list.map(([t, n]) => `<li>${tagLink(t)}<span class="n"><span class="sr-only">, </span>${n}<span class="sr-only"> ${n === 1 ? 'entry' : 'entries'}</span></span></li>`).join('')}</ul>`
      : emptyState('No tags yet.')}`);
  };
  const renderTag = (data, entries, tag) => {
    setTitle(`#${tag}`);
    const crumb = '<a class="crumb" href="/tags/">← tags</a>';
    const mine = taggable(entries).filter(e => tagsOf(e).includes(tag)).sort(byDateDesc);
    const row = e => {
      const sub = e.type === 'literature' ? [e.creator, STATUS_LABEL[e.consumption_status]].filter(Boolean).join(' · ') : '';
      return `<li><a class="w-title" href="${href(e)}">${esc(e.title)}</a><time class="w-date" datetime="${e.date}">${esc(fdE(e))}</time>${sub ? `<p class="t-sub">${esc(sub)}</p>` : ''}${e.summary ? `<p class="t-sum">${esc(e.summary)}</p>` : ''}</li>`;
    };
    const sections = TAG_KINDS.map(([label, f], i) => {
      const here = mine.filter(f);
      return here.length ? `<section class="tag-sec" aria-labelledby="tk${i}"><h2 id="tk${i}">${label}<span>${here.length}</span></h2><ul class="t-rows">${here.map(row).join('')}</ul></section>` : '';
    }).join('');
    page(`${head(`#${tag}`, null, data, crumb)}${sections || emptyState(`Nothing is tagged #${tag}.`)}`);
  };

  /* ================================================================
     Photos: masonry gallery + native <dialog> lightbox
  ================================================================ */
  const renderPhotos = (data, entries) => {
    setTitle('Photos');
    const shots = entries.filter(e => e.type === 'photo').sort(byDateDesc).flatMap(e => {
      const imgs = e.images && e.images.length ? e.images : e.image ? [e.image] : [];
      return imgs.map((src, i) => ({ e, src: safeUrl(src), i, n: imgs.length }));
    });
    if (!shots.length) { page(`${head('Photos', null, data)}${emptyState('No photos yet.')}`, true); return; }
    const label = s => `${s.e.title}${s.n > 1 ? ` (${s.i + 1} of ${s.n})` : ''}`;
    const fig = (s, k) => `<li><button type="button" class="shot" data-k="${k}" aria-label="${esc(`View ${label(s)}, ${fdE(s.e)}`)}" aria-haspopup="dialog"><img src="${s.src}" alt="" loading="lazy" decoding="async"><span class="shot-cap" aria-hidden="true"><span>${esc(s.e.title)}</span><time>${esc(fdE(s.e))}</time></span></button></li>`;
    page(`${head('Photos', null, data)}<ul class="photo-grid" id="p-grid">${shots.map(fig).join('')}</ul>
      <dialog class="lightbox" id="lb" aria-label="Photo viewer">
        <div class="lb-top"><span class="lb-count" id="lb-count" aria-live="polite"></span><button type="button" class="lb-btn" id="lb-close">Close</button></div>
        <div class="lb-stage" id="lb-stage"><img id="lb-img" alt="">${shots.length > 1 ? '<button type="button" class="lb-nav prev" id="lb-prev" aria-label="Previous photo">←</button><button type="button" class="lb-nav next" id="lb-next" aria-label="Next photo">→</button>' : ''}</div>
        <div class="lb-cap"><p class="lb-t"><span id="lb-title"></span><time id="lb-date"></time></p><p class="lb-sum" id="lb-sum"></p><a class="link" id="lb-link" href="#">Open note →</a></div>
      </dialog>`, true);
    const dlg = $('#lb'), img = $('#lb-img');
    let cur = 0, opener = null;
    const show = k => {
      cur = (k + shots.length) % shots.length;
      const s = shots[cur];
      img.src = s.src; img.alt = label(s);
      $('#lb-title').textContent = s.e.title; $('#lb-date').textContent = fdE(s.e); $('#lb-date').setAttribute('datetime', s.e.date);
      $('#lb-sum').textContent = s.e.summary || ''; $('#lb-sum').hidden = !s.e.summary;
      $('#lb-link').href = href(s.e);
      $('#lb-count').textContent = `${cur + 1} / ${shots.length}`;
      [cur - 1, cur + 1].forEach(j => { if (shots.length > 1) new Image().src = shots[(j + shots.length) % shots.length].src; });
    };
    $('#p-grid').addEventListener('click', e => {
      const b = e.target.closest('.shot');
      if (!b) return;
      opener = b;
      show(+b.dataset.k);
      dlg.showModal();
      $('#lb-close').focus({ preventScroll: true });
    });
    /* a cover that fails to load is dropped rather than leaving an empty frame */
    $('#p-grid').addEventListener('error', ev => { const li = ev.target && ev.target.closest && ev.target.closest('li'); if (li && ev.target.tagName === 'IMG') li.remove(); }, true);
    $('#lb-close').addEventListener('click', () => dlg.close());
    dlg.addEventListener('close', () => { if (opener && opener.isConnected) opener.focus({ preventScroll: true }); });
    const prev = $('#lb-prev'), next = $('#lb-next');
    prev && prev.addEventListener('click', () => show(cur - 1));
    next && next.addEventListener('click', () => show(cur + 1));
    dlg.addEventListener('keydown', e => {
      if (shots.length < 2 || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); show(cur - 1); } else if (e.key === 'ArrowRight') { e.preventDefault(); show(cur + 1); }
    });
    /* clicking the empty area around the picture closes the viewer */
    dlg.addEventListener('click', e => { if (e.target === dlg || e.target.id === 'lb-stage') dlg.close(); });
    let sx = null;
    $('#lb-stage').addEventListener('pointerdown', e => { sx = e.pointerType === 'mouse' ? null : e.clientX; });
    $('#lb-stage').addEventListener('pointerup', e => {
      if (sx == null || shots.length < 2) return;
      const dx = e.clientX - sx; sx = null;
      if (Math.abs(dx) > 50) show(cur + (dx < 0 ? 1 : -1));
    });
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
    const finished = entries.filter(e => e.type === 'literature' && e.consumption_status === 'finished' && (/^\d{4}-\d{2}/.test(String(e.finished || '')) ? String(e.finished).startsWith(month) : inM(e)));
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

  /* Period switch: rolling windows ending today. Quarter and Year are whole Mon-Sun weeks ending with the current week. */
  const PERIODS = [['month', 'Month'], ['quarter', 'Quarter'], ['year', 'Year']];
  const PERIOD_LABEL = { month: 'Last 30 days', quarter: 'Last 12 weeks', year: 'Last 52 weeks' };
  const NONE = 'No training in this period.';
  const periodWin = (period, today) => {
    if (period === 'month') return { period, from: addDays(today, -29), to: today, last: today, n: 30, daily: true };
    const n = period === 'year' ? 52 : 12, to = addDays(weekStart(today), 6);
    return { period, from: addDays(weekStart(today), -(n - 1) * 7), to, last: to > today ? today : to, n, daily: false };
  };
  /* x-axis labels for a date range: Mondays for short ranges, month starts otherwise */
  const winTicks = (from, to, xOf, y, gap = 54, maxX = Infinity) => {
    let s = '', lastX = -99;
    const put = (d, label) => { const x = xOf(d); if (x - lastX < gap || x > maxX) return; lastX = x; s += `<text x="${x.toFixed(1)}" y="${y}">${esc(label)}</text>`; };
    if (dayNum(to) - dayNum(from) <= 40) {
      for (let d = from; d <= to; d = addDays(d, 1)) if (d === from || weekStart(d) === d) put(d, fd(d, 'md'));
      return s;
    }
    const starts = [];
    for (let m = from.slice(0, 7); `${m}-01` <= to; m = fromNum(dayNum(`${m}-01`) + 31).slice(0, 7)) if (`${m}-01` > from) starts.push(`${m}-01`);
    if (!starts.length || xOf(starts[0]) - xOf(from) >= gap) put(from, fd(from, 'monY'));
    starts.forEach(d => put(d, fd(d, d.slice(5, 7) === '01' ? 'monY' : 'mon')));
    return s;
  };

  const renderTraining = async (data, entries) => {
    setTitle('Training history');
    const [t, well, strength, bw] = await Promise.all([loadTraining(data, entries), loadWellness(), loadStrength(), loadBodyWeight()]);
    const acts = t.activities, blocks = t.blocks, cov = t.coverage;
    const crumb = '<a class="crumb" href="/stream/">← stream</a>';
    if (!acts.length) { page(head('Training history', 'training', data, crumb) + emptyState('No training data yet.'), true); return; }

    const today = todayStr();
    const firstDate = [cov.start, acts[acts.length - 1].date].filter(Boolean).sort()[0];
    const lastDate = [cov.end, acts[0].date].filter(Boolean).sort().pop();
    const y0 = +firstDate.slice(0, 4), y1 = +lastDate.slice(0, 4);
    const groups = GROUPS.filter(g => acts.some(a => a.group === g));
    const qd = new URLSearchParams(location.search).get('date');
    const pq = new URLSearchParams(location.search).get('period');
    let period = PERIODS.some(p => p[0] === pq) ? pq : 'quarter';
    /* a ?date= link without a period opens the narrowest window that contains that day */
    if (!pq && isDay(qd)) period = PERIODS.map(p => p[0]).find(k => qd >= periodWin(k, today).from) || 'year';
    const S = { period, win: periodWin(period, today), metric: 'duration', group: 'all', range: isDay(qd) ? { from: qd, to: qd, label: fd(qd) } : null, sortKey: 'date', sortDir: -1, limit: 50 };
    const inWin = d => d >= S.win.from && d <= S.win.last;
    const filt = () => (S.group === 'all' ? acts : acts.filter(a => a.group === S.group));
    const winActs = list => list.filter(a => inWin(a.date));
    const isYear = () => S.period === 'year';
    /* chart buckets: one per day (Month) or per Mon-Sun week (Quarter, Year) */
    const bucketsOf = () => {
      const w = S.win, daily = w.daily, n = daily ? dayNum(w.last) - dayNum(w.from) + 1 : w.n;
      return { daily, n, unit: daily ? 1 : 7, from: i => addDays(w.from, i * (daily ? 1 : 7)), to: i => addDays(w.from, i * (daily ? 1 : 7) + (daily ? 0 : 6)), idx: d => Math.floor((dayNum(d) - dayNum(w.from)) / (daily ? 1 : 7)) };
    };
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

    page(`${head('Training history', null, data, crumb)}
      <div class="t-period"><span class="seg" id="period-seg" role="group" aria-label="Period">${PERIODS.map(([k, l]) => `<button type="button" data-period="${k}" aria-pressed="${k === S.period}">${l}</button>`).join('')}</span></div>
      <p class="cov">Synced data: ${esc(fd(cov.start))} – ${esc(fd(cov.end))}${cov.lastSync ? ` · last sync ${esc(fd(String(cov.lastSync).slice(0, 10)))}` : ''}</p>
      <div class="t-controls" role="group" aria-label="Chart settings">
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
        <div class="legend" id="rib-legend"><span><i class="sw scale"></i>Less → more time</span><span><i class="sw hatch"></i>Not synced</span></div></section>
      <section class="t-section" aria-labelledby="t-wk"><header><h2 id="t-wk">Weekly volume</h2><p class="cap" id="wk-cap"></p></header>
        <div class="chart" id="weekly"></div>
        <div class="legend" id="wk-legend"></div></section>
      <section class="t-section" id="yoy-sec" aria-labelledby="t-yoy"><header><h2 id="t-yoy">Year over year</h2><p class="cap" id="yoy-cap"></p></header>
        <div class="chart" id="yoy"></div></section>
      ${well ? `<section class="t-section" aria-labelledby="t-rec"><header><h2 id="t-rec">Recovery</h2><p class="cap" id="rec-cap"></p></header>
        <p class="chart-h">Nightly HRV</p><div class="chart" id="rec-hrv"></div>
        <div class="legend" id="rec-legend"><span><i class="sw line"></i>HRV</span><span><i class="sw band"></i>Normal range</span></div>
        <p class="chart-h">Resting heart rate</p><div class="chart" id="rec-rhr"></div></section>` : ''}
      ${strength ? `<section class="t-section" aria-labelledby="t-str"><header><h2 id="t-str">Strength</h2><p class="cap" id="str-cap"></p></header>
        <p class="chart-h">Weekly volume</p><div class="chart" id="str-weekly"></div>
        <div class="legend" id="str-wk-legend"></div>
        ${Object.keys(strength.muscles).length ? `<p class="chart-h">Muscles worked</p><div id="muscles"></div>` : ''}
        ${strength.exercises.length ? `<p class="chart-h">Estimated 1RM</p><div class="str-multiples" id="str-multi"></div>
        <div class="legend" id="str-multi-legend"><span><i class="sw line"></i>Best set each day</span><span><i class="sw dot"></i>Best in period</span></div>
        <p class="chart-h">Exercises</p><div class="scroll-x" id="str-table"></div>` : ''}</section>` : ''}
      ${bw ? `<section class="t-section" aria-labelledby="t-bw"><header><h2 id="t-bw">Body weight</h2><p class="cap" id="bw-cap">Smoothed trend, change only</p></header>
        <p class="bw-label" id="bw-label"></p><div class="chart" id="bw-chart"></div></section>` : ''}
      <section class="t-section" aria-labelledby="t-mix"><header><h2 id="t-mix">Sport mix</h2><p class="cap">By time</p></header><div id="mix"></div></section>
      <section class="t-section" aria-labelledby="t-mo"><header><h2 id="t-mo">Monthly totals</h2></header><div id="months"></div></section>
      <section class="t-section" id="activities" aria-labelledby="t-list"><header><h2 id="t-list">Activities</h2><p class="cap" id="list-count" aria-live="polite"></p></header><div id="act-list"></div></section>`, true);

    /* ---------- day card: date, that day's sessions and wellness (hover, focus, tap) ---------- */
    let ribMap = new Map();
    const allDays = dayMap(acts);
    const liftSum = a => (a.lift && a.lift.sets ? `${a.lift.sets} sets${a.lift.volumeLb ? ` \u00b7 ${fmtK(a.lift.volumeLb)} lb` : ''}` : '');
    const clock = a => (a.start ? new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(a.start * 1000)) : '');
    const sessionsOf = d => (allDays.get(d) ? allDays.get(d).acts.slice().sort((a, b) => a.start - b.start) : []);
    const wellRows = w => {
      if (!w) return [];
      const r = [];
      if (w.sleepS != null) r.push(['Sleep', fmtSleep(w.sleepS)]);
      if (w.hrv != null) r.push(['HRV', `${nf(w.hrv, 0)}${w.hrvLow != null && w.hrvHigh != null ? ` (normal ${nf(w.hrvLow, 0)}–${nf(w.hrvHigh, 0)})` : ''}`]);
      if (w.restingHr != null) r.push(['Resting HR', nf(w.restingHr, 0)]);
      if (w.acuteLoad != null || w.chronicLoad != null) r.push(['Load', `${w.acuteLoad != null ? nf(w.acuteLoad, 0) : '–'} acute / ${w.chronicLoad != null ? nf(w.chronicLoad, 0) : '–'} chronic`]);
      return r;
    };
    const dayCardHtml = d => {
      const ss = sessionsOf(d), wr = wellRows(well && well.map.get(d));
      const body = ss.length
        ? `<ul class="dc-s">${ss.map(a => `<li><span>${esc(actName(a))}${clock(a) ? ` <span class="dc-t">${esc(clock(a))}</span>` : ''}</span><span class="dc-m">${esc([a.distanceKm > 0 ? distStr(a.group, a.distanceKm) : '', a.durationS ? fmtDur(a.durationS) : '', liftSum(a)].filter(Boolean).join(' · '))}</span></li>`).join('')}</ul>`
        : `<p class="dc-n">${inCoverage(cov, d) ? 'No training' : 'Not synced'}</p>`;
      return `<b>${esc(fd(d, 'day'))}</b><span class="dc-y">${esc(d.slice(0, 4))}</span>${body}${wr.length ? `<dl class="dc-w">${wr.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}`;
    };
    /* plain-text version for the screen-reader live region */
    const dayTip = d => {
      const ss = sessionsOf(d), wr = wellRows(well && well.map.get(d));
      const parts = ss.length ? [ss.map(a => [actName(a), clock(a), a.distanceKm > 0 ? distStr(a.group, a.distanceKm) : '', a.durationS ? fmtDur(a.durationS) : '', liftSum(a)].filter(Boolean).join(' ')).join('; ')] : [inCoverage(cov, d) ? 'no training' : 'not synced'];
      if (wr.length) parts.push(wr.map(([k, v]) => `${k} ${v}`).join(', '));
      return { text: `${fd(d, 'day')}: ${parts.join('. ')}` };
    };
    let cardDate = '', tapGuard = '';
    const showCard = (d, x, y, anchor) => { cardDate = d; showTip(dayCardHtml(d), x, y, anchor, true); };
    const hideCard = () => { cardDate = ''; tapGuard = ''; hideTip(); };
    const cellOf = e => { const t = e.target.closest && e.target.closest('[data-date]'); return t && t.dataset.date ? t : null; };
    /* mouse: follows the pointer. touch/pen: the first tap on a day shows the card and swallows the click; a second tap acts as before. */
    const bindCard = c => {
      c.addEventListener('pointermove', e => {
        if (e.pointerType !== 'mouse') return;
        const t = cellOf(e);
        t ? showCard(t.dataset.date, e.clientX, e.clientY) : hideCard();
      });
      c.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') hideCard(); });
      c.addEventListener('pointerdown', e => {
        if (e.pointerType === 'mouse') return;
        const t = cellOf(e);
        if (!t) return hideCard();
        const d = t.dataset.date;
        if (cardDate === d && !tipEl.hidden) { tapGuard = ''; return; }
        tapGuard = d; showCard(d, e.clientX, e.clientY);
      });
      c.addEventListener('click', e => { if (tapGuard && cellOf(e)) { tapGuard = ''; e.stopImmediatePropagation(); } });
      c.addEventListener('scroll', () => { if (!kb) hideCard(); }, { passive: true });
    };
    document.addEventListener('pointerdown', e => { if (!tipEl.hidden && cardDate && !(e.target.closest && e.target.closest('[data-date]'))) hideCard(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') hideCard(); });

    /* ---------- 1. Year ribbon (Year) / day strip (Month, Quarter) ---------- */
    let kb = '';
    let ribGeom = { cx: () => 0 };
    const drawStrip = w => {
      const from = S.win.from, n = dayNum(S.win.last) - dayNum(from) + 1;
      if (!filt().some(a => inWin(a.date))) return emptyState(NONE);
      const top = 18, cellH = 30, W = Math.max(w, n * 9), cw = W / n, gap = cw > 12 ? 2 : 1;
      const idx = d => dayNum(d) - dayNum(from), hid = uid('hr');
      const H = top + cellH;
      let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true">${hatchDef(hid)}${winTicks(from, S.win.last, d => idx(d) * cw, 10, 54, W - 24)}`;
      let selRect = '', kbRect = '', run = -1;
      const flush = end => {
        if (run < 0) return;
        s += `<rect x="${run * cw}" y="${top}" width="${Math.max(1, (end - run) * cw - gap)}" height="${cellH}" fill="url(#${hid})" data-tip="${esc('<b>Not synced</b>')}"/>`;
        run = -1;
      };
      for (let i = 0; i < n; i++) {
        const d = addDays(from, i), o = ribMap.get(d), x = i * cw;
        if (!o && !inCoverage(cov, d)) { if (run < 0) run = i; continue; }
        flush(i);
        s += `<rect class="day${o ? ' has' : ''}" x="${x}" y="${top}" width="${Math.max(1, cw - gap)}" height="${cellH}" rx="1" fill="${o ? rampColor(o.s / 60) : COL.empty}" data-date="${d}"/>`;
        if (S.range && S.range.from === d && S.range.to === d) selRect = `<rect class="sel" x="${x - 1}" y="${top - 1}" width="${Math.max(1, cw - gap) + 2}" height="${cellH + 2}"/>`;
        if (kb === d) kbRect = `<rect class="focus" x="${x - 1.5}" y="${top - 1.5}" width="${Math.max(1, cw - gap) + 3}" height="${cellH + 3}"/>`;
      }
      flush(n);
      ribGeom = { cx: d => (idx(d) + .5) * cw };
      return `${s}${selRect}${kbRect}</svg>`;
    };
    const drawRibbon = w => {
      ribMap = dayMap(filt());
      if (!isYear()) return drawStrip(w);
      const labelW = 38, top = 16, cellH = 11, gap = 5;
      const W = Math.max(w, 760), cw = (W - labelW - 2) / 366;
      ribGeom = { cx: d => labelW + (doy(d) - 1) * cw };
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
          s += `<rect class="day${o ? ' has' : ''}" x="${x}" y="${yy}" width="${Math.max(1, cw - .8)}" height="${cellH}" rx="1" fill="${o ? rampColor(o.s / 60) : COL.empty}" data-date="${d}"/>`;
          if (S.range && S.range.from === d && S.range.to === d) selRect = `<rect class="sel" x="${x - 1}" y="${yy - 1}" width="${Math.max(1, cw - .8) + 2}" height="${cellH + 2}"/>`;
          if (kb === d) kbRect = `<rect class="focus" x="${x - 1.5}" y="${yy - 1.5}" width="${Math.max(1, cw - .8) + 3}" height="${cellH + 3}"/>`;
        }
        flush(n);
      });
      return `${s}${selRect}${kbRect}</svg>`;
    };

    /* ---------- 0. Season strip ---------- */
    const drawSeason = w => {
      const ys = winActs(acts);
      if (!ys.length) return emptyState(NONE);
      const from = S.win.from, n = dayNum(S.win.last) - dayNum(from) + 1;
      const left = 34, right = 8, top = 8, plotH = 120, bottom = 22, H = top + plotH + bottom, plotW = w - left - right, slot = plotW / n;
      const maxH = niceCeil(Math.max(1, ...ys.map(a => a.durationS / 3600)));
      const y = v => top + plotH - (v / maxH) * plotH;
      const sw = Math.max(1, Math.min(4, slot * .35)), hid = uid('hs');
      let s = `<svg width="${w}" height="${H}" viewBox="0 0 ${w} ${H}" role="img" aria-label="${esc(`${PERIOD_LABEL[S.period]}: ${ys.length} sessions, one line each, height shows duration`)}">${hatchDef(hid)}`;
      [0, .5, 1].forEach(f => { s += `<line class="grid" x1="${left}" x2="${w - right}" y1="${y(maxH * f)}" y2="${y(maxH * f)}"/><text class="y" x="${left - 6}" y="${y(maxH * f) + 4}">${nf(maxH * f, maxH * f % 1 ? 1 : 0)}h</text>`; });
      const idx = d => dayNum(d) - dayNum(from);
      if (cov.start) {
        const cs = Math.max(0, Math.min(n, idx(cov.start))), ce = Math.max(0, Math.min(n, idx(cov.end) + 1));
        if (cs > 0) s += `<rect x="${left}" y="${top}" width="${cs * slot}" height="${plotH}" fill="url(#${hid})" data-tip="${esc('<b>Not synced</b>')}"/>`;
        if (n > ce) s += `<rect x="${left + ce * slot}" y="${top}" width="${(n - ce) * slot}" height="${plotH}" fill="url(#${hid})" data-tip="${esc('<b>Not synced</b>')}"/>`;
      }
      s += winTicks(from, S.win.last, d => left + idx(d) * slot, H - 6, 54, w - 24);
      const byDay = new Map(); ys.forEach(a => { (byDay.get(a.date) || byDay.set(a.date, []).get(a.date)).push(a); });
      let lines = '', hits = '';
      byDay.forEach((list, d) => {
        list.sort((a, b) => a.start - b.start).forEach((a, k) => {
          const st = GSTYLE[a.group] || GSTYLE.other;
          const x = left + (idx(d) + .5) * slot + (k - (list.length - 1) / 2) * (sw + .4);
          const yTop = Math.min(y(a.durationS / 3600), top + plotH - 3);
          lines += `<line x1="${x.toFixed(2)}" x2="${x.toFixed(2)}" y1="${top + plotH}" y2="${yTop.toFixed(1)}" stroke="${st.c}" stroke-opacity="${st.o}" stroke-width="${sw.toFixed(2)}"${st.d ? ` stroke-dasharray="${st.d}"` : ''}/>`;
          hits += `<line class="s-hit" data-date="${d}" x1="${x.toFixed(2)}" x2="${x.toFixed(2)}" y1="${top + plotH}" y2="${top}" stroke="transparent" stroke-width="${Math.max(5, sw + 3)}"/>`;
        });
      });
      return `${s}${lines}${hits}</svg>`;
    };
    const drawSeasonText = () => {
      const ys = winActs(acts), tot = sumActs(ys), present = GROUPS.filter(g => ys.some(a => a.group === g)), lbl = PERIOD_LABEL[S.period];
      $('#season-cap').textContent = ys.length ? `${lbl} · ${tot.n} sessions · ${fmtDur(tot.s)}${tot.km ? ` · ${fmtMi(tot.km)} mi` : ''}` : `${lbl} · no sessions`;
      $('#season-legend').innerHTML = ys.length ? present.map(g => { const st = GSTYLE[g]; return `<span><svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true" style="vertical-align:middle;margin-right:6px"><line x1="5" x2="5" y1="15" y2="1" stroke="${st.c}" stroke-opacity="${st.o}" stroke-width="1.5"${st.d ? ` stroke-dasharray="${st.d}"` : ''}/></svg>${GROUP_LABEL[g]}</span>`; }).join('') + '<span><i class="sw hatch"></i>Not synced</span>' : '';
      const per = present.map(g => ({ g, ...sumActs(ys.filter(a => a.group === g)) })).sort((a, b) => b.s - a.s);
      $('#sport-totals').innerHTML = per.map(o => `<li>${sportIcon(o.g)}<span class="nm">${GROUP_LABEL[o.g]}</span><span class="st">${o.n} ${o.n === 1 ? 'session' : 'sessions'} · ${esc(totalMetric(o.g, o))}</span></li>`).join('');
    };

    /* ---------- Recovery (HRV + resting HR) ---------- */
    const drawTrend = kind => w => {
      const key = kind === 'hrv' ? 'hrv' : 'restingHr';
      const days = well.days.filter(d => inWin(d.date) && d[key] != null);
      if (days.length < 2) return `<p class="empty-state" style="padding:1rem 0">${days.length ? 'One night recorded' : `No ${kind === 'hrv' ? 'HRV' : 'resting heart rate'} data in this period`}.</p>`;
      const left = 40, right = 34, top = 8, plotH = 110, bottom = 22, H = top + plotH + bottom, plotW = w - left - right;
      const d0 = dayNum(S.win.from), span = Math.max(1, dayNum(S.win.last) - d0);
      const band = kind === 'hrv' ? days.filter(d => d.hrvLow != null && d.hrvHigh != null) : [];
      const vs = days.map(d => d[key]).concat(band.flatMap(d => [d.hrvLow, d.hrvHigh]));
      const step = kind === 'hrv' ? 10 : 5;
      const lo = Math.floor(Math.min(...vs) / step) * step, hi = Math.max(lo + step, Math.ceil(Math.max(...vs) / step) * step);
      const x = d => left + ((dayNum(d) - d0) / span) * plotW, y = v => top + plotH - ((v - lo) / (hi - lo)) * plotH;
      let s = `<svg width="${w}" height="${H}" viewBox="0 0 ${w} ${H}" role="img" aria-label="${esc(`${kind === 'hrv' ? 'Nightly HRV' : 'Resting heart rate'}, ${days.length} nights, ${days[0][key]} to ${days[days.length - 1][key]}, range ${Math.min(...days.map(d => d[key]))} to ${Math.max(...days.map(d => d[key]))}`)}">`;
      [lo, (lo + hi) / 2, hi].forEach(v => { s += `<line class="grid" x1="${left}" x2="${w - right}" y1="${y(v)}" y2="${y(v)}"/><text class="y" x="${left - 6}" y="${y(v) + 4}">${nf(v, 1)}</text>`; });
      s += winTicks(S.win.from, S.win.last, x, H - 6, 54, w - 24);
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

    /* ---------- 2. Weekly volume (daily bars for Month) ---------- */
    let weeklySummary = '';
    const drawWeekly = w => {
      const fa = winActs(filt());
      if (!fa.length) return emptyState(NONE);
      const B = bucketsOf(), wf = S.win.from;
      const bk = Array.from({ length: B.n }, () => ({ s: 0, km: 0, n: 0 }));
      fa.forEach(a => { const i = B.idx(a.date); if (i >= 0 && i < B.n) { bk[i].s += a.durationS; bk[i].km += a.distanceKm; bk[i].n++; } });
      const vals = bk.map(b => (isDur() ? b.s / 3600 : b.km / MI));
      const covered = bk.map((_, i) => cov.start && B.to(i) >= cov.start && B.from(i) <= cov.end);
      const avg = vals.map((_, i) => {
        if (B.daily) return null;
        const sl = []; for (let j = i; j >= 0 && sl.length < 4; j--) if (covered[j]) sl.push(vals[j]);
        return covered[i] && sl.length ? sl.reduce((a, b) => a + b, 0) / sl.length : null;
      });
      /* training blocks -> lanes */
      const bands = blocks.map(b => ({ ...b, i0: Math.max(0, B.idx(b.start)), i1: Math.min(B.n, B.idx(b.end) + 1) })).filter(b => b.i1 > 0 && b.i0 < B.n);
      const laneEnds = [];
      bands.forEach(b => { let l = laneEnds.findIndex(e => e <= b.i0); if (l < 0) { l = laneEnds.length; laneEnds.push(0); } laneEnds[l] = b.i1; b.lane = l; });
      const lanes = laneEnds.length;
      const left = 40, right = 6, plotH = 170, topM = 6 + lanes * 13, bottom = 22;
      const H = topM + plotH + bottom, plotW = w - left - right, bw = plotW / B.n;
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
        const xs = left + ((dayNum(cov.start) - dayNum(wf)) / B.unit) * bw, xe = left + ((dayNum(cov.end) + 1 - dayNum(wf)) / B.unit) * bw;
        if (xs > left) s += `<rect x="${left}" y="${topM}" width="${Math.min(xs, w - right) - left}" height="${plotH}" fill="url(#${hid})"/>`;
        if (xe < w - right) s += `<rect x="${Math.max(xe, left)}" y="${topM}" width="${w - right - Math.max(xe, left)}" height="${plotH}" fill="url(#${hid})"/>`;
      }
      const curW = cov.end ? B.idx(cov.end) : -1;
      const gapPx = bw > 6 ? 2 : bw > 3 ? 1 : .5;
      vals.forEach((v, i) => {
        if (!covered[i] || v <= 0) return;
        s += `<rect x="${x(i) + gapPx / 2}" y="${y(v)}" width="${Math.max(1, bw - gapPx)}" height="${Math.max(1, topM + plotH - y(v))}" fill="${i === curW ? COL.accent : COL.dim}"/>`;
      });
      let path = '';
      avg.forEach((v, i) => { if (v != null) path += `${path ? 'L' : 'M'}${x(i) + bw / 2},${y(v)}`; });
      if (path) s += `<path d="${path}" fill="none" stroke="${COL.text}" stroke-width="1" stroke-dasharray="3 3" stroke-linejoin="round" opacity=".7"/>`;
      s += winTicks(wf, S.win.last, d => left + ((dayNum(d) - dayNum(wf)) / B.unit) * bw, H - 6, 54, w - 24);
      bk.forEach((b, i) => {
        const from = B.from(i), to = B.to(i), blk = blockFor(blocks, from) || blockFor(blocks, to);
        const partial = !B.daily && covered[i] && (from < cov.start || to > cov.end);
        const head = B.daily ? fd(from, 'day') : `${fd(from, 'md')} – ${fd(to, 'md')}`;
        const tip = `<b>${head}</b><br>${covered[i] ? `${fmtDur(b.s)} · ${fmtMi(b.km)} mi · ${b.n} ${b.n === 1 ? 'session' : 'sessions'}${partial ? '<br>Partial week' : ''}${blk ? `<br>${esc(blk.title)}` : ''}` : 'Not synced'}`;
        if (covered[i]) s += `<rect class="hit" data-b="${i}" x="${x(i)}" y="${topM}" width="${bw}" height="${plotH}" data-tip="${esc(tip)}"/>`;
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

    /* ---------- 4. Sport mix + totals table ---------- */
    const drawMix = () => {
      const m = new Map();
      winActs(filt()).forEach(a => m.set(a.sport, (m.get(a.sport) || 0) + a.durationS));
      const rows = [...m].sort((a, b) => b[1] - a[1]).slice(0, 10), tot = [...m.values()].reduce((a, b) => a + b, 0), top = rows[0] ? rows[0][1] : 1;
      $('#mix').innerHTML = rows.length ? `<ul class="mix" aria-label="Time by sport">${rows.map(([name, sec]) => `<li><span>${esc(name)}</span><span class="track"><i style="width:${(sec / top) * 100}%"></i></span><span class="val">${esc(fmtDur(sec))} · ${Math.round((sec / tot) * 100)}%</span></li>`).join('')}</ul>` : emptyState(NONE);
    };
    const totalsRow = (label, o) => `<tr><td>${label}</td><td>${o ? o.n : '—'}</td><td class="hide-s">${o ? o.days.size : '—'}</td><td>${o ? esc(fmtDur(o.s)) : '—'}</td><td>${o && o.km ? `${fmtMi(o.km)} mi` : '—'}</td><td class="hide-s">${o && o.load ? Math.round(o.load) : '—'}</td></tr>`;
    const totalsTable = (first, cap, rows, foot) => `<table class="data"><caption class="sr-only">${cap}</caption><thead><tr><th scope="col">${first}</th><th scope="col">Sessions</th><th scope="col" class="hide-s">Active days</th><th scope="col">Time</th><th scope="col">Distance</th><th scope="col" class="hide-s">Load</th></tr></thead><tbody>${rows}</tbody></table>${foot ? '<p class="cap" style="margin-top:.5rem">† Partial coverage</p>' : ''}`;
    /* Year: one row per month in the window. Month and Quarter: one row per week, clipped to the window. */
    const drawMonths = () => {
      const fa = winActs(filt());
      $('#t-mo').textContent = isYear() ? 'Monthly totals' : 'Weekly totals';
      if (!fa.length) { $('#months').innerHTML = emptyState(NONE); return; }
      const bucket = new Map();
      const keyOf = isYear() ? a => a.date.slice(0, 7) : a => weekStart(a.date);
      fa.forEach(a => { const k = keyOf(a); const o = bucket.get(k) || { s: 0, km: 0, n: 0, days: new Set(), load: 0 }; o.s += a.durationS; o.km += a.distanceKm; o.n++; o.days.add(a.date); o.load += a.load || 0; bucket.set(k, o); });
      let foot = false, rows = '';
      if (isYear()) {
        const keys = []; for (let k = S.win.from.slice(0, 7); k <= S.win.last.slice(0, 7); k = fromNum(dayNum(`${k}-01`) + 31).slice(0, 7)) keys.push(k);
        const partial = k => (k === S.win.from.slice(0, 7) && S.win.from.slice(8) !== '01') || (cov.start && k === cov.start.slice(0, 7) && cov.start.slice(8) !== '01') || (cov.end && k === cov.end.slice(0, 7) && cov.end < addDays(today, -3) && addDays(cov.end, 1).slice(0, 7) === k);
        rows = keys.reverse().map(k => { const p = partial(k); foot ||= p; return totalsRow(`<a href="/archive/${k}/">${esc(fd(k, 'monY'))}</a>${p ? '<span class="muted" title="Partial coverage"> †</span>' : ''}`, bucket.get(k)); }).join('');
        $('#months').innerHTML = totalsTable('Month', 'Monthly training totals', rows, foot);
      } else {
        const weeks = []; for (let k = weekStart(S.win.from); k <= S.win.last; k = addDays(k, 7)) weeks.push(k);
        rows = weeks.reverse().map(k => { const a = k < S.win.from ? S.win.from : k, b = addDays(k, 6) > S.win.last ? S.win.last : addDays(k, 6); return totalsRow(`${esc(fd(a, 'md'))} – ${esc(fd(b, 'md'))}`, bucket.get(k)); }).join('');
        $('#months').innerHTML = totalsTable('Week', 'Weekly training totals', rows, false);
      }
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
      /* a selected day or week overrides the window, so links to older days still list them */
      let list = S.range ? filt().filter(a => a.date >= S.range.from && a.date <= S.range.to) : winActs(filt());
      const col = COLS.find(c => c.k === S.sortKey) || COLS[0];
      list = list.slice().sort((a, b) => {
        const va = col.v(a), vb = col.v(b);
        if (va == null || va === 0 && col.k === 'avgHr') return 1;
        if (vb == null || vb === 0 && col.k === 'avgHr') return -1;
        return (va < vb ? -1 : va > vb ? 1 : 0) * S.sortDir || b.date.localeCompare(a.date);
      });
      $('#list-count').textContent = `${list.length} ${list.length === 1 ? 'activity' : 'activities'}`;
      const shown = list.slice(0, S.limit);
      $('#act-list').innerHTML = `${S.range ? `<div class="filter-note"><button type="button" class="chip" id="clear-range" aria-label="Clear date filter">${esc(S.range.label)} ✕</button></div>` : ''}${list.length ? `<table class="data"><caption class="sr-only">Activities</caption><thead><tr>${COLS.map(c => `<th scope="col" class="${c.c || ''}" aria-sort="${S.sortKey === c.k ? (S.sortDir > 0 ? 'ascending' : 'descending') : 'none'}"><button type="button" data-sort="${c.k}">${c.l}</button></th>`).join('')}</tr></thead><tbody>${shown.map(a => `<tr><td>${esc(fd(a.date))}</td><td class="l"><a href="${actHref(a)}">${esc(a.title || a.sport)}</a><span class="sub">${esc(a.sport)}</span></td><td class="l hide-s">${esc(a.sport)}</td><td>${esc(fmtDur(a.durationS))}</td><td>${a.distanceKm ? distStr(a.group, a.distanceKm) : '—'}</td><td class="hide-s">${a.avgHr || '—'}</td><td class="hide-s">${a.load != null ? Math.round(a.load) : '—'}</td></tr>`).join('')}</tbody></table>${list.length > S.limit ? '<p class="show-more"><button type="button" class="btn ghost" id="list-more">Show more</button></p>' : ''}` : emptyState(S.range ? 'No activities match.' : NONE)}`;
    };


    /* ---------- Strength: weekly volume, e1RM small multiples, exercise table ---------- */
    /* Month: one bar per day from the matched lifting sessions; Quarter and Year: one bar per week from strength.json. */
    const strRows = () => {
      const B = bucketsOf();
      if (B.daily) {
        const m = new Map();
        acts.filter(a => a.lift && inWin(a.date)).forEach(a => { const o = m.get(a.date) || { v: 0, sets: 0, sessions: 0 }; o.v += a.lift.volumeLb; o.sets += a.lift.sets; o.sessions++; m.set(a.date, o); });
        return { B, rows: Array.from({ length: B.n }, (_, i) => { const d = B.from(i), o = m.get(d); return { from: d, to: d, v: o ? o.v : 0, sets: o ? o.sets : 0, sessions: o ? o.sessions : 0 }; }) };
      }
      return { B, rows: Array.from({ length: B.n }, (_, i) => { const wk = B.from(i), r = strength.weekly.find(x => x.week === wk); return { from: wk, to: B.to(i), v: r ? r.volumeLb : 0, sets: r ? r.sets : 0, sessions: r ? r.sessions : 0 }; }) };
    };
    const strTotals = () => { const { rows } = strRows(); return { n: rows.reduce((a, k) => a + k.sessions, 0), v: rows.reduce((a, k) => a + k.v, 0) }; };
    const drawStrWeekly = w => {
      const { B, rows } = strRows(), total = rows.reduce((a, k) => a + k.v, 0);
      if (!total) return emptyState('No lifting in this period.');
      const left = 40, right = 6, topM = 6, plotH = 170, bottom = 22, H = topM + plotH + bottom, plotW = w - left - right, bw = plotW / B.n;
      const x = i => left + i * bw;
      const max = niceCeil(Math.max(...rows.map(k => k.v), 1000));
      const y = v => topM + plotH - (v / max) * plotH;
      const avg = rows.map((_, i) => { const sl = rows.slice(Math.max(0, i - 3), i + 1); return sl.reduce((a, k) => a + k.v, 0) / sl.length; });
      let s = `<svg width="${w}" height="${H}" viewBox="0 0 ${w} ${H}" role="img" aria-label="${esc(`Lifting volume in pounds per ${B.daily ? 'day' : 'week'}, ${PERIOD_LABEL[S.period].toLowerCase()}, ${nf(total, 0)} lb in total`)}">`;
      [0, .5, 1].forEach(f => { s += `<line class="grid" x1="${left}" x2="${w - right}" y1="${y(max * f)}" y2="${y(max * f)}"/><text class="y" x="${left - 6}" y="${y(max * f) + 4}">${fmtK(max * f)}</text>`; });
      const gapPx = bw > 6 ? 2 : bw > 3 ? 1 : .5, curFrom = B.daily ? today : weekStart(today);
      rows.forEach((k, i) => { if (k.v > 0) s += `<rect x="${x(i) + gapPx / 2}" y="${y(k.v)}" width="${Math.max(1, bw - gapPx)}" height="${Math.max(1, topM + plotH - y(k.v))}" fill="${k.from === curFrom ? COL.accent : COL.dim}"/>`; });
      if (!B.daily) s += `<path d="${avg.map((v, i) => `${i ? 'L' : 'M'}${(x(i) + bw / 2).toFixed(1)},${y(v).toFixed(1)}`).join('')}" fill="none" stroke="${COL.text}" stroke-width="1" stroke-dasharray="3 3" stroke-linejoin="round" opacity=".7"/>`;
      s += winTicks(S.win.from, S.win.last, d => left + ((dayNum(d) - dayNum(S.win.from)) / B.unit) * bw, H - 6, 54, w - 24);
      rows.forEach((k, i) => {
        const head = B.daily ? fd(k.from, 'day') : `${fd(k.from, 'md')} – ${fd(k.to, 'md')}`;
        const tip = `<b>${head}</b><br>${k.sessions ? `${nf(k.v, 0)} lb · ${k.sets} sets · ${k.sessions} ${k.sessions === 1 ? 'session' : 'sessions'}` : 'No lifting'}`;
        s += `<rect class="hv" x="${x(i)}" y="${topM}" width="${bw}" height="${plotH}" fill="transparent" data-tip="${esc(tip)}"/>`;
      });
      return `${s}</svg>`;
    };

    /* ---------- Strength: monthly muscle map (front and back figures, ranked list) ---------- */
    const MZ_LABEL = { abdominals: 'Abdominals', shoulders: 'Shoulders', biceps: 'Biceps', triceps: 'Triceps', forearms: 'Forearms', quadriceps: 'Quadriceps', hamstrings: 'Hamstrings', calves: 'Calves', glutes: 'Glutes', abductors: 'Abductors', adductors: 'Adductors', lats: 'Lats', upper_back: 'Upper back', traps: 'Traps', lower_back: 'Lower back', chest: 'Chest', neck: 'Neck', obliques: 'Obliques' };
    const MZ_ALIAS = { obliques: 'abdominals' };
    const mzName = g => MZ_LABEL[g] || g.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
    /* Right-hand half of each region in a 100 x 200 box; the left half is the same path mirrored about x = 50. */
    const MZ_FRONT = {
      neck: ['M50 22.5H54L55.5 29.5H50Z'],
      shoulders: ['M66 32.5C72 31.5 77 35 77.5 41.5C77.5 46 75.5 50 73 53L66.5 49C65.5 43 65 37 66 32.5Z'],
      chest: ['M50.8 33C56 31.5 62 32 65.2 34C65 40 65.5 45 65.5 48.5C61 53 55 53.5 50.8 51.5Z'],
      abdominals: ['M50.8 54C55 55 60 54.5 62.5 53L62 78C59 81.5 54 82.5 50.8 82.5Z', 'M63.6 53C65.2 56 66.3 60 66.3 64L65.2 77C64.2 79 63.2 79.5 62.8 78.6Z'],
      biceps: ['M69 54H77.5C79 62 79 68 78.5 75H71C70 68 69.5 61 69 54Z'],
      forearms: ['M71.5 77H78.5C80 86 81 92 81.5 97H74.5C73 91 72 84 71.5 77Z'],
      adductors: ['M50.8 90L54.6 92C55.2 103 54.6 114 54 124L50.8 118Z'],
      quadriceps: ['M55.8 88C59.5 86.5 63.5 87 66 90C67 100 66 115 63.5 128H55C55.6 116 56 100 55.8 88Z'],
      calves: ['M55 138C60 136 65 138 65.5 142C65 152 63.5 165 61.5 176H56.5C55.5 163 54.5 150 55 138Z'],
    };
    const MZ_BACK = {
      neck: ['M50 22.5H54L55.5 29.5H50Z'],
      traps: ['M50 25C55 26.5 61 29.5 65.5 33C62 37 56 41 50 45Z'],
      shoulders: ['M66 32.5C72 31.5 77 35 77.5 41.5C77.5 46 75.5 50 73 53L66.5 49C65.5 43 65 37 66 32.5Z'],
      upper_back: ['M50.8 46.5C56 42.5 61 39 65 37L66 46C60 50 55 52 50.8 52.5Z'],
      lats: ['M66 47C67 55 65.5 63 61 71H55.5C55 63 53.5 57 52.5 54C58 53.5 62.5 51 66 47Z'],
      lower_back: ['M50.8 58H54C55 63 55 68 54.5 77L50.8 79Z'],
      triceps: ['M69 54H77.5C79 62 79 68 78.5 75H71C70 68 69.5 61 69 54Z'],
      forearms: ['M71.5 77H78.5C80 86 81 92 81.5 97H74.5C73 91 72 84 71.5 77Z'],
      abductors: ['M66.4 84C68.6 86 69.6 91 69 96C68 99 66.5 99 65.4 97Z'],
      glutes: ['M50.8 80C56 78 63 80 65.6 85C66.5 91 64 97 58 98C54 98 51.5 95 50.8 92Z'],
      hamstrings: ['M51.5 101C57 100 63 100.5 66 100C67 108 66 120 63.5 130H53C52 120 51.5 110 51.5 101Z'],
      calves: ['M54.5 134C60 132.5 65 134 66 139C65.5 150 63.5 162 61.5 172H56.5C55 162 54 148 54.5 134Z'],
    };
    const MZ_MIRROR = 'matrix(-1 0 0 1 100 0)';
    const MZ_DECOR = ['M50 82.5C56 81 63 83 66.5 88', 'M66 130C67 133 66 135 63 135.5H55C54.5 133 54 131 54 129', 'M56.5 176H61.5L62.5 186C62.5 190 59 191.5 57 190C56 188 56 183 56.5 176Z', 'M74.5 99C75 103 77 106 79.5 105.5C81 103 81.5 100 81.5 99'];
    const mzFill = t => {
      if (!(t > 0)) return 'none';
      return t <= .5 ? `color-mix(in srgb, var(--series-dim) ${Math.round(Math.max(18, t * 200))}%, transparent)` : `color-mix(in srgb, var(--accent) ${Math.round((t - .5) * 200)}%, var(--series-dim))`;
    };
    /* The muscle window is the selected period, optionally stepped back by whole periods (off = 0, -1, ...). */
    const mzState = { off: 0 };
    const mzWin = () => {
      const len = S.win.daily ? S.win.n : S.win.n * 7, from = addDays(S.win.from, mzState.off * len);
      return { from, to: addDays(from, len - 1) };
    };
    const mzFirst = () => {
      const days = Object.keys(strength.muscleDays || {});
      return days.length ? days[0] : `${Object.keys(strength.muscles)[0]}-01`;
    };
    const mzData = () => {
      const { from, to } = mzWin(), scores = {}, sets = {}, prim = {};
      const add = (g, p, sec, wt = 1) => { const k = MZ_ALIAS[g] || g; scores[k] = (scores[k] || 0) + (p + .5 * sec) * wt; sets[k] = (sets[k] || 0) + (p + sec) * wt; prim[k] = (prim[k] || 0) + p * wt; };
      if (Object.keys(strength.muscleDays).length) {
        Object.keys(strength.muscleDays).forEach(d => { if (d >= from && d <= to) Object.keys(strength.muscleDays[d]).forEach(g => add(g, strength.muscleDays[d][g][0], strength.muscleDays[d][g][1])); });
      } else {
        /* Older data only has calendar-month totals. Each month overlapping the window counts in proportion to the share of its days inside the window, so edge months are an approximation. */
        Object.keys(strength.muscles).forEach(m => {
          const m0 = `${m}-01`, mDays = dayNum(fromNum(dayNum(m0) + 31).slice(0, 7) + '-01') - dayNum(m0);
          const frac = Math.max(0, Math.min(dayNum(to), dayNum(m0) + mDays - 1) - Math.max(dayNum(from), dayNum(m0)) + 1) / mDays;
          if (!frac) return;
          const counts = (strength.muscleSets || {})[m];
          if (counts) Object.keys(counts).forEach(g => add(g, counts[g][0], counts[g][1], frac));
          else Object.keys(strength.muscles[m]).forEach(g => { const k = MZ_ALIAS[g] || g, v = strength.muscles[m][g] * frac; scores[k] = (scores[k] || 0) + v; sets[k] = (sets[k] || 0) + v; });
        });
      }
      return { from, to, scores, sets, prim, max: Math.max(0, ...Object.values(scores)) };
    };
    const mzTip = (d, g) => `<b>${esc(mzName(g))}</b> · ${nf(d.sets[g] || 0, 0)} sets${d.prim[g] != null ? ` (${nf(d.prim[g], 0)} primary)` : ''}`;
    const mzLabel = d => {
      if (!mzState.off) return PERIOD_LABEL[S.period];
      const to = d.to > today ? today : d.to, yr = d.from.slice(0, 4) !== to.slice(0, 4);
      return `${fd(d.from, yr ? 'long' : 'md')} – ${fd(to, yr || to.slice(0, 4) !== today.slice(0, 4) ? 'long' : 'md')}`;
    };
    const mzView = (name, regions, d) => {
      let s = `<svg class="mz-fig" viewBox="0 0 100 196" width="92" height="180" role="group" aria-label="${esc(`${name} view`)}"><ellipse class="mz-d" cx="50" cy="12.5" rx="7.6" ry="9.6"/>`;
      s += MZ_DECOR.map(p => `<path class="mz-d" d="${p}"/><path class="mz-d" d="${p}" transform="${MZ_MIRROR}"/>`).join('');
      Object.keys(regions).forEach(g => {
        const sc = d.scores[g] || 0, t = d.max ? sc / d.max : 0;
        const label = sc ? `${mzName(g)}, ${nf(d.sets[g] || 0, 0)} sets${d.prim[g] != null ? `, ${nf(d.prim[g], 0)} primary` : ''}` : `${mzName(g)}, no sets`;
        s += `<g class="mz-r" data-g="${g}" tabindex="0" role="img" aria-label="${esc(label)}" fill="${mzFill(t)}" data-tip="${esc(mzTip(d, g))}">${regions[g].map(p => `<path d="${p}"/><path d="${p}" transform="${MZ_MIRROR}"/>`).join('')}</g>`;
      });
      return `${s}</svg>`;
    };
    const drawMuscles = () => {
      const box = $('#muscles'); if (!box) return;
      const d = mzData(), label = mzLabel(d), ranked = Object.keys(d.scores).sort((a, b) => d.scores[b] - d.scores[a] || a.localeCompare(b)).slice(0, 8);
      const top = ranked.slice(0, 3).map(g => `${mzName(g)} ${nf(d.sets[g], 0)}`).join(', ');
      const summary = ranked.length ? `${label}: most-worked muscle groups by sets: ${top}` : `${label}: no lifting`;
      const nav = `<div class="mz-nav"><button type="button" class="mz-btn" data-mz="-1" aria-label="Previous period"${d.from <= mzFirst() ? ' disabled' : ''}>←</button><span class="mz-month" aria-live="polite">${esc(label)}</span><button type="button" class="mz-btn" data-mz="1" aria-label="Next period"${mzState.off >= 0 ? ' disabled' : ''}>→</button></div>`;
      if (!ranked.length) { box.innerHTML = `${nav}${emptyState('No lifting in this period.')}`; return; }
      box.innerHTML = `${nav}
        <div class="mz-body"><div class="mz-figs" aria-label="${esc(summary)}"><figure>${mzView('Front', MZ_FRONT, d)}<figcaption>Front</figcaption></figure><figure>${mzView('Back', MZ_BACK, d)}<figcaption>Back</figcaption></figure></div>
        <ol class="mz-rank" aria-label="${esc(`Top muscle groups, ${label}`)}">${ranked.map(g => `<li data-g="${g}"><span class="n">${esc(mzName(g))}</span><span class="b"><i style="width:${Math.max(3, Math.round(d.scores[g] / d.max * 100))}%"></i></span><span class="v">${nf(d.sets[g], 0)}</span></li>`).join('')}</ol></div>
        <div class="legend"><span><i class="sw mz-scale"></i>fewer → more sets</span></div>`;
    };
    const wireMuscles = () => {
      const box = $('#muscles'); if (!box) return;
      bindTip(box);
      box.addEventListener('click', e => {
        const b = e.target.closest('[data-mz]'); if (!b || b.disabled) return;
        mzState.off = Math.min(0, mzState.off + Number(b.dataset.mz)); drawMuscles();
        const nb = box.querySelector(`[data-mz="${b.dataset.mz}"]:not([disabled])`) || box.querySelector('.mz-btn:not([disabled])'); nb && nb.focus();
      });
      box.addEventListener('focusin', e => { const r = e.target.closest && e.target.closest('.mz-r'); r && showTip(r.getAttribute('data-tip'), 0, 0, r.getBoundingClientRect()); });
      box.addEventListener('focusout', e => { if (e.target.closest && e.target.closest('.mz-r')) hideTip(); });
      drawMuscles();
    };
    /* exercises restricted to the window: session counts, series and bests all come from the window's days */
    const winExercises = () => (strength ? strength.exercises.map(e => {
      const series = e.series.filter(p => inWin(p.date)), best = series.reduce((m, p) => (!m || p.v > m.v ? p : m), null);
      return { ...e, series, sessions: series.length, winBest: best, best: e.best && inWin(e.best.date) ? e.best : null };
    }).filter(e => e.series.length) : []);
    const drawMultiple = ex => w => {
      const left = 34, right = 8, top = 18, plotH = 62, bottom = 20, H = top + plotH + bottom, plotW = w - left - right;
      const d0 = dayNum(S.win.from), span = Math.max(1, dayNum(S.win.last) - d0);
      const vs = ex.series.map(p => p.v), rng = Math.max(...vs) - Math.min(...vs), step = rng <= 40 ? 5 : rng <= 100 ? 10 : rng <= 250 ? 25 : 50;
      let lo = Math.floor(Math.min(...vs) / step) * step, hi = Math.ceil(Math.max(...vs) / step) * step;
      if (hi - lo < step) hi = lo + step;
      const x = d => left + ((dayNum(d) - d0) / span) * plotW, y = v => top + plotH - ((v - lo) / (hi - lo)) * plotH;
      let s = `<svg width="${w}" height="${H}" viewBox="0 0 ${w} ${H}" role="img" aria-label="${esc(`${ex.title}: estimated one-rep max, ${ex.series.length} sessions, ${nf(ex.series[0].v, 0)} to ${nf(ex.series[ex.series.length - 1].v, 0)} lb, best ${nf(ex.winBest.v, 0)} lb`)}">`;
      [lo, hi].forEach(v => { s += `<line class="grid" x1="${left}" x2="${w - right}" y1="${y(v)}" y2="${y(v)}"/><text class="y" x="${left - 6}" y="${y(v) + 4}">${nf(v, 0)}</text>`; });
      s += winTicks(S.win.from, S.win.last, x, H - 4, 46, w - 24);
      if (ex.series.length > 1) s += `<path d="${ex.series.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.v).toFixed(1)}`).join('')}" fill="none" stroke="${COL.series}" stroke-width="1" stroke-linejoin="round" stroke-linecap="round"/>`;
      const best = ex.winBest;
      ex.series.forEach(p => { if (p !== best) s += `<circle cx="${x(p.date).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="1.5" fill="${COL.series}"/>`; });
      const bx = x(best.date), by = y(best.v);
      const anchor = bx > w - right - 14 ? 'end' : bx < left + 14 ? 'start' : 'middle';
      s += `<circle cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="3" fill="${COL.accent}"/><text class="best" x="${(anchor === 'end' ? bx + 3 : anchor === 'start' ? bx - 3 : bx).toFixed(1)}" y="${(by - 8).toFixed(1)}" text-anchor="${anchor}">${nf(best.v, 0)}</text>`;
      ex.series.forEach(p => {
        const tip = `<b>${esc(ex.title)}</b><br>${esc(fd(p.date, 'long'))}<br>e1RM ${nf(p.v, 0)} lb`;
        s += `<circle cx="${x(p.date).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="7" fill="transparent" data-tip="${esc(tip)}"/>`;
      });
      return `${s}</svg>`;
    };
    const exRows = () => winExercises().map(e => ({ ...e, last: e.series[e.series.length - 1].date, top: e.winBest.v }));
    const EX_COLS = [
      { k: 'title', l: 'Exercise', v: e => e.title.toLowerCase(), c: 'l' },
      { k: 'sessions', l: 'Sessions', v: e => e.sessions },
      { k: 'set', l: 'Best set', v: e => (e.best ? e.best.weightLb : 0), c: 'hide-s' },
      { k: 'top', l: 'Best e1RM', v: e => e.top },
      { k: 'last', l: 'Last', v: e => e.last },
    ];
    const SX = { key: 'sessions', dir: -1 };
    const bestSet = e => (e.best ? `${e.best.reps} × ${nf(e.best.weightLb, 1)}` : '—');
    const drawExTable = () => {
      const col = EX_COLS.find(c => c.k === SX.key), rows = exRows().sort((a, b) => ((col.v(a) < col.v(b) ? -1 : col.v(a) > col.v(b) ? 1 : 0) * SX.dir) || a.title.localeCompare(b.title));
      const rowsAll = rows;
      if (!rowsAll.length) { $('#str-table').innerHTML = emptyState('No sessions in this period.'); return; }
      $('#str-table').innerHTML = `<table class="data ex-table"><caption class="sr-only">Exercises by sessions in the period, best set, best estimated one-rep max and last trained</caption><thead><tr>${EX_COLS.map(c => `<th scope="col" class="${c.c || ''}" aria-sort="${SX.key === c.k ? (SX.dir > 0 ? 'ascending' : 'descending') : 'none'}"><button type="button" data-xsort="${c.k}">${c.l}</button></th>`).join('')}</tr></thead><tbody>${rows.map(e => `<tr><td class="l">${esc(e.title)}<span class="sub">${esc(bestSet(e))}${e.best ? ' lb' : ''}</span></td><td>${e.sessions}</td><td class="hide-s">${esc(bestSet(e))}${e.best ? ' lb' : ''}</td><td>${nf(e.top, 0)} lb</td><td>${esc(fd(e.last, 'md'))}${e.last.slice(0, 4) !== today.slice(0, 4) ? ` ${e.last.slice(2, 4) === '' ? '' : `’${e.last.slice(2, 4)}`}` : ''}</td></tr>`).join('')}</tbody></table>`;
    };

    /* ---------- Body weight: smoothed change from the first day of the window ---------- */
    const bwWin = () => {
      const pts = bw ? bw.filter(p => inWin(p.date)) : [];
      return pts.length >= 2 ? pts.map(p => ({ date: p.date, v: p.v - pts[0].v })) : null;
    };
    const drawBw = w => {
      const pts = bwWin();
      if (!pts) return emptyState('No weight data in this period.');
      const left = 40, right = 8, top = 10, plotH = 110, bottom = 22, H = top + plotH + bottom, plotW = w - left - right;
      const d0 = dayNum(pts[0].date), span = Math.max(1, dayNum(pts[pts.length - 1].date) - d0);
      const vs = pts.map(p => p.v).concat(0), step = 1;
      const lo = Math.floor(Math.min(...vs) / step) * step, hi = Math.max(lo + step * 2, Math.ceil(Math.max(...vs) / step) * step);
      const x = d => left + ((dayNum(d) - d0) / span) * plotW, y = v => top + plotH - ((v - lo) / (hi - lo)) * plotH;
      const last = pts[pts.length - 1];
      let s = `<svg width="${w}" height="${H}" viewBox="0 0 ${w} ${H}" role="img" aria-label="${esc(`Body weight trend: ${signed(last.v)} lb since ${fd(pts[0].date, 'md')}`)}">`;
      [lo, hi].forEach(v => { if (v !== 0) s += `<line class="grid" x1="${left}" x2="${w - right}" y1="${y(v)}" y2="${y(v)}"/><text class="y" x="${left - 6}" y="${y(v) + 4}">${signed(v, 0)}</text>`; });
      s += `<line x1="${left}" x2="${w - right}" y1="${y(0)}" y2="${y(0)}" stroke="${COL.faint}" stroke-width="1" shape-rendering="crispEdges"/><text class="y" x="${left - 6}" y="${y(0) + 4}">0</text>`;
      s += winTicks(pts[0].date, last.date, x, H - 6, 54, w - 24);
      s += `<path d="${pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.v).toFixed(1)}`).join('')}" fill="none" stroke="${COL.text}" stroke-width="1.25" stroke-linejoin="round" stroke-linecap="round"/>`;
      s += `<circle cx="${x(last.date).toFixed(1)}" cy="${y(last.v).toFixed(1)}" r="3" fill="${COL.accent}"/>`;
      const cw = Math.max(3, plotW / (span + 1));
      pts.forEach(p => { s += `<rect class="hv" x="${(x(p.date) - cw / 2).toFixed(1)}" y="${top}" width="${cw.toFixed(1)}" height="${plotH}" fill="transparent" data-tip="${esc(`<b>${esc(fd(p.date, 'long'))}</b><br>${signed(p.v)} lb`)}"/>`; });
      return `${s}</svg>`;
    };

    /* ---------- wiring ---------- */
    const runRibbon = mount($('#ribbon'), drawRibbon);
    const runWeekly = mount($('#weekly'), drawWeekly);
    const runYoy = mount($('#yoy'), drawYoy);
    const runSeason = mount($('#season'), drawSeason);
    const runRecHrv = well ? mount($('#rec-hrv'), drawTrend('hrv')) : () => {};
    const runRecRhr = well ? mount($('#rec-rhr'), drawTrend('rhr')) : () => {};
    const runStrWeekly = strength ? mount($('#str-weekly'), drawStrWeekly) : () => {};
    const runBw = bw ? mount($('#bw-chart'), drawBw) : () => {};
    [$('#ribbon'), $('#weekly'), $('#yoy'), $('#season'), $('#rec-hrv'), $('#rec-rhr'), $('#str-weekly'), $('#bw-chart')].filter(Boolean).forEach(bindTip);
    bindCard($('#ribbon')); bindCard($('#season'));
    $('#season').addEventListener('click', e => {
      const h = e.target.closest('.s-hit');
      if (!h) return;
      const d = h.dataset.date;
      S.range && S.range.from === d && S.range.to === d ? setRange('') : setRange(d, d, fd(d));
    });
    $('#yoy').addEventListener('pointermove', yoyHover);
    $('#yoy').addEventListener('pointerleave', () => { const xh = $('#yoy-xh'); xh && xh.setAttribute('visibility', 'hidden'); });

    const rib = $('#ribbon');
    const setLegend = (id, html) => { const el = $(id); if (el) { el.innerHTML = html; el.hidden = !html; } };

    /* strength, muscle map and body weight depend only on the period, not on the sport or metric toggles */
    const refreshPeriodParts = () => {
      const lbl = PERIOD_LABEL[S.period];
      if (strength) {
        const t = strTotals(), B = bucketsOf();
        $('#str-cap').textContent = t.n ? `${lbl} · ${t.n} ${t.n === 1 ? 'session' : 'sessions'} · ${nf(t.v, 0)} lb lifted` : `${lbl} · no sessions`;
        runStrWeekly();
        setLegend('#str-wk-legend', t.n ? `<span><i class="sw bar"></i>${B.daily ? 'Day' : 'Week'}</span>${B.daily ? '' : '<span><i class="sw dash"></i>4-week average</span>'}` : '');
        mzState.off = 0; drawMuscles();
        const box = $('#str-multi');
        if (box) {
          const multi = winExercises().sort((a, b) => b.sessions - a.sessions).slice(0, 6);
          box.innerHTML = multi.length ? multi.map((e, i) => `<figure><figcaption>${esc(e.title)}<span>${nf(e.winBest.v, 0)} lb</span></figcaption><div class="chart" id="str-m${i}"></div></figure>`).join('') : emptyState('No sessions in this period.');
          multi.forEach((e, i) => { mount($(`#str-m${i}`), drawMultiple(e)); bindTip($(`#str-m${i}`)); });
          $('#str-multi-legend').hidden = !multi.length;
          drawExTable();
        }
      }
      if (bw) {
        const pts = bwWin();
        $('#bw-label').innerHTML = pts ? `<b>${signed(pts[pts.length - 1].v)} lb</b> since ${esc(fd(pts[0].date, 'md'))}` : '';
        $('#bw-label').hidden = !pts;
        $('#bw-cap').textContent = `${lbl} · smoothed trend, change only`;
        runBw();
      }
    };
    if (strength && $('#str-multi')) {
      $('#str-table').addEventListener('click', e => {
        const b = e.target.closest('[data-xsort]');
        if (!b) return;
        const k = b.dataset.xsort; SX.dir = SX.key === k ? -SX.dir : (k === 'title' ? 1 : -1); SX.key = k; drawExTable();
      });
    }
    if (strength) wireMuscles();

    const caps = () => {
      const fa = winActs(filt()), B = bucketsOf(), lbl = PERIOD_LABEL[S.period];
      $('#wk-cap').textContent = `${unitLabel()} per ${B.daily ? 'day' : 'week'}${S.group === 'all' ? '' : ` · ${GROUP_LABEL[S.group]}`}`;
      setLegend('#wk-legend', fa.length ? `<span><i class="sw bar"></i>${B.daily ? 'Day' : 'Week'}</span>${B.daily ? '' : '<span><i class="sw dash"></i>4-week average</span>'}${blocks.length ? '<span><i class="sw band"></i>Training block</span>' : ''}<span><i class="sw hatch"></i>Not synced</span>` : '');
      if (well) {
        const hrv = well.days.filter(d => inWin(d.date) && d.hrv != null).length, nights = well.days.filter(d => inWin(d.date)).length;
        $('#rec-cap').textContent = `${lbl} · ${nights} ${nights === 1 ? 'night' : 'nights'}`;
        $('#rec-legend').hidden = hrv < 2;
      }
      $('#yoy-cap').textContent = `Cumulative ${isDur() ? 'time' : 'distance'} by day${cov.start.slice(5) !== '01-01' ? ` · ${cov.start.slice(0, 4)} from ${fd(cov.start, 'md')}` : ''}`;
      weeklySummary = `${isDur() ? 'Training time' : 'Training distance'} per ${B.daily ? 'day' : 'week'}, ${fa.length} activities across ${B.n} ${B.daily ? 'days' : 'weeks'}`;
      $('#t-rib').textContent = isYear() ? 'Year ribbon' : 'Daily ribbon';
      $('#t-rib').nextElementSibling.textContent = isYear() ? 'One cell per day, coloured by training time' : `One cell per day, ${lbl.toLowerCase()}, coloured by training time`;
      rib.setAttribute('aria-label', `${isYear() ? 'Year ribbon' : 'Daily ribbon'}. Arrow keys move between days; Enter shows that day's activities.`);
      setLegend('#rib-legend', fa.length ? '<span><i class="sw scale"></i>Less → more time</span><span><i class="sw hatch"></i>Not synced</span>' : '');
    };
    /* URL keeps the period (omitted for the default) and a selected single day */
    const syncUrl = hash => {
      const u = new URL(location.href);
      if (S.period === 'quarter') u.searchParams.delete('period'); else u.searchParams.set('period', S.period);
      if (S.range && S.range.from === S.range.to) u.searchParams.set('date', S.range.from); else u.searchParams.delete('date');
      history.replaceState(null, '', u.pathname + u.search + hash);
    };
    const setRange = (from, to, label) => {
      S.range = from ? { from, to, label } : null; S.limit = 50;
      syncUrl(from ? '#activities' : '');
      hideCard(); runRibbon(); drawList();
      if (from) $('#activities').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    };
    const refresh = () => {
      hideCard(); caps();
      $('#yoy-sec').hidden = !isYear();
      runSeason(); drawSeasonText(); runRecHrv(); runRecRhr(); runRibbon(); runWeekly(); if (isYear()) runYoy(); drawMix(); drawMonths(); drawList();
      $$('#metric-seg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.metric === S.metric)));
      $$('#group-chips button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.g === S.group)));
    };
    const setPeriod = k => {
      if (k === S.period) return;
      S.period = k; S.win = periodWin(k, today); S.range = null; S.limit = 50; kb = '';
      $$('#period-seg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.period === k)));
      syncUrl('');
      refresh(); refreshPeriodParts();
      rib.scrollLeft = isYear() ? Math.max(0, rib.scrollWidth - rib.clientWidth) : 0;
    };
    $('#period-seg').addEventListener('click', e => { const b = e.target.closest('[data-period]'); if (b) setPeriod(b.dataset.period); });
    $('.t-controls').addEventListener('click', e => {
      const m = e.target.closest('[data-metric]'), g = e.target.closest('[data-g]');
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
      const base = kb || (S.range ? S.range.from : isYear() ? lastDate : S.win.last);
      if (e.key === 'ArrowLeft') nd = addDays(base, -1);
      else if (e.key === 'ArrowRight') nd = addDays(base, 1);
      else if (isYear() && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { const y = +base.slice(0, 4) + (e.key === 'ArrowUp' ? 1 : -1); nd = `${y}${base.slice(4, 10)}`; if (!isDay(fromNum(dayNum(nd))) || fromNum(dayNum(nd)) !== nd) nd = `${y}-02-28`; }
      else if (e.key === 'Enter' && kb) { const o = ribMap.get(kb); if (o) S.range && S.range.from === kb ? setRange('') : setRange(kb, kb, fd(kb)); e.preventDefault(); return; }
      else return;
      e.preventDefault();
      if (isYear() ? (nd < `${y0}-01-01` || +nd.slice(0, 4) > y1) : nd < S.win.from) return;
      if (nd > today) return;
      kb = nd; runRibbon();
      $('#rib-live').textContent = dayTip(kb).text;
      const cx = ribGeom.cx(kb);
      if (cx < rib.scrollLeft + 40) rib.scrollLeft = cx - 60; else if (cx > rib.scrollLeft + rib.clientWidth - 40) rib.scrollLeft = cx - rib.clientWidth + 60;
      const cell = rib.querySelector(`rect.day[data-date="${kb}"]`);
      if (cell) showCard(kb, 0, 0, cell.getBoundingClientRect());
    });
    rib.addEventListener('blur', () => { hideCard(); if (kb) { kb = ''; runRibbon(); } });
    $('#weekly').addEventListener('click', e => {
      const h = e.target.closest('rect.hit');
      if (!h) return;
      const B = bucketsOf(), from = B.from(+h.dataset.b), to = B.to(+h.dataset.b);
      setRange(from, to, B.daily ? fd(from) : `${fd(from, 'md')} – ${fd(to, 'md')}`);
    });
    $('#act-list').addEventListener('click', e => {
      const sb = e.target.closest('[data-sort]');
      if (sb) { const k = sb.dataset.sort; S.sortDir = S.sortKey === k ? -S.sortDir : (k === 'title' || k === 'sport' ? 1 : -1); S.sortKey = k; drawList(); }
      else if (e.target.id === 'list-more') { S.limit += 50; drawList(); }
      else if (e.target.closest('#clear-range')) setRange('');
    });
    refresh(); refreshPeriodParts();
    rib.scrollLeft = isYear() ? Math.max(0, rib.scrollWidth - rib.clientWidth) : 0;
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
      shellTags = new Set((Array.isArray(data.entries) ? data.entries : []).flatMap(e => (Array.isArray(e && e.tags) ? e.tags : [])).map(t => String(t).toLowerCase().replace(/^#/, '').trim()));
      if (path === '/') await renderHome(data, entries);
      else if (path === '/stream') await renderStream(data, entries);
      else if (path === '/writing') renderWriting(data, entries);
      else if (path === '/stream/training') await renderTraining(data, entries);
      else if (path === '/library') renderLibrary(data, entries);
      else if (path === '/projects') renderLibrary(data, entries);
      else if (path === '/photos') renderPhotos(data, entries);
      else if (path === '/tags') renderTags(data, entries);
      else if (/^\/tags\/[^/]+$/.test(path)) renderTag(data, entries, path.slice(6).toLowerCase());
      else if (path === '/archive' || /^\/archive\/\d{4}-\d{2}$/.test(path)) await renderArchive(data, entries);
      else page('<div class="error-state"><h1 class="h-display">Not found</h1><p><a href="/">Home →</a></p></div>');
    } catch (err) {
      console.error(err);
      page(`<div class="error-state"><h1 class="h-display">Could not load</h1><p>${esc(err.message)}</p><p><a href="">Reload</a></p></div>`);
    }
  };
  main();
})();
