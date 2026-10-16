"""Vault exporter and static-site publisher.

Rules (docs/Architecture.md §1–2): a note is public when `visibility: public`, or when the
property is absent and its type defaults to public (activity, block, month). A public note with a problem is held
back and reported; it never blocks the rest of the site.
"""
import argparse, hashlib, html, json, re, shutil, subprocess, sys
from pathlib import Path
from urllib.parse import unquote, urlsplit
from common import *
import dates

PUBLIC_TYPES = ('activity', 'block', 'month')
SKIP_FOLDERS = ('_System/', 'Templates/', 'Guide/')
AUDIO = ('.mp3', '.m4a', '.wav', '.ogg', '.aac')
IMAGES = ('.jpg', '.jpeg', '.png', '.webp', '.heic')
PREFIX = {'project': 'projects', 'activity': 'stream/training', 'block': 'training/blocks',
          'literature': 'library', 'month': 'archive/notes', 'photo': 'photos', 'page': ''}
ENTRY_KEYS = ['status', 'medium', 'creator', 'consumption_status', 'finished']
REPORT = LOCAL / 'last-build.json'
HUBS = {'stream': '/stream/', 'writing': '/writing/', 'library': '/library/', 'training': '/stream/training/',
        'about': '/about.html', 'colophon': '/colophon.html', 'archive': '/archive/', 'home': '/'}


class Held(Exception):
    """A public note that cannot be published as written."""


def is_public(note):
    v = str(note['meta'].get('visibility', '')).lower()
    if v in ('public', 'private'): return v == 'public'
    if note['meta'].get('type') == 'activity' and not CONFIG.get('trainingPublic', True): return False
    return note['meta'].get('type') in PUBLIC_TYPES


def candidates(all_notes):
    return [n for n in all_notes if not n['path'].startswith(SKIP_FOLDERS) and n['path'] != 'Home.md' and is_public(n)]


def fingerprint(note):
    return hashlib.sha256((json.dumps(note['meta'], sort_keys=True, default=str) + note['body']).encode()).hexdigest()


def route(note, entry):
    if entry.get('slug'): return entry['slug']
    kind = note['meta'].get('type', 'writing')
    prefix = PREFIX.get(kind, 'notes')
    name = slug(Path(note['path']).stem if kind == 'activity' else note['title'])
    return f'{prefix}/{name}'.strip('/')


def resolve_note(target, source, all_notes):
    target = unquote(target).removesuffix('.md').strip('/')
    candidate = (Path(source).parent / target).as_posix()
    exact = [n for n in all_notes if n['path'].removesuffix('.md') in (target, candidate)]
    if len(exact) == 1: return exact[0]
    matches = [n for n in all_notes if Path(n['path']).stem == target or n['title'] == target
               or target in (n['meta'].get('aliases') or [])]
    if len(matches) != 1: raise Held(f'link to [[{target}]] does not match exactly one note')
    return matches[0]


