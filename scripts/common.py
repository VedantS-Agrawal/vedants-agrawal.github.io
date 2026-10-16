"""Local files and publication state. No private state belongs in Git."""
import json, os, re, tempfile
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
import yaml

ROOT = Path(__file__).resolve().parents[1]
LOCAL = ROOT / '.local'
CONFIG = json.loads((ROOT / 'site.config.json').read_text())

def now():
    return datetime.now(ZoneInfo(CONFIG['timezone'])).isoformat(timespec='seconds')

def read_json(path, default=None):
    return json.loads(path.read_text()) if path.exists() else ({} if default is None else default)

def write_json(path, data, private=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(dir=path.parent, prefix='.write-')
    with os.fdopen(fd, 'w') as f: json.dump(data, f, indent=2, ensure_ascii=False, default=str); f.write('\n')
    if private: os.chmod(name, 0o600)
    os.replace(name, path)

def vault():
    settings = read_json(ROOT / 'site.local.json')
    return Path(settings.get('vault', str(LOCAL / 'vault'))).expanduser()

def state_path(): return vault() / '_System' / 'publishing.json'
def state(): return read_json(state_path(), {'notes': {}, 'media': [], 'lastPublished': None})
def save_state(data): write_json(state_path(), data, True)

def inside(base, relative):
    p = (base / relative).resolve()
    if not p.is_relative_to(base.resolve()): raise ValueError('Path is outside the vault')
    return p

def parse_note(path):
    text = path.read_text(encoding='utf-8')
    match = re.match(r'^---\s*\n(.*?)\n---\s*\n?', text, re.S)
    if not match: return {}, text
    meta = yaml.safe_load(match[1]) or {}
    if not isinstance(meta, dict): raise ValueError(f'Invalid properties: {path.name}')
    return meta, text[match.end():]

def write_note(path, meta, body=''):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text('---\n' + yaml.safe_dump(meta, sort_keys=False, allow_unicode=True).strip() + '\n---\n\n' + body, encoding='utf-8')

def slug(text):
    return re.sub(r'[^a-z0-9]+', '-', str(text).lower()).strip('-') or 'note'

def notes():
    result=[]
    for p in sorted(vault().rglob('*.md')):
        rel=p.relative_to(vault()).as_posix()
        if any(x.startswith('.') for x in p.relative_to(vault()).parts) or rel.startswith(('_System/', 'Templates/', 'Guide/')): continue
        meta, body=parse_note(p)
        result.append({'path':rel,'meta':meta,'body':body,'title':str(meta.get('title') or p.stem)})
    return result
