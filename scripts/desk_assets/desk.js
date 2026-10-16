let token = '', last = null;
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const when = iso => { const d = iso ? new Date(iso) : null; return d && !isNaN(d) ? d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Never'; };

function say(text, bad = false, link = '') {
  $('message').innerHTML = text
    ? `<p class="note${bad ? ' bad' : ''}${bad && text.includes('\n') ? ' raw' : ''}">${esc(text)}${link ? ` <a href="${esc(link)}" target="_blank" rel="noopener">${esc(link)}</a>` : ''}</p>` : '';
}

async function api(path, data) {
  const r = await fetch(path, { method: data ? 'POST' : 'GET', headers: data ? { 'Content-Type': 'application/json', 'X-Desk-Token': token } : {}, body: data ? JSON.stringify(data) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(j.error || 'Request failed');
  return j;
}

// Show progress on the pressed button and keep the other long-running buttons from firing meanwhile.
const LONG = ['sync', 'preview', 'publish'];
async function working(btn, label, fn) {
  const text = btn.textContent;
  btn.disabled = true; btn.classList.add('working'); btn.textContent = label;
  if (LONG.includes(btn.id)) LONG.filter(id => id !== btn.id).forEach(id => $(id).disabled = true);
  try { return await fn(label => { btn.textContent = label; }); }
  catch (e) { say(e.message, true); }
  finally {
    btn.disabled = false; btn.classList.remove('working'); if (btn.dataset.relabel) delete btn.dataset.relabel; else btn.textContent = text;
    LONG.forEach(id => $(id).disabled = false);
  }
}

// -- lists -------------------------------------------------------------------
function item(it, actions, bad = false) {
  const sub = [it.folder, it.reason].filter(Boolean).map(esc).join(' · ');
  return `<li class="item${bad ? ' bad' : ''}"><div class="meta"><span class="title">${esc(it.title)}</span><span class="sub">${sub}</span></div><div class="acts">${actions}</div></li>`;
}
const openLink = it => it.obsidian ? `<a class="btn" href="${esc(it.obsidian)}" aria-label="Open ${esc(it.title)} in Obsidian">Open</a>` : '';
const privateBtn = it => it.path ? `<button class="btn" data-vis="private" data-path="${esc(it.path)}" aria-label="Make ${esc(it.title)} private">Make private</button>` : '';
function fill(id, items, render) {
  $(id).innerHTML = items.length ? items.map(render).join('') : '<li class="empty">None</li>';
  $('n-' + id).textContent = items.length || '';
}

function render(s) {
  last = s;
  fill('attention', s.attention, it => item(it, it.kind === 'held' ? openLink(it) + privateBtn(it) : '', true));
  fill('ready', s.ready, it => item(it, openLink(it) + privateBtn(it)));
  fill('changed', s.changed, it => item(it, openLink(it) + privateBtn(it)));
  const c = s.coros || {};
  const rows = [
    ['Last publish', when(s.lastPublished)],
    ['Last build', when(s.lastBuild)],
    ['COROS coverage', c.coverageStart ? `${c.coverageStart} → ${c.coverageEnd}` : 'None'],
    ['COROS last sync', when(c.lastSync)],
    ['COROS records', c.recordCount ?? 0],
    ['Detail backlog', c.detailBacklog ?? 0],
    ['FIT backlog', c.fitBacklog ?? 0],
  ];
  $('recent').innerHTML = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
  if (s.busy) say('Working: ' + s.busy);
}

async function refresh() {
  try { render(await api('/api/status')); }
  catch (e) { say(e.message, true); ['attention', 'ready', 'changed'].forEach(id => $(id).innerHTML = '<li class="empty">Unavailable</li>'); }
}

// -- note actions ------------------------------------------------------------
document.addEventListener('click', e => {
  const b = e.target.closest('[data-vis]');
  if (b) working(b, '…', async () => {
    const out = await api('/api/visibility', { path: b.dataset.path, public: b.dataset.vis === 'public' });
    say(`${b.dataset.path.split('/').pop().replace(/\.md$/, '')} is now ${out.visibility}`);
    const row = b.closest('#created li');
    if (row) {  // a just-captured note: flip its button in place
      const next = out.visibility === 'public' ? 'private' : 'public';
      b.dataset.vis = next; b.dataset.relabel = '1'; b.textContent = 'Make ' + next;
      row.querySelector('.sub').textContent = `${b.dataset.path} · ${out.visibility === 'public' ? 'Public' : 'Private'}`;
    }
    await refresh();
  });
  const tab = e.target.closest('[data-tab]');
  if (tab) {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t === tab));
    document.querySelectorAll('.capture').forEach(f => f.hidden = f.dataset.panel !== tab.dataset.tab);
    document.querySelector(`[data-panel="${tab.dataset.tab}"] input`)?.focus();
  }
});

// -- capture -----------------------------------------------------------------
function created(r) {
  const pub = r.visibility === 'public';
  $('created').insertAdjacentHTML('afterbegin', item({ title: r.title, folder: r.path, reason: r.visibility === 'public' ? 'Public' : 'Private', obsidian: r.obsidian },
    openLink(r) + `<button class="btn" data-vis="${pub ? 'private' : 'public'}" data-path="${esc(r.path)}">Make ${pub ? 'private' : 'public'}</button>`));
}
const readFile = f => new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(r.result.split(',')[1]); r.onerror = () => bad(Error('Cannot read ' + f.name)); r.readAsDataURL(f); });

document.querySelectorAll('.capture').forEach(form => form.addEventListener('submit', async e => {
  e.preventDefault();
  const kind = form.dataset.panel, v = Object.fromEntries(new FormData(form)), btn = form.querySelector('button');
  say('');
  await working(btn, 'Saving…', async progress => {
    let r;
    if (kind === 'photos') {
      const files = [...form.elements.files.files], names = [];
      for (const [i, f] of files.entries()) {
        progress(`Uploading ${i + 1}/${files.length}…`);
        if (f.size > 20000000) throw Error(f.name + ' exceeds 20 MB');
        names.push((await api('/api/photo', { name: f.name, data: await readFile(f) })).file);
      }
      r = await api('/api/capture/photos', { files: names, title: v.title, caption: v.caption });
    } else if (kind === 'source') {
      progress(v.title ? 'Saving…' : 'Fetching title…');
      r = await api('/api/capture/source', { url: v.url, title: v.title });
    } else r = await api('/api/capture/' + kind, { title: v.title, url: v.url });
    created(r); form.reset(); await refresh();
  });
}));

// -- toolbar -----------------------------------------------------------------
$('sync').onclick = e => working(e.currentTarget, 'Syncing…', async () => {
  say('');
  const x = await api('/api/sync', {});
  say(x.changed ? `${x.changed} activities updated` : 'COROS is up to date');
  await refresh();
});
$('preview').onclick = e => working(e.currentTarget, 'Building…', async () => {
  say('');
  const x = await api('/api/preview', {});
  say('Preview open at', false, x.url);
  await refresh();
});
$('publish').onclick = e => working(e.currentTarget, 'Publishing…', async () => {
  const r = last ? last.ready.length : 0, c = last ? last.changed.length : 0, h = last ? last.attention.filter(a => a.kind === 'held').length : 0;
  const text = `Publish ${r} ready and ${c} changed?` + (h ? `\n${h} held back will not publish.` : '');
  if (!confirm(text)) return;
  say('');
  await api('/api/publish', {});
  say('Published');
  await refresh();
});

(async () => { try { token = (await api('/api/token')).token; } catch (e) { say(e.message, true); return; } await refresh(); })();