class Exporter:
    def __init__(self):
        self.all = notes()
        self.state = state()
        self.stage = LOCAL / 'export-stage'
        self.media = {}  # vault path -> public url
        self.files = {p.name: p for p in vault().rglob('*') if p.is_file() and p.suffix.lower() in AUDIO + IMAGES
                      and not any(x.startswith('.') for x in p.relative_to(vault()).parts)}

    # -- attachments ---------------------------------------------------------
    def asset(self, target, source):
        target = unquote(target)
        if target.startswith('/') or '..' in Path(target).parts or '\\' in target:
            raise Held(f'invalid attachment path {target}')
        p = vault() / Path(source).parent / target
        if not p.is_file(): p = vault() / target
        if not p.is_file(): p = self.files.get(Path(target).name)
        if not p or not p.is_file(): raise Held(f'missing attachment {target}')
        if p in self.media: return self.media[p]
        ext = p.suffix.lower(); dest = 'media/' + hashlib.sha256(p.read_bytes()).hexdigest()[:20]
        (self.stage / 'media').mkdir(exist_ok=True)
        if ext in IMAGES:
            from PIL import Image, ImageOps
            try: im = ImageOps.exif_transpose(Image.open(p))
            except Exception: raise Held(f'cannot read image {p.name} (HEIC needs converting to JPG)')
            im.thumbnail((2000, 2000))
            if im.mode not in ('RGB', 'RGBA'): im = im.convert('RGB')
            dest += '.webp'; im.save(self.stage / dest, 'WEBP', quality=85)  # re-encode drops EXIF/GPS
        elif ext in AUDIO:
            dest += ext; shutil.copy2(p, self.stage / dest)
        self.media[p] = '/' + dest
        return self.media[p]

    # -- links ---------------------------------------------------------------
    def rewrite(self, n, body):
        if re.search(r'<[a-zA-Z/!]', body): raise Held('contains raw HTML; use Markdown instead')
        if re.search(r'^\s*\[[^\]]+\]:', body, re.M): raise Held('uses reference-style links; use inline links')

        def local(target, label, embed):
            base, _, anchor = target.partition('#')
            anchor = '#' + slug(anchor) if anchor else ''
            if not base: return f'[{label}]({anchor})'
            ext = Path(base).suffix.lower()
            if ext and ext != '.md':
                url = self.asset(base, n['path'])
                if ext in AUDIO: return f'<audio controls preload="none" src="{url}"></audio>'
                return f'{"!" if embed else ""}[{label}]({url})'
            try: other = resolve_note(base, n['path'], self.all)
            except Held: other = None
            if other is None and base.strip().lower() in HUBS:   # [[Training]], [[Library]] … → site sections
                return f'[{label}]({HUBS[base.strip().lower()]})'
            if other is None or other['path'] not in self.routes:
                # Not public (yet): keep the words, drop the link. It becomes a link when the target is published.
                return f'<span class="link-private" title="Not public yet">{html.escape(label)}</span>'
            if embed: return f'[{label}](/{self.routes[other["path"]]}{anchor})'
            return f'[{label}](/{self.routes[other["path"]]}{anchor})'

        def md(m):
            bang, label, target = m.groups(); target = target.strip().strip('<>')
            scheme = urlsplit(target).scheme
            if scheme:
                if scheme not in ('https', 'http', 'mailto'): raise Held(f'unsupported link {target}')
                if bang: raise Held('remote image; save it into Media/Photos first')
                return m.group(0)
            if target in HUBS.values(): return m.group(0)               # [text](/stream/training/)
            return local(target, label, bool(bang))

        body = re.sub(r'(!?)\[([^\]]*)\]\(([^)]+)\)', md, body)
        def wiki(m):
            bang, inner = m.groups(); target, _, label = inner.partition('|')
            return local(target, label or Path(target.split('#')[0]).stem, bool(bang))
        return re.sub(r'(!?)\[\[([^\]]+)\]\]', wiki, body)

    # -- activities ----------------------------------------------------------
    def activity(self, n, record):
        ident = str(n['meta'].get('id', ''))
        if not re.fullmatch(r'\d+', ident): raise Held('activity has no valid COROS id')
        stored = read_json(vault() / '_System/activities' / f'{ident}.json')
        if not stored.get('public'): raise Held('activity data missing from _System/activities')
        pub = dict(stored['public'])
        pub.update(url=record['url'], hasNote=bool(n['body'].strip()), hasAudio='<audio' in record['_body'])
        detail = stored.get('detail') or {}
        data = {k: pub.get(k) for k in ('id', 'sport', 'group', 'date', 'title')}
        data.update(metrics=detail.get('metrics') or {}, laps=detail.get('laps') or [])
        if stored.get('series'): data['series'] = stored['series']
        (self.stage / 'data/activities').mkdir(parents=True, exist_ok=True)
        (self.stage / 'data/activities' / f'{ident}.json').write_text(json.dumps(data, separators=(',', ':')))
        self.training.append(pub)
        record['activity'] = pub
        record['date'] = pub.get('date', record['date'])
        bits = [pub.get('sport', 'Activity')]
        if pub.get('distanceKm'):
            km = pub['distanceKm']
            bits.append(f'{round(km * 1093.6133):,} yd' if pub.get('group') == 'swim' else f'{km / 1.609344:.2f} mi')
        if pub.get('durationS'): bits.append(f'{int(pub["durationS"]) // 60} min')
        record['summary'] = ' · '.join(bits)
        return f'<div class="activity-panel" data-activity="{ident}"></div>\n\n'

    # -- main ----------------------------------------------------------------
    def run(self):
        shutil.rmtree(self.stage, ignore_errors=True); self.stage.mkdir(parents=True)
        notes_state = self.state.setdefault('notes', {})
        pool = candidates(self.all)
        held, output, proposal, self.training, blocks = [], [], {}, [], []
        # Routes are fixed before rendering so links between public notes resolve.
        self.routes = {n['path']: route(n, notes_state.get(n['path'], {})) for n in pool}
        seen = {}
        for path, r in list(self.routes.items()):
            if r in seen or not re.fullmatch(r'[a-z0-9/-]+', r):
                held.append({'path': path, 'reason': f'website address /{r} is already used or invalid'}); del self.routes[path]
            seen[r] = path
        for attempt in range(5):
            output, proposal, self.training, blocks, self.media = [], {}, [], [], {}
            shutil.rmtree(self.stage, ignore_errors=True); self.stage.mkdir(parents=True)
            newly = []
            for n in [n for n in pool if n['path'] in self.routes]:
                try:
                    output.append(self.render(n, notes_state.get(n['path'], {}), proposal, blocks))
                except Held as e:
                    newly.append({'path': n['path'], 'title': n['title'], 'reason': str(e)})
            if not newly: break
            # Held notes leave the route table; a second pass turns links to them into plain text.
            held += newly
            for h in newly: self.routes.pop(h['path'], None)
        output.sort(key=lambda x: (x['date'], x['published']), reverse=True)
        self.write(output, blocks, proposal, held)
        return {'entries': len(output), 'held': held}

    def render(self, n, old, proposal, blocks):
        m = n['meta']; kind = m.get('type', 'writing'); r = self.routes[n['path']]
        body = re.sub(r'%%.*?%%', '', n['body'], flags=re.S)
        body = self.rewrite(n, body)
        stamp = now(); digest = fingerprint(n)
        # published: your `published:` property wins; otherwise the first successful publish.
        pub = day_of(m.get('published'))[0] or old.get('published') or stamp
        updated = day_of(m.get('updated'))[0] or (old.get('updated') if old.get('hash') == digest and old.get('updated') else stamp)
        # The date a note sits at on the site: explicit `date`, a finished book's `finished`, else when it was started (`created`).
        candidates_ = [m.get('date')]
        if kind == 'literature' and m.get('consumption_status') == 'finished': candidates_.append(m.get('finished'))
        if kind not in ('page',): candidates_.append(m.get('created'))
        if kind == 'month' and re.match(r'\d{4}-\d{2}', n['title']): candidates_ = [n['title'][:7]]
        date, precision = next((day_of(c) for c in candidates_ if day_of(c)[0]), (pub[:10], 'day'))
        record = {'type': kind, 'title': n['title'], 'url': '/' + r, 'date': date, 'published': pub, 'updated': updated,
                  **({'datePrecision': precision} if precision != 'day' else {}),
                  '_body': body, '_path': n['path']}
        for key in ENTRY_KEYS:
            if m.get(key) not in (None, '', []): record[key] = m[key] if not hasattr(m[key], 'isoformat') else str(m[key])
        if kind == 'project' and m.get('url'): record['project_url'] = m['url']
        if kind == 'literature' and m.get('source_url'): record['source_url'] = m['source_url']
        if m.get('cover'):
            cover = str(m['cover']).strip().removeprefix('[[').removesuffix(']]').removeprefix('!')
            record['cover'] = cover if cover.startswith('https://') else self.asset(cover.removeprefix('[[').removesuffix(']]'), n['path'])
        if kind == 'activity': body = self.activity(n, record) + body
        if kind == 'block':
            blocks.append({'title': n['title'], 'start': str(m.get('start', ''))[:10], 'end': str(m.get('end', ''))[:10], 'url': '/' + r})
        text = re.sub(r'!?\[([^\]]*)\]\([^)]*\)', r'\1', body)
        text = re.sub(r'<[^>]*>|[#*_`>]', '', text).strip()
        if kind != 'activity': record['summary'] = text.split('\n\n')[0][:240]
        record['search'] = text[:5000]
        record['words'] = len(re.findall(r'\w+', text))
        record['tags'] = tags_of(n)
        if str(m.get('pinned', '')).lower() in ('true', 'yes', '1'): record['pinned'] = True
        images = re.findall(r'!\[[^\]]*\]\((/media/[^)]+\.webp)\)', body)
        if images: record['image'] = images[0]
        if kind == 'photo': record['images'] = images
        front = {'title': n['title'], 'type': kind, 'date': date, 'published': pub, 'updated': updated,
                 'created': pub, 'modified': updated}
        if m.get('aliases'): front['aliases'] = m['aliases']
        write_note(self.stage / (r + '.md'), front, body)
        proposal[n['path']] = {'slug': r, 'published': pub, 'updated': updated, 'hash': digest}
        record['_status'] = 'new' if not old.get('published') else ('changed' if old.get('hash') != digest else 'same')
        return record

    def intro_html(self, body, held):
        """Home.md body -> restricted HTML (p, a, em, strong). Links to private notes become plain text."""
        import html
        def link(label, url): return f'<a href="{html.escape(url)}">{html.escape(label)}</a>'
        def wiki(inner):
            target, _, label = inner.partition('|'); label = label or target
            if target.strip().lower() in HUBS: return link(label, HUBS[target.strip().lower()])
            try: other = resolve_note(target.split('#')[0], 'Home.md', self.all)
            except Held: other = None
            if other and other['path'] in self.routes: return link(label, '/' + self.routes[other['path']] + '.html')
            held.append({'path': 'Home.md', 'title': 'Home', 'reason': f'intro link [[{target}]] is not public; shown as plain text'})
            return html.escape(label)
        def md(label, url):
            if url.startswith(('https://', 'http://', 'mailto:')) or re.fullmatch(r'/[\w./#-]*', url): return link(label, url)
            return html.escape(label)
        def inline(text):
            text = html.escape(text, quote=False)
            text = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', text)
            return re.sub(r'(?<![*\w])[*_](.+?)[*_](?![*\w])', r'<em>\1</em>', text)
        token = re.compile(r'\[\[([^\]]+)\]\]|\[([^\]]+)\]\(([^)\s]+)\)')
        out = []
        for para in re.split(r'\n\s*\n', re.sub(r'%%.*?%%', '', body, flags=re.S).strip()):
            parts, last = [], 0
            for m in token.finditer(para):
                parts.append(inline(para[last:m.start()]))
                parts.append(wiki(m[1]) if m[1] else md(m[2], m[3])); last = m.end()
            parts.append(inline(para[last:]))
            t = ''.join(parts).strip()
            if t: out.append(f'<p>{t}</p>')
        return ''.join(out)

    def write(self, output, blocks, proposal, held):
        home_note = next((n for n in self.all if n['path'] == 'Home.md'), {'meta': {}, 'body': ''})
        home = home_note['meta']
        sync = read_json(vault() / '_System/coros-status.json')
        status = {'ready': [], 'changed': []}
        for e in output:
            if e['type'] != 'activity' and e['_status'] in ('new', 'changed'):
                status['ready' if e['_status'] == 'new' else 'changed'].append({'path': e['_path'], 'title': e['title'], 'url': e['url']})
        # Attachments of held-back notes must not ship on their own.
        used = {u for e in output for u in re.findall(r'/media/[\w.]+', e['_body'])}
        used |= {e['cover'] for e in output if str(e.get('cover', '')).startswith('/media/')}
        for f in (self.stage / 'media').glob('*') if (self.stage / 'media').exists() else []:
            if '/media/' + f.name not in used: f.unlink()
        entries = [{k: v for k, v in e.items() if not k.startswith('_')} for e in output]
        payload = {'name': CONFIG['name'], 'intro': home.get('intro') or CONFIG['intro'],
                   'description': home.get('description') or CONFIG['description'], 'built': now(), 'entries': entries,
                   'introHtml': self.intro_html(home_note['body'], held),
                   'descriptions': {k: home[k + '_description'] for k in ('stream', 'writing', 'library', 'archive', 'training') if home.get(k + '_description')}}
        (self.stage / 'site-data.json').write_text(json.dumps(payload, ensure_ascii=False, default=str))
        if CONFIG.get('wellnessPublic'):
            folder = vault() / '_System/wellness'
            days = [{**(read_json(f).get('public') or {}), 'date': f.stem} for f in sorted(folder.glob('*.json'))] if folder.exists() else []
            days = [d for d in days if len(d) > 1]
            (self.stage / 'data').mkdir(exist_ok=True)
            (self.stage / 'data/wellness.json').write_text(json.dumps({'coverage': {'start': days[0]['date'] if days else None, 'end': days[-1]['date'] if days else None}, 'days': days}, separators=(',', ':')))
        training = {'coverage': {'start': sync.get('coverageStart'), 'end': sync.get('coverageEnd'), 'lastSync': sync.get('lastSync')},
                    'blocks': sorted(blocks, key=lambda b: b['start']),
                    'activities': sorted(self.training, key=lambda a: (a.get('date', ''), a.get('start') or 0), reverse=True)}
        (self.stage / 'data').mkdir(exist_ok=True)
        (self.stage / 'data/training.json').write_text(json.dumps(training, separators=(',', ':'), default=str))
        (self.stage / 'data/links.json').write_text(json.dumps(links_of(output), separators=(',', ':'), ensure_ascii=False))
        write_note(self.stage / 'index.md', {'title': CONFIG['name']}, '')
        digest = hashlib.sha256(json.dumps(entries, sort_keys=True, default=str).encode()).hexdigest()
        write_json(LOCAL / 'pending-publication.json', {'notes': proposal, 'digest': digest}, True)
        write_json(REPORT, {'built': now(), 'entries': len(entries), 'activities': len(self.training), 'held': held, **status}, True)
        write_status_note(held, status, sync)
        backup = LOCAL / 'previous-export'; shutil.rmtree(backup, ignore_errors=True)
        if (ROOT / 'content').exists(): shutil.move(str(ROOT / 'content'), backup)
        shutil.move(str(self.stage), ROOT / 'content')


