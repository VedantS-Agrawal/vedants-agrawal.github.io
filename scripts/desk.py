"""Private loopback publishing desk. Nothing here is served by GitHub Pages.

Publication is the note's `visibility` property (docs/Architecture.md §1). The desk shows
exceptions (held, ready, changed), offers quick capture, and runs sync / preview / publish.
"""
import base64, contextlib, functools, html, ipaddress, json, os, re, secrets, shutil, socket, subprocess
import sys, tempfile, threading, time, urllib.request, webbrowser
from http.server import BaseHTTPRequestHandler, SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlparse, urlsplit
from common import ROOT, CONFIG, vault, state, inside, parse_note, write_note, now, read_json
import publisher

ASSETS = ROOT / 'scripts/desk_assets'
STATIC = {'/': ('index.html', 'text/html'), '/desk.js': ('desk.js', 'text/javascript'), '/desk.css': ('desk.css', 'text/css')}
FRONTMATTER = re.compile(r'^---\s*\n(.*?)\n---\s*\n?', re.S)
PHOTO_TYPES = ('.jpg', '.jpeg', '.png', '.webp')
PHOTO_LIMIT = 20_000_000


class Busy(Exception):
    pass


# -- paths -------------------------------------------------------------------
def note_path(rel):
    if not isinstance(rel, str) or not rel.endswith('.md') or rel.startswith('/') or '..' in Path(rel).parts or '\\' in rel:
        raise ValueError('Invalid note path')
    p = inside(vault(), rel)
    if not p.is_file(): raise ValueError('Note not found')
    return p


def obsidian_link(rel):
    return 'obsidian://open?vault=' + quote(CONFIG.get('vaultName') or vault().name, safe='') + '&file=' + quote(rel.removesuffix('.md'), safe='')


def safe_name(title):
    name = re.sub(r'[\\/:*?"<>|#^\[\]\x00-\x1f]', ' ', str(title))
    name = re.sub(r'\s+', ' ', name).strip(' .')[:120].strip(' .')
    if not name: raise ValueError('Enter a title')
    return name


def clean_title(value):
    title = re.sub(r'\s+', ' ', str(value or '')).strip()
    if len(title) > 160: raise ValueError('Title is too long')
    return title


def unique(folder, stem, suffix='.md'):
    """A free path inside the vault: `Name.md`, then `Name 2.md`, ..."""
    base = inside(vault(), folder)
    path, i = base / (stem + suffix), 2
    while path.exists():
        path = base / f'{stem} {i}{suffix}'; i += 1
    return path


def rel(path):
    return Path(path).resolve().relative_to(vault().resolve()).as_posix()


# -- visibility ----------------------------------------------------------------
def split_text(text):
    m = FRONTMATTER.match(text)
    if not m: return {}, text
    import yaml
    return (yaml.safe_load(m[1]) or {}), text[m.end():]


def set_visibility(path, public):
    """Rewrite only the `visibility` line of the frontmatter. Everything else stays byte-for-byte."""
    if not isinstance(public, bool): raise ValueError('Invalid visibility')
    p = note_path(path)
    raw = p.read_bytes().decode('utf-8')
    before, body = split_text(raw)
    # Public-by-default notes (projects, activities) drop the property instead of repeating the default.
    probe = {k: v for k, v in before.items() if k != 'visibility'}
    remove = public and publisher.is_public({'meta': probe, 'path': path})
    value = 'public' if public else 'private'
    m = FRONTMATTER.match(raw)
    if m:
        block = m.group(1); cr = '\r' if '\r\n' in block else ''
        lines = block.split('\n')
        at = next((i for i, l in enumerate(lines) if re.match(r'visibility\s*:', l)), None)
        if remove:
            if at is not None: del lines[at]
        else:
            line = f'visibility: {value}{cr}'
            if at is not None: lines[at] = line
            else:
                kind = next((i for i, l in enumerate(lines) if re.match(r'type\s*:', l)), None)
                follows = lines[kind + 1] if kind is not None and kind + 1 < len(lines) else ''
                if kind is not None and not re.match(r'\s|-', follows): lines.insert(kind + 1, line)
                else: lines.append(line)
        new = raw[:m.start(1)] + '\n'.join(lines) + raw[m.end(1):]
    elif remove: new = raw
    else: new = f'---\nvisibility: {value}\n---\n\n' + raw
    if new != raw:
        after, new_body = split_text(new)
        rest = lambda d: {k: v for k, v in d.items() if k != 'visibility'}
        if new_body != body or rest(after) != rest(before) or list(rest(after)) != list(rest(before)):
            raise ValueError('Could not change visibility safely; edit it in Obsidian')
        tmp = p.with_name('.desk-' + secrets.token_hex(4) + '.tmp')
        tmp.write_bytes(new.encode('utf-8')); shutil.copymode(p, tmp); os.replace(tmp, p)
    meta, _ = split_text(new)
    return {'path': path, 'visibility': 'public' if publisher.is_public({'meta': meta, 'path': path}) else 'private'}


