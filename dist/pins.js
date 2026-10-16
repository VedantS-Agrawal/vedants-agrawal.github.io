/* Pinned notes: `pinned: true` in a note's properties puts it here.
   Wide screens: a quiet list in the left margin of every page. Narrower: inside the homepage aside. */
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const here = location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
  const link = e => (/\.html$|\/$/.test(e.url) ? e.url : `${e.url}.html`);
  const list = pins => `<ul class="pins-list">${pins.map(e => `<li${e.url === here ? ' class="here"' : ''}><a href="${esc(link(e))}"${e.url === here ? ' aria-current="page"' : ''}>${esc(e.title)}</a></li>`).join('')}</ul>`;
  const intoAside = pins => {
    const aside = document.querySelector('.aside');
    if (!aside || aside.querySelector('.pins-block')) return !!aside;
    aside.insertAdjacentHTML('afterbegin', `<section class="aside-block pins-block" aria-labelledby="h-pins"><h2 id="h-pins">Pinned</h2>${list(pins)}</section>`);
    return true;
  };
  fetch('/site-data.json').then(r => (r.ok ? r.json() : null)).then(data => {
    const pins = (data?.entries || []).filter(e => e.pinned && e.url && e.title).sort((a, b) => a.title.localeCompare(b.title));
    if (!pins.length) return;
    const rail = document.createElement('nav');
    rail.className = 'pins-rail'; rail.setAttribute('aria-label', 'Pinned notes');
    rail.innerHTML = `<p class="pins-label">pinned</p>${list(pins)}`;
    document.body.append(rail);
    // The homepage aside renders after its own fetch; wait briefly for it.
    if (here === '/' && !intoAside(pins)) {
      const mo = new MutationObserver(() => { if (intoAside(pins)) mo.disconnect(); });
      mo.observe(document.body, { childList: true, subtree: true }); setTimeout(() => mo.disconnect(), 5000);
    }
  }).catch(() => {});
})();