def day_of(value):
    """'2026-02-14' → ('2026-02-14', 'day'); '2026-02' → ('2026-02-01', 'month'); '2026' → ('2026-01-01', 'year')."""
    v = str(value or '').strip().strip('"')[:10]
    if re.fullmatch(r'\d{4}-\d{2}-\d{2}', v): return v, 'day'
    if re.fullmatch(r'\d{4}-\d{2}', v): return v + '-01', 'month'
    if re.fullmatch(r'\d{4}', v): return v + '-01-01', 'year'
    return None, None


def tags_of(n):
    """Tags come only from the YAML `tags` property (legacy `topics` accepted)."""
    out = []
    for key in ('tags', 'topics'):
        v = n['meta'].get(key) or []
        for t in [v] if isinstance(v, str) else v:
            t = slug(str(t).lstrip('#')) if t else ''
            if t and t not in out: out.append(t)
    return out


def links_of(output):
    """Graph + backlinks for the front end: nodes, edges, and for each page the notes linking to it with the sentence around the link."""
    by_url = {e['url']: e for e in output}
    nodes = [{'url': e['url'], 'title': e['title'], 'type': e['type']} for e in output if e['type'] != 'activity']
    edges, back = set(), {}
    link = re.compile(r'(?<!!)\[([^\]]*)\]\((/[a-z0-9/-]+)(?:#[^)]*)?\)')
    for e in output:
        if e['type'] == 'activity': continue
        # paragraphs, and each list item on its own, so a snippet never runs across bullets
        for para in re.split(r'\n\s*\n|\n(?=\s*(?:[-*+]|\d+\.)\s)', e['_body']):
            for m in link.finditer(para):
                to = m.group(2)
                if to not in by_url or to == e['url'] or by_url[to]['type'] == 'activity': continue
                edges.add((e['url'], to))
                # the sentence holding the link, with Markdown stripped and the link text marked
                start = max(para.rfind('. ', 0, m.start()) + 2, 0) if '. ' in para[:m.start()] else 0
                end = para.find('. ', m.end()); end = len(para) if end < 0 else end + 1
                ctx = para[start:end]
                ctx = link.sub(lambda k: '\u2063' + k.group(1) + '\u2064' if k.start() == m.start() - start else k.group(1), ctx)
                ctx = re.sub(r'<[^>]+>|[*_`#>]|^\s*[-+] ', '', re.sub(r'\[([^\]]*)\]\([^)]*\)', r'\1', ctx)).strip()
                if len(ctx) > 240:
                    i = ctx.find('\u2063'); ctx = ('… ' if i > 120 else '') + ctx[max(0, i - 120):i + 120].strip() + ' …'
                back.setdefault(to, [])
                if not any(b['url'] == e['url'] for b in back[to]):
                    back[to].append({'url': e['url'], 'title': e['title'], 'type': e['type'], 'context': ctx})
    return {'nodes': nodes, 'edges': sorted(edges), 'backlinks': back}