# -- capture -------------------------------------------------------------------
FALLBACK = {
    'Free writing': {'title': '{{title}}', 'type': 'writing', 'visibility': 'private', 'created': '{{date}}', 'topics': []},
    'Literature': {'title': '{{title}}', 'type': 'literature', 'visibility': 'private', 'creator': '', 'medium': 'article',
                   'source_url': '', 'consumption_status': 'saved', 'finished': '', 'created': '{{date}}', 'topics': []},
    'Photo': {'title': '{{title}}', 'type': 'photo', 'visibility': 'private', 'date': '{{date}}'},
    'Project': {'title': '{{title}}', 'type': 'project', 'status': 'active', 'url': ''},
}


def from_template(name, title):
    """Properties and body of Templates/<name>.md with {{title}} and {{date}} filled in."""
    today = now()[:10]
    p = vault() / 'Templates' / (name + '.md')
    meta = body = None
    if p.is_file():
        try:
            safe = title.replace('\\', '\\\\').replace('"', '\\"')
            text = p.read_text(encoding='utf-8').replace('{{title}}', safe).replace('{{date}}', today)
            meta, body = split_text(text)
        except Exception: meta = None
    if not meta:
        meta, body = json.loads(json.dumps(FALLBACK[name]).replace('{{title}}', json.dumps(title)[1:-1]).replace('{{date}}', today)), ''
    return meta, body.replace('{{title}}', title).replace('{{date}}', today).lstrip('\n')


def result(path, meta):
    return {'path': rel(path), 'title': str(meta.get('title') or Path(path).stem), 'obsidian': obsidian_link(rel(path)),
            'visibility': 'public' if publisher.is_public({'meta': meta, 'path': rel(path)}) else 'private'}


def capture_write(data):
    title = clean_title(data.get('title'))
    if not title: raise ValueError('Enter a title')
    meta, body = from_template('Free writing', title)
    meta['title'] = title
    path = unique('Inbox', safe_name(title)); write_note(path, meta, body)
    return result(path, meta)


