/* Injected into every Quartz-rendered page: site header/footer, reading mode,
   "Related" label, the note metadata strip, and the activity panel (metrics, charts, splits). */
(() => {
  'use strict';
  const root = document.documentElement;
  const body = document.body;
  body.classList.add('article-page');

  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = n => String(n).padStart(2, '0');
  const nf = (n, max = 1) => new Intl.NumberFormat('en-US', { maximumFractionDigits: max }).format(n);
  const has = v => v != null && v !== '' && !Number.isNaN(+v);
  const safeUrl = v => { try { const u = new URL(v, location.origin); return ['http:', 'https:'].includes(u.protocol) ? u.href : '#'; } catch { return '#'; } };
  const urlHref = u => safeUrl(u && u.startsWith('/') && !u.endsWith('/') && !/\.html(?:[?#]|$)/.test(u) ? `${u}.html` : u);
  const parseDay = s => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d, 12); };
  const fmtDate = s => new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(parseDay(s));

  /* ---------------- reading mode ---------------- */
  const KEY = 'reading-mode';
  const readPref = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
  const writePref = on => { try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* storage unavailable */ } };
  const applyReading = on => { if (on) root.setAttribute('data-reading', 'on'); else root.removeAttribute('data-reading'); };
  applyReading(readPref());

  /* ---------------- chrome ---------------- */
  const p = location.pathname;
  const cur = href => (href === '/about.html' ? p === '/about.html' || p === '/about' : p.startsWith(href));
  const nav = [['/stream/', 'Stream'], ['/writing/', 'Writing'], ['/library/', 'Library'], ['/about.html', 'About']]
    .map(([h, l]) => `<a href="${h}"${cur(h) ? ' aria-current="page"' : ''}>${l}</a>`).join('');
  const header = document.createElement('header');
  header.className = 'site-header';
  header.innerHTML = `<div class="header-inner"><a class="brand" href="/" aria-label="Vedant Agrawal, home"><span class="brand-mark">v<span>.</span></span><span class="brand-name">Vedant Agrawal</span></a><div class="header-right"><nav class="main-nav" aria-label="Main">${nav}</nav><button type="button" class="reading-toggle" aria-pressed="${readPref()}">Reading mode</button></div></div>`;
  body.prepend(header);
  const skip = document.createElement('a');
  skip.className = 'skip-link'; skip.href = '#quartz-body'; skip.textContent = 'Skip to content';
  body.prepend(skip);
  const footer = document.createElement('footer');
  footer.className = 'site-footer';
  footer.innerHTML = `<div class="footer-inner"><span>© ${new Date().getFullYear()} Vedant Agrawal</span><nav aria-label="Footer"><a href="/archive/">Archive</a><a href="/index.xml">RSS</a></nav></div>`;
  body.append(footer);
  const toggle = header.querySelector('.reading-toggle');
  toggle.addEventListener('click', () => {
    const on = !root.hasAttribute('data-reading');
    applyReading(on); writePref(on);
    toggle.setAttribute('aria-pressed', String(on));
  });

  /* Quartz backlinks -> quiet "Related" */
  const bl = document.querySelector('.backlinks > h3');
  if (bl) bl.textContent = 'Related';

  /* ================================================================
     Note metadata strip (type, topics, dates, reading time, copy link / cite)
  ================================================================ */
  const SITE = 'https://vedants-agrawal.github.io';
  const TYPE_LABEL = { writing: 'Writing', reflection: 'Reflection', photo: 'Photo', literature: 'Library', concept: 'Concept', evergreen: 'Note', project: 'Project', activity: 'Training', page: 'Page', month: 'Archive', block: 'Training block' };
  const MEDIUM_LABEL = { book: 'Book', article: 'Article', film: 'Film', video: 'Video', podcast: 'Podcast', paper: 'Paper' };
  const normPath = u => { let s = String(u || ''); try { s = decodeURIComponent(s); } catch { /* keep raw */ } return s.replace(/[?#].*$/, '').replace(/\.html$/, '').replace(/\/index$/, '').replace(/\/+$/, '') || '/'; };
  const day = s => (/^\d{4}-\d{2}-\d{2}/.test(String(s || '')) ? String(s).slice(0, 10) : '');
  const shortDate = s => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(parseDay(s));
  const bibEsc = v => String(v).replace(/([&%$#_{}])/g, '\\$1');
  const copyText = text => {
    const legacy = () => { const t = document.createElement('textarea'); t.value = text; t.setAttribute('readonly', ''); t.style.cssText = 'position:fixed;top:0;left:0;opacity:0'; body.append(t); t.select(); let ok = false; try { ok = document.execCommand('copy'); } catch { /* ignore */ } t.remove(); return ok; };
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).then(() => true, () => legacy());
    return Promise.resolve(legacy());
  };

  const renderMeta = entry => {
    const anchor = document.querySelector('.page-header');
    if (!anchor || document.querySelector('.note-meta')) return;
    const isPage = entry.type === 'page';
    const pub = day(entry.published) || day(entry.date);
    const upd = day(entry.updated);
    const facts = [];
    if (!isPage && pub) facts.push(`<span>published <time datetime="${esc(pub)}">${esc(shortDate(pub))}</time></span>`);
    if (upd && (isPage || upd !== pub)) facts.push(`<span>updated <time datetime="${esc(upd)}">${esc(shortDate(upd))}</time></span>`);
    const words = Number(entry.words);
    if (!isPage && entry.type !== 'activity' && Number.isFinite(words) && words > 0) facts.push(`<span>${Math.max(1, Math.round(words / 230))} min read</span>`);
    /* tags (falling back to topics), shown as #tag */
    const tags = !isPage ? [...new Set((Array.isArray(entry.tags) ? entry.tags : Array.isArray(entry.topics) ? entry.topics : []).map(t => String(t).toLowerCase().replace(/^#/, '').trim()).filter(Boolean))] : [];
    const label = (entry.type === 'literature' && MEDIUM_LABEL[entry.medium]) || TYPE_LABEL[entry.type] || '';
    const strip = document.createElement('div');
    strip.className = 'note-meta';
    strip.setAttribute('role', 'group');
    strip.setAttribute('aria-label', 'Note details');
    const parts = [];
    if (!isPage && label) parts.push(`<span class="nm-type">${esc(label)}</span>`);
    if (tags.length) parts.push(`<span class="nm-topics" aria-label="Tags">${tags.map(t => `#${esc(t)}`).join(' ')}</span>`);
    parts.push(...facts);
    strip.innerHTML = `${parts.length ? `<p class="nm-line">${parts.join('<span class="sep" aria-hidden="true">·</span>')}</p>` : ''}${isPage ? '' : '<span class="nm-actions"><button type="button" data-act="link">Copy link</button><button type="button" data-act="cite">Cite</button><span class="nm-status" role="status" aria-live="polite"></span></span>'}`;
    if (!strip.children.length) return;
    anchor.insertAdjacentElement('afterend', strip);

    const status = strip.querySelector('.nm-status');
    let timer = 0;
    const say = msg => { if (!status) return; status.textContent = msg; clearTimeout(timer); timer = setTimeout(() => { status.textContent = ''; }, 2200); };
    strip.addEventListener('click', e => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      const url = SITE + normPath(entry.url);
      let text = url;
      if (b.dataset.act === 'cite') {
        const year = (pub || day(entry.date) || String(new Date().getFullYear())).slice(0, 4);
        const slug = normPath(entry.url).split('/').pop().toLowerCase().replace(/[^a-z0-9]/g, '');
        const t = new Date();
        const accessed = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
        text = `@misc{agrawal${year}${slug},\n  author = {Vedant Agrawal},\n  title = {${bibEsc(entry.title || document.title)}},\n  year = {${year}},\n  url = {${url}},\n  note = {Accessed ${accessed}}\n}`;
      }
      copyText(text).then(ok => say(ok ? 'Copied' : 'Copy failed'));
    });
  };

  fetch('/site-data.json')
    .then(r => (r.ok ? r.json() : null))
    .then(data => {
      if (!data || !Array.isArray(data.entries)) return;
      const here = normPath(location.pathname);
      const entry = data.entries.find(e => e && normPath(e.url) === here);
      if (entry) renderMeta(entry);
    })
    .catch(() => { /* metadata is optional */ });

  /* ================================================================
     Activity panel
  ================================================================ */
  const host = document.querySelector('.activity-panel[data-activity]');
  if (!host) return;

  const fmtClock = s => {
    s = Math.round(s);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return h ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
  };
  const fmtPace = s => { s = Math.round(s); return `${Math.floor(s / 60)}:${pad(s % 60)}`; };
  const guessGroup = sport => {
    const s = String(sport || '').toLowerCase();
    return /run|jog|treadmill/.test(s) ? 'run' : /cycl|ride|bike/.test(s) ? 'ride' : /swim/.test(s) ? 'swim' : /walk/.test(s) ? 'walk' : /hike/.test(s) ? 'hike' : /strength/.test(s) ? 'strength' : 'other';
  };
  const PACE_GROUPS = ['run', 'walk', 'hike'];

  /* imperial display; the data files stay metric. Swims read in yards, pace per 100 yd. */
  const MI = 1.609344, YD = 1093.61, FT = 3.28084;
  const toF = c => c * 1.8 + 32;
  const yards = km => { const yd = km * YD; return nf(yd < 100 ? Math.round(yd) : Math.round(yd / 10) * 10, 0); };
  const distParts = (group, km) => (group === 'swim' ? [yards(km), 'yd'] : [(km / MI).toFixed(2), 'mi']);

  const metricGrid = (m, group) => {
    const items = [];
    const add = (label, value, unit) => items.push(`<div><dt>${label}</dt><dd>${value}${unit ? `<small>${unit}</small>` : ''}</dd></div>`);
    if (has(m.durationS)) add('Time', fmtClock(m.durationS));
    if (has(m.movingS) && Math.abs(m.movingS - m.durationS) > 1) add('Moving time', fmtClock(m.movingS));
    if (has(m.distanceKm)) add('Distance', ...distParts(group, m.distanceKm));
    if (PACE_GROUPS.includes(group)) {
      if (has(m.paceSPerKm)) add('Pace', fmtPace(m.paceSPerKm * MI), '/mi');
      else if (has(m.speedKmh) && m.speedKmh > 0) add('Pace', fmtPace((3600 / m.speedKmh) * MI), '/mi');
      if (has(m.movingPaceSPerKm)) add('Moving pace', fmtPace(m.movingPaceSPerKm * MI), '/mi');
      if (has(m.adjustedPaceSPerKm)) add('Adjusted pace', fmtPace(m.adjustedPaceSPerKm * MI), '/mi');
      if (has(m.bestKmSPerKm)) add('Best split pace', fmtPace(m.bestKmSPerKm * MI), '/mi');
    } else if (group === 'swim' && has(m.paceSPerKm)) {
      add('Pace', fmtPace((m.paceSPerKm / 10) * 0.9144), '/100 yd');
    } else if (has(m.speedKmh)) {
      add('Speed', nf(m.speedKmh / MI, 1), 'mph');
    }
    if (has(m.avgHr)) add('Avg HR', Math.round(m.avgHr), 'bpm');
    if (has(m.maxHr)) add('Max HR', Math.round(m.maxHr), 'bpm');
    if (has(m.cadence)) add('Cadence', Math.round(m.cadence), group === 'ride' ? 'rpm' : 'spm');
    if (has(m.strideM)) add('Stride', nf(m.strideM * FT, 1), 'ft');
    if (has(m.power)) add('Power', Math.round(m.power), 'W');
    if (has(m.normalizedPower)) add('Normalized power', Math.round(m.normalizedPower), 'W');
    if (has(m.elevGainM)) add('Elevation gain', Math.round(m.elevGainM * FT), 'ft');
    if (has(m.elevLossM)) add('Elevation loss', Math.round(m.elevLossM * FT), 'ft');
    if (has(m.waterTempC)) add('Water temp', Math.round(toF(m.waterTempC)), '°F');
    if (has(m.calories)) add('Calories', Math.round(m.calories), 'kcal');
    if (has(m.load)) add('Load', Math.round(m.load));
    if (has(m.aerobicTE)) add('Aerobic effect', nf(m.aerobicTE, 1));
    if (has(m.anaerobicTE)) add('Anaerobic effect', nf(m.anaerobicTE, 1));
    if (m.focus) add('Focus', esc(m.focus));
    return items.length ? `<dl class="metric-grid">${items.join('')}</dl>` : '';
  };

  const splitsTable = (laps, group) => {
    if (!Array.isArray(laps) || !laps.length) return '';
    const any = k => laps.some(l => has(l[k]));
    const usePace = PACE_GROUPS.includes(group) && any('paceSPerKm');
    const useSpeed = !usePace && any('speedKmh');
    const vals = laps.map(l => (usePace ? +l.paceSPerKm : useSpeed ? +l.speedKmh : NaN)).filter(v => !Number.isNaN(v));
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const bar = l => {
      const v = usePace ? +l.paceSPerKm : +l.speedKmh;
      if (Number.isNaN(v) || hi === lo) return '';
      const f = usePace ? (hi - v) / (hi - lo) : (v - lo) / (hi - lo);
      return `<span class="pbar" style="width:${Math.round(14 + f * 34)}px" aria-hidden="true"></span>`;
    };
    const cols = [];
    cols.push(['#', l => l.index ?? '', true]);
    if (any('distanceKm')) cols.push(['Distance', l => (has(l.distanceKm) ? distParts(group, l.distanceKm).join(' ') : '—')]);
    if (any('timeS')) cols.push(['Time', l => (has(l.timeS) ? fmtClock(l.timeS) : '—')]);
    if (usePace) cols.push(['Pace /mi', l => (has(l.paceSPerKm) ? `${fmtPace(l.paceSPerKm * MI)}${bar(l)}` : '—')]);
    if (useSpeed) cols.push(['Speed mph', l => (has(l.speedKmh) ? `${nf(l.speedKmh / MI, 1)}${bar(l)}` : '—')]);
    if (any('avgHr')) cols.push(['Avg HR', l => (has(l.avgHr) ? Math.round(l.avgHr) : '—')]);
    if (any('maxHr')) cols.push(['Max HR', l => (has(l.maxHr) ? Math.round(l.maxHr) : '—')]);
    if (any('cadence')) cols.push(['Cadence', l => (has(l.cadence) ? Math.round(l.cadence) : '—')]);
    if (any('power')) cols.push(['Power', l => (has(l.power) ? Math.round(l.power) : '—')]);
    return `<h3 class="ap-title">Splits</h3><div class="splits-wrap"><table class="data"><caption class="sr-only">Splits</caption><thead><tr>${cols.map(c => `<th scope="col"${c[2] ? '' : ''}>${c[0]}</th>`).join('')}</tr></thead><tbody>${laps.map(l => `<tr>${cols.map(c => `<td>${c[1](l)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  };

  /* ---------------- charts ---------------- */
  const movingAvg = (arr, win) => {
    const half = Math.floor(win / 2);
    return arr.map((_, i) => {
      let s = 0, c = 0;
      for (let j = Math.max(0, i - half); j <= Math.min(arr.length - 1, i + half); j++) if (arr[j] != null) { s += arr[j]; c++; }
      return arr[i] == null || !c ? null : s / c;
    });
  };
  const percentile = (arr, q) => { const a = arr.filter(v => v != null).sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.max(0, Math.floor(q * (a.length - 1))))] : 0; };
  const niceStep = (span, target, steps) => steps.find(s => span / s <= target) || steps[steps.length - 1];

  const buildPanels = (series, group, n) => {
    const col = k => (Array.isArray(series[k]) && series[k].length === n ? series[k].map(v => (has(v) ? +v : null)) : null);
    const some = a => a && a.some(v => v != null);
    const t = series.t.map(Number);
    let dist = col('distanceKm');
    if (dist) { let last = 0; dist = dist.map(v => (v == null ? last : (last = v))); if (!(dist[n - 1] > 0)) dist = null; }
    let spd = col('speedKmh');
    if (!some(spd) && dist) {
      const w = 4;
      spd = dist.map((d, i) => { const a = Math.max(0, i - w), b = Math.min(n - 1, i + w); const dt = t[b] - t[a]; return dt > 0 ? ((dist[b] - dist[a]) / dt) * 3600 : null; });
    }
    const panels = [];
    const hr = col('hr'), pow = col('power');
    const elevM = col('elevM'), elev = elevM && elevM.map(v => (v == null ? null : v * FT));
    if (some(hr)) panels.push({ key: 'hr', title: 'Heart rate', unit: 'bpm', v: hr, fmt: v => String(Math.round(v)) });
    if (some(spd)) {
      if (PACE_GROUPS.includes(group)) panels.push({ key: 'pace', title: 'Pace', unit: '/mi', v: movingAvg(spd.map(v => (v != null && v > 1 ? (3600 / v) * MI : null)), 7), fmt: fmtPace, invert: true, clip: true });
      else panels.push({ key: 'speed', title: 'Speed', unit: 'mph', v: movingAvg(spd.map(v => (v == null ? null : v / MI)), 5), fmt: v => nf(v, 1) });
    }
    if (some(elev)) panels.push({ key: 'elev', title: 'Elevation', unit: 'ft', v: elev, fmt: v => String(Math.round(v)), area: true });
    if (some(pow)) panels.push({ key: 'pow', title: 'Power', unit: 'W', v: pow, fmt: v => String(Math.round(v)) });
    /* the distance axis is in the display unit (yards for swims, miles otherwise) */
    const dx = dist && dist.map(v => (group === 'swim' ? v * YD : v / MI));
    return { panels, t, dist: dx };
  };

  const chartBlock = (el, series, group) => {
    const n = (series.t || []).length;
    if (n < 2) return false;
    const { panels, t, dist } = buildPanels(series, group, n);
    if (!panels.length) return false;
    const swim = group === 'swim';
    let mode = 'time', cursor = null;
    const xsFor = () => (mode === 'distance' ? dist : t);
    panels.forEach(p => {
      const vv = p.v.filter(v => v != null);
      let lo = p.clip ? percentile(p.v, .03) : Math.min(...vv), hi = p.clip ? percentile(p.v, .97) : Math.max(...vv);
      if (hi - lo < 1e-6) { lo -= 1; hi += 1; }
      const padv = (hi - lo) * .08;
      p.lo = p.key === 'elev' || p.key === 'pow' || p.key === 'hr' ? lo - padv : lo - padv; p.hi = hi + padv;
    });

    el.innerHTML = `<h3 class="ap-title">Charts${dist ? '<span class="seg axis-toggle" id="axis-seg"><button type="button" data-ax="time" aria-pressed="true">Time</button><button type="button" data-ax="distance" aria-pressed="false">Distance</button></span>' : ''}</h3><div class="readout" id="ap-readout" aria-hidden="true"></div><div class="stack" id="ap-stack" tabindex="0" role="img" aria-label="${esc(panels.map(p => p.title).join(', '))} over ${dist ? 'time or distance' : 'time'}. Arrow keys move the readout."></div>`;
    const stack = el.querySelector('#ap-stack'), readout = el.querySelector('#ap-readout');
    const geom = { left: 46, right: 10, ph: 92, head: 16, gap: 10, bottom: 22 };

    const readoutHtml = i => {
      const xs = xsFor();
      const parts = [`<span class="${i != null ? 'on' : ''}">Time<b>${i != null ? fmtClock(t[i]) : '–'}</b></span>`];
      if (dist) parts.push(`<span class="${i != null ? 'on' : ''}">Distance<b>${i != null ? (swim ? `${nf(dist[i], 0)} yd` : `${nf(dist[i], 2)} mi`) : '–'}</b></span>`);
      panels.forEach(p => { const v = i != null ? p.v[i] : null; parts.push(`<span class="${v != null ? 'on' : ''}">${p.title}<b>${v != null ? `${p.fmt(v)} ${p.unit}` : '–'}</b></span>`); });
      void xs;
      return parts.join('');
    };

    const draw = w => {
      const g = geom, xs = xsFor(), plotW = w - g.left - g.right;
      const x0 = xs[0], x1 = xs[n - 1] || 1, xp = v => g.left + ((v - x0) / (x1 - x0 || 1)) * plotW;
      const H = g.head + panels.length * (g.ph + g.head + g.gap) - g.gap - g.head + g.bottom;
      let s = `<svg width="${w}" height="${H}" viewBox="0 0 ${w} ${H}" aria-hidden="true">`;
      panels.forEach((p, k) => {
        const top = k * (g.ph + g.head + g.gap) + g.head, yv = v => (p.invert ? top + ((v - p.lo) / (p.hi - p.lo)) * g.ph : top + (1 - (v - p.lo) / (p.hi - p.lo)) * g.ph);
        p.top = top; p.yv = yv;
        s += `<text class="ptitle" x="${g.left}" y="${top - 5}">${esc(p.title.toLowerCase())} · ${esc(p.unit)}</text>`;
        [0, .5, 1].forEach(f => { const v = p.lo + (p.hi - p.lo) * f; s += `<line class="grid" x1="${g.left}" x2="${w - g.right}" y1="${yv(v)}" y2="${yv(v)}"/><text x="${g.left - 6}" y="${yv(v) + 4}" text-anchor="end">${p.fmt(v)}</text>`; });
        let d = '', pen = false, first = null, lastX = null;
        for (let i = 0; i < n; i++) {
          const v = p.v[i];
          if (v == null || xs[i] == null) { pen = false; continue; }
          const cv = Math.min(p.hi, Math.max(p.lo, v));
          const px = xp(xs[i]).toFixed(1), py = yv(cv).toFixed(1);
          d += `${pen ? 'L' : 'M'}${px},${py}`; pen = true; if (first == null) first = px; lastX = px;
        }
        if (p.area && d) s += `<path class="ar" d="${d}L${lastX},${top + g.ph}L${first},${top + g.ph}Z"/>`;
        s += `<path class="ln${p.key === 'pow' ? ' ln-dash' : p.key === 'elev' ? ' ln-sec' : ''}" d="${d}"/>`;
      });
      /* shared x axis */
      const last = panels.length - 1, base = panels[last].top + g.ph;
      const span = x1 - x0;
      const step = mode === 'distance' ? niceStep(span, w / 70, swim ? [25, 50, 100, 200, 500, 1000, 2000, 5000] : [.25, .5, 1, 2, 5, 10, 20, 50]) : niceStep(span, w / 70, [30, 60, 120, 300, 600, 900, 1800, 3600, 7200]);
      for (let v = Math.ceil(x0 / step) * step; v <= x1 + 1e-6; v += step) s += `<text x="${xp(v)}" y="${base + 16}" text-anchor="middle">${mode === 'distance' ? (swim ? `${nf(v, 0)} yd` : `${nf(v, 2)} mi`) : fmtClock(v)}</text>`;
      s += `<g class="xh" id="ap-xh" visibility="hidden"><line x1="0" x2="0" y1="${g.head}" y2="${base}"/>${panels.map(() => '<circle r="3.5" cx="0" cy="0"/>').join('')}</g></svg>`;
      stack.innerHTML = s;
      stack._xp = xp;
      if (cursor != null) place(cursor);
    };

    const place = i => {
      const xh = stack.querySelector('#ap-xh');
      if (!xh || !stack._xp) return;
      const x = stack._xp(xsFor()[i]);
      const line = xh.querySelector('line');
      line.setAttribute('x1', x); line.setAttribute('x2', x);
      xh.querySelectorAll('circle').forEach((c, k) => {
        const p = panels[k], v = p.v[i];
        if (v == null) c.setAttribute('visibility', 'hidden');
        else { c.removeAttribute('visibility'); c.setAttribute('cx', x); c.setAttribute('cy', p.yv(Math.min(p.hi, Math.max(p.lo, v)))); }
      });
      xh.setAttribute('visibility', 'visible');
      readout.innerHTML = readoutHtml(i);
    };
    const clear = () => {
      cursor = null;
      const xh = stack.querySelector('#ap-xh');
      xh && xh.setAttribute('visibility', 'hidden');
      readout.innerHTML = readoutHtml(null);
    };
    const nearest = px => {
      const xs = xsFor(), r = stack.getBoundingClientRect();
      const x0 = xs[0], x1 = xs[n - 1], plotW = r.width - geom.left - geom.right;
      const v = x0 + ((px - r.left - geom.left) / plotW) * (x1 - x0);
      let a = 0, b = n - 1;
      while (b - a > 1) { const m = (a + b) >> 1; if (xs[m] <= v) a = m; else b = m; }
      return Math.abs(xs[a] - v) <= Math.abs(xs[b] - v) ? a : b;
    };
    const onMove = e => {
      const r = stack.getBoundingClientRect();
      if (e.clientX < r.left + geom.left || e.clientX > r.right - geom.right) return clear();
      cursor = nearest(e.clientX); place(cursor);
    };
    stack.addEventListener('pointermove', onMove);
    stack.addEventListener('pointerdown', onMove);
    stack.addEventListener('pointerleave', clear);
    stack.addEventListener('blur', clear);
    stack.addEventListener('keydown', e => {
      const stepN = Math.max(1, Math.round(n / 80));
      if (e.key === 'ArrowRight') cursor = Math.min(n - 1, (cursor ?? -stepN) + stepN);
      else if (e.key === 'ArrowLeft') cursor = Math.max(0, (cursor ?? stepN) - stepN);
      else if (e.key === 'Home') cursor = 0;
      else if (e.key === 'End') cursor = n - 1;
      else return;
      e.preventDefault(); place(cursor);
      readout.setAttribute('aria-hidden', 'false');
    });
    const seg = el.querySelector('#axis-seg');
    if (seg) seg.addEventListener('click', e => {
      const b = e.target.closest('[data-ax]');
      if (!b) return;
      mode = b.dataset.ax;
      seg.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      draw(Math.floor(stack.clientWidth));
    });
    let lastW = 0;
    const run = () => { const w = Math.floor(stack.clientWidth); if (w > 60 && w !== lastW) { lastW = w; draw(w); } };
    readout.innerHTML = readoutHtml(null);
    run();
    if ('ResizeObserver' in window) new ResizeObserver(run).observe(stack);
    return true;
  };

  /* ---------------- load + render ---------------- */
  const id = host.dataset.activity;
  const get = u => fetch(u, { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
  Promise.all([get(`/data/activities/${encodeURIComponent(id)}.json`), get('/data/training.json').catch(() => null)])
    .then(([a, training]) => {
      const group = a.group || guessGroup(a.sport);
      const m = a.metrics || {};
      const date = String(a.date || '').slice(0, 10);
      const block = training && Array.isArray(training.blocks) && date ? training.blocks.find(b => b && b.start <= date && date <= b.end) : null;
      const hasSeries = a.series && Array.isArray(a.series.t) && a.series.t.length > 1;
      host.innerHTML = `<div class="ap-head"><span>${esc(a.sport || '')}${date ? ` · ${esc(fmtDate(date))}` : ''}</span><span>${block ? `<a href="${urlHref(block.url || '')}">Training block: ${esc(block.title)}</a> · ` : ''}<a href="/stream/training/">Training history →</a></span></div>${metricGrid(m, group)}<div id="ap-charts"></div>${hasSeries ? '' : '<p class="ap-note">Detailed samples pending</p>'}${splitsTable(a.laps, group)}`;
      if (hasSeries && !chartBlock(host.querySelector('#ap-charts'), a.series, group)) host.querySelector('#ap-charts').innerHTML = '<p class="ap-note">Detailed samples pending</p>';
    })
    .catch(() => { host.innerHTML = '<p class="ap-note">Activity details unavailable</p>'; });
})();