def write_status_note(held, status, sync):
    """A phone-readable summary in the vault. Overwritten on every build."""
    s = state()
    lines = [f'Last build: {now()[:16].replace("T", " ")}',
             f'Last publish: {(s.get("lastPublished") or "never")[:16].replace("T", " ")}',
             f'COROS: {sync.get("recordCount", 0)} activities, {sync.get("coverageStart")} → {sync.get("coverageEnd")}, last sync {str(sync.get("lastSync", ""))[:16].replace("T", " ")}',
             '', '## Needs attention', *([f'- [[{Path(h["path"]).stem}]] — {h["reason"]}' for h in held] or ['- Nothing']),
             '', '## Ready to publish', *([f'- [[{Path(x["path"]).stem}]]' for x in status['ready']] or ['- Nothing']),
             '', '## Changed since last publish', *([f'- [[{Path(x["path"]).stem}]]' for x in status['changed']] or ['- Nothing'])]
    if sync.get('lastError'): lines[3:3] = [f'COROS error: {sync["lastError"]}']
    write_note(vault() / '_System' / 'Publishing status.md', {'title': 'Publishing status', 'type': 'system'}, '\n'.join(lines) + '\n')


def export():
    return Exporter().run()


SHELLS = [('stream', 'Stream'), ('writing', 'Writing'), ('photos', 'Photos'), ('tags', 'Tags'), ('library', 'Library'), ('archive', 'Archive'), ('stream/training', 'Training history')]