def fetch_title(url, timeout=5):
    """The page <title> of an https URL, or '' when it cannot be fetched within `timeout` seconds."""
    deadline = time.monotonic() + timeout
    def check(u):
        parts = urlsplit(u)
        if parts.scheme != 'https' or not parts.hostname: raise ValueError('https only')
        for info in socket.getaddrinfo(parts.hostname, parts.port or 443, proto=socket.IPPROTO_TCP):
            ip = ipaddress.ip_address(info[4][0].split('%')[0])
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
                raise ValueError('local address')
    class Redirects(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            check(newurl); return super().redirect_request(req, fp, code, msg, headers, newurl)
    try:
        check(url)
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (PublishingDesk)', 'Accept': 'text/html,*/*;q=0.5'})
        with urllib.request.build_opener(Redirects).open(req, timeout=timeout) as r:
            if 'html' not in (r.headers.get('Content-Type') or 'html').lower(): return ''
            charset = r.headers.get_content_charset() or 'utf-8'
            raw = b''
            while len(raw) < 300_000 and time.monotonic() < deadline and b'</title' not in raw.lower():
                chunk = r.read(16384)
                if not chunk: break
                raw += chunk
        m = re.search(r'<title[^>]*>(.*?)</title', raw.decode(charset, 'replace'), re.I | re.S)
        return re.sub(r'\s+', ' ', html.unescape(m.group(1))).strip()[:160] if m else ''
    except Exception:
        return ''


def capture_source(data):
    url = str(data.get('url') or '').strip()
    parts = urlsplit(url)
    if parts.scheme not in ('http', 'https') or not parts.netloc or len(url) > 1000: raise ValueError('Enter a valid http(s) URL')
    title = clean_title(data.get('title')) or fetch_title(url) or (parts.hostname or '').removeprefix('www.')
    meta, body = from_template('Literature', title)
    meta.update(title=title, source_url=url)
    if meta.get('medium') in (None, '', 'book'): meta['medium'] = 'article'
    path = unique('Library', safe_name(title)); write_note(path, meta, body)
    return result(path, meta)


def capture_project(data):
    title = clean_title(data.get('title'))
    if not title: raise ValueError('Enter a title')
    url = str(data.get('url') or '').strip()
    if url and (urlsplit(url).scheme not in ('http', 'https') or len(url) > 1000): raise ValueError('Enter a valid http(s) URL')
    meta, body = from_template('Project', title)
    meta = {'title': title, 'type': 'project', 'status': meta.get('status') or 'active', 'url': url}
    path = unique('Library/Projects', safe_name(title)); write_note(path, meta, body)
    return result(path, meta)


def import_photo(data):
    name = Path(str(data.get('name', ''))).name
    if not re.fullmatch(r'[\w .()-]+\.(jpg|jpeg|png|webp)', name, re.I): raise ValueError('Choose a JPG, PNG or WebP image')
    blob = base64.b64decode(data.get('data', ''), validate=True)
    if len(blob) > PHOTO_LIMIT: raise ValueError('Photo exceeds 20 MB')
    from PIL import Image
    from io import BytesIO
    try:
        with Image.open(BytesIO(blob)) as image: image.verify()
    except Exception: raise ValueError(name + ' is not a readable image')
    ext = Path(name).suffix.lower()
    dest = unique('Media/Photos', re.sub(r'[^\w.-]+', '-', Path(name).stem).strip('-.') or 'photo', ext)
    dest.parent.mkdir(parents=True, exist_ok=True); dest.write_bytes(blob)
    return {'file': dest.name, 'path': rel(dest)}


def capture_photos(data):
    files = data.get('files')
    if not isinstance(files, list) or not files or len(files) > 60: raise ValueError('Choose photos')
    media = inside(vault(), 'Media/Photos')
    for f in files:
        if not isinstance(f, str) or Path(f).name != f or Path(f).suffix.lower() not in PHOTO_TYPES or not (media / f).is_file():
            raise ValueError('Photo not found: ' + str(f))
    title = clean_title(data.get('title')) or 'Photos'
    caption = str(data.get('caption') or '').strip()[:5000]
    meta, body = from_template('Photo', title)
    meta.update(title=title, type='photo', visibility='private', date=now()[:10])
    body = '\n\n'.join(f'![[{f}]]' for f in files) + ('\n\n' + caption if caption else '') + '\n'
    path = unique('Photos', f'{meta["date"]} {safe_name(title)}'); write_note(path, meta, body)
    return result(path, meta)


# -- status --------------------------------------------------------------------
def entry(item, reason, kind='note'):
    p = item.get('path', '')
    folder = Path(p).parent.as_posix() if p else ''
    return {'path': p, 'title': item.get('title') or Path(p).stem, 'folder': '' if folder == '.' else folder, 'reason': reason,
            'kind': kind, 'obsidian': obsidian_link(p) if p else ''}


def compute_status():
    """Run the (non-publishing) export and describe what needs the author's attention."""
    publisher.export()
    report = read_json(publisher.REPORT)
    coros = read_json(vault() / '_System/coros-status.json')
    attention = [entry(h, h.get('reason', 'Held back'), 'held') for h in report.get('held', [])]
    if coros.get('lastError'):
        attention.append({'path': '', 'title': 'COROS sync', 'folder': '', 'reason': str(coros['lastError']), 'kind': 'coros', 'obsidian': ''})
    keys = ('coverageStart', 'coverageEnd', 'lastSync', 'recordCount', 'detailBacklog', 'fitBacklog', 'lastError')
    return {'vault': str(vault()), 'vaultName': CONFIG.get('vaultName') or vault().name, 'attention': attention,
            'ready': [entry(x, 'Never published') for x in report.get('ready', [])],
            'changed': [entry(x, 'Edited since last publish') for x in report.get('changed', [])],
            'lastPublished': state().get('lastPublished'), 'lastBuild': report.get('built'),
            'coros': {k: coros.get(k) for k in keys}}


# -- long operations -------------------------------------------------------------
@contextlib.contextmanager
def captured():
    """Collect everything written to fds 1 and 2, including child processes such as git and node."""
    sys.stdout.flush(); sys.stderr.flush()
    out = {'text': ''}
    with tempfile.TemporaryFile('w+b') as buf:
        saved = os.dup(1), os.dup(2)
        os.dup2(buf.fileno(), 1); os.dup2(buf.fileno(), 2)
        try: yield out
        finally:
            sys.stdout.flush(); sys.stderr.flush()
            os.dup2(saved[0], 1); os.dup2(saved[1], 2)
            for fd in saved: os.close(fd)
            buf.seek(0); out['text'] = buf.read().decode('utf-8', 'replace').strip()


def run_captured(fn):
    """Run fn(); on failure raise with the tool's own output (git, node) appended verbatim."""
    error = value = None
    with captured() as out:
        try: value = fn()
        except Exception as e: error = e
    if error:
        raise RuntimeError('\n'.join(x for x in (str(error), out['text'][-4000:]) if x))
    return value


class PreviewHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()
    def translate_path(self, path):
        p = super().translate_path(path)
        return p + '.html' if not os.path.exists(p) and os.path.isfile(p + '.html') else p


def preview_server(desk):
    if desk.preview is None:
        server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(PreviewHandler, directory=str(ROOT / 'dist')))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        desk.preview = server
    return f'http://127.0.0.1:{desk.preview.server_port}/'


class Desk:
    """Shared server state: session token, the one-operation-at-a-time lock, cached status, preview."""
    def __init__(self):
        self.token = secrets.token_urlsafe(32)
        self.lock = threading.Lock(); self.busy = None
        self.cache = None; self.preview = None

    @contextlib.contextmanager
    def operation(self, name):
        if not self.lock.acquire(blocking=False): raise Busy(f'Busy: {self.busy}')
        self.busy = name
        try: yield
        finally: self.busy = None; self.lock.release()

    def status(self):
        try:
            with self.operation('checking'): self.cache = compute_status()
        except Busy:
            if self.cache is None: raise
            return dict(self.cache, busy=self.busy)
        return dict(self.cache, busy=None)

    def sync(self):
        import coros_sync
        with self.operation('syncing COROS'): return {'changed': coros_sync.sync()}

    def build_preview(self):
        with self.operation('building preview'):
            run_captured(publisher.build)
            url = preview_server(self)
        webbrowser.open(url)
        return {'url': url}

    def publish(self):
        with self.operation('publishing'): run_captured(publisher.publish)
        return {'published': True}


# -- http ----------------------------------------------------------------------
class Handler(BaseHTTPRequestHandler):
    server_version = 'PublishingDesk/2.0'
    def log_message(self, fmt, *args): pass

    def _origin(self):
        host = self.headers.get('Host', ''); expected = f'127.0.0.1:{self.server.server_port}'
        return host == expected and (not self.headers.get('Origin') or self.headers['Origin'] == f'http://{expected}') \
            and (not self.headers.get('Sec-Fetch-Site') or self.headers['Sec-Fetch-Site'] in ('same-origin', 'none'))

    def _send(self, code, data, ctype='application/json'):
        raw = (json.dumps(data, ensure_ascii=False) if ctype == 'application/json' else data).encode()
        self.send_response(code); self.send_header('Content-Type', ctype + '; charset=utf-8')
        self.send_header('Content-Length', str(len(raw))); self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff'); self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'none'; frame-ancestors 'none'")
        self.end_headers(); self.wfile.write(raw)

    def do_GET(self):
        if not self._origin(): return self._send(403, {'error': 'Invalid origin'})
        path = urlparse(self.path).path
        try:
            if path in STATIC:
                name, ctype = STATIC[path]
                return self._send(200, (ASSETS / name).read_text(encoding='utf-8'), ctype)
            if path == '/api/token': return self._send(200, {'token': self.server.desk.token})
            if path == '/api/status': return self._send(200, self.server.desk.status())
            return self._send(404, {'error': 'Not found'})
        except Busy as e: return self._send(409, {'error': str(e)})
        except Exception as e: return self._send(500, {'error': str(e)})

    def do_POST(self):
        desk = self.server.desk
        if not self._origin() or self.headers.get('X-Desk-Token') != desk.token or self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
            return self._send(403, {'error': 'Invalid request'})
        routes = {
            '/api/capture/write': capture_write, '/api/capture/source': capture_source, '/api/capture/project': capture_project,
            '/api/capture/photos': capture_photos, '/api/photo': import_photo,
            '/api/visibility': lambda d: set_visibility(d.get('path'), d.get('public')),
            '/api/sync': lambda d: desk.sync(), '/api/preview': lambda d: desk.build_preview(), '/api/publish': lambda d: desk.publish(),
        }
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if length <= 0 or length > 28_000_000: raise ValueError('Request is too large')
            data = json.loads(self.rfile.read(length))
            handler = routes.get(urlparse(self.path).path)
            if not handler: return self._send(404, {'error': 'Not found'})
            if not isinstance(data, dict): raise ValueError('Invalid request')
            return self._send(200, handler(data))
        except Busy as e: return self._send(409, {'error': str(e)})
        except Exception as e: return self._send(400, {'error': str(e)})


def main():
    import argparse
    p = argparse.ArgumentParser(); p.add_argument('--open', action='store_true'); a = p.parse_args()
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler); server.desk = Desk()
    url = f'http://127.0.0.1:{server.server_port}/'
    print('Publishing Desk: ' + url, flush=True)
    if a.open: webbrowser.open(url)
    try: server.serve_forever()
    except KeyboardInterrupt: pass


if __name__ == '__main__': main()