def finish():
    dest = ROOT / 'dist'
    shutil.copytree(ROOT / 'web', dest, dirs_exist_ok=True)
    shutil.copy2(ROOT / 'content/site-data.json', dest / 'site-data.json')
    shutil.copytree(ROOT / 'content/media', dest / 'media', dirs_exist_ok=True) if (ROOT / 'content/media').exists() else None
    shutil.copytree(ROOT / 'content/data', dest / 'data', dirs_exist_ok=True)
    shell = (ROOT / 'web/index.html').read_text()
    def page(folder, title):
        folder.mkdir(parents=True, exist_ok=True)
        (folder / 'index.html').write_text(shell.replace('<title>Vedant Agrawal</title>', f'<title>{title} · Vedant Agrawal</title>'))
    for path, title in SHELLS: page(dest / path, title)
    for tag in sorted({t for e in read_json(dest / 'site-data.json').get('entries', []) for t in e.get('tags', [])}):
        if re.fullmatch(r'[a-z0-9-]+', tag): page(dest / 'tags' / tag, f'#{tag}')
    data = read_json(dest / 'site-data.json')
    for month in sorted({e['date'][:7] for e in data['entries'] if re.fullmatch(r'\d{4}-\d{2}', e['date'][:7])}):
        page(dest / 'archive' / month, month)
    for p in dest.rglob('*.html'):
        text = p.read_text()
        if 'id="app"' in text or '/article.js' in text: continue
        p.write_text(text.replace('</head>', '<link rel="stylesheet" href="/site.css"><link rel="stylesheet" href="/palette.css"><script defer src="/article.js"></script><script defer src="/palette.js"></script><script defer src="/pins.js"></script></head>'))
    (dest / 'projects').mkdir(exist_ok=True)
    shutil.copy2(ROOT / 'web/projects-redirect.html', dest / 'projects/index.html')  # old /projects/ index → Writing
    (dest / 'projects-redirect.html').unlink(missing_ok=True)
    (dest / '.nojekyll').touch()


def build():
    dates.stamp()          # fill created / refresh updated in the vault first
    result = export()
    subprocess.run(['node', 'quartz/bootstrap-cli.mjs', 'build', '-d', 'content', '-o', 'dist', '--concurrency', '2'], cwd=ROOT, check=True,
                   stdout=subprocess.DEVNULL)
    finish()
    return result


def publish():
    result = build()
    subprocess.run(['git', 'add', 'content', 'dist'], cwd=ROOT, check=True)
    if subprocess.run(['git', 'diff', '--cached', '--quiet'], cwd=ROOT).returncode:
        subprocess.run(['git', 'commit', '-m', 'Publish from vault'], cwd=ROOT, check=True)
    subprocess.run(['git', 'push', 'origin', 'main'], cwd=ROOT, check=True)
    finalize()
    return result


def finalize():
    pending = read_json(LOCAL / 'pending-publication.json')
    if not pending or 'notes' not in pending: raise ValueError('No publication preview to finalize')
    current = read_json(ROOT / 'content/site-data.json')
    digest = hashlib.sha256(json.dumps(current.get('entries', []), sort_keys=True, default=str).encode()).hexdigest()
    if digest != pending['digest']: raise ValueError('The publication changed after preview; build again')
    s = state()
    for path, entry in pending['notes'].items():
        if not s['notes'].get(path, {}).get('published') and not path.startswith('Training/Activities/'):
            dates.set_property(vault() / path, 'published', entry['published'][:10])   # visible + editable in Obsidian
    s['notes'].update(pending['notes']); s['lastPublished'] = now(); save_state(s)
    (LOCAL / 'auto-publish-enabled').touch()  # scheduled runs may publish once the site has gone live by hand


if __name__ == '__main__':
    p = argparse.ArgumentParser(); p.add_argument('action', choices=['export', 'finish', 'build', 'publish', 'finalize']); args = p.parse_args()
    try: print(json.dumps(globals()[args.action](), indent=1, default=str) if args.action != 'finish' else finish())
    except Exception as e: print(str(e), file=sys.stderr); sys.exit(1)
