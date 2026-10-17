"""Hevy strength workouts: a read-only import through Hevy's public API.

Each workout is kept privately as _System/hevy/<id>.json = {importedAt, public, private: {raw}}.
`public` holds only the reviewed fields (title, times, exercises with sets, volume); the raw response
(notes, descriptions, routine ids) stays under `private`. A workout that overlaps a COROS activity
(+/- 20 minutes) is attached to it through _System/hevy-matches.json, so coros_sync's store is never
touched; any other workout becomes its own note in Training/Activities/. Only GET requests are made.

The API key is read from .local/hevy.key (written by scripts/set_hevy_key.sh) and is never logged.
"""
import argparse, json, re, time, urllib.error, urllib.parse, urllib.request
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
import yaml
import common
from common import LOCAL, CONFIG, read_json, write_json, now
import coros_sync

def vault(): return common.vault()

BASE = 'https://api.hevyapp.com/v1'
KEY_FILE = LOCAL / 'hevy.key'
PAGE_SIZE = 10            # the API maximum for /workouts and /workouts/events
MAX_PAGES = 400
LB_PER_KG = 2.20462
MI_PER_M = 1 / 1609.344
MATCH_SLACK_S = 20 * 60
NOT_CONNECTED = 'hevy: not connected'
OWNED = ('title', 'type', 'id', 'date', 'sport', 'source_app', 'duration', 'volume_lb', 'sets')
ONE_RM_MAX_REPS = 12


# ---------- API (read-only) ----------

def api_key():
    try: key = KEY_FILE.read_text().strip()
    except OSError: return None
    return key or None

def get(path, params=None, key=None, retries=3):
    """GET only. Retries rate limits and transient server errors; never includes the key in an error."""
    url = BASE + path + ('?' + urllib.parse.urlencode(params) if params else '')
    req = urllib.request.Request(url, headers={'api-key': key, 'Accept': 'application/json', 'User-Agent': 'personal-site-sync/1.0'}, method='GET')
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=30) as response: return json.loads(response.read().decode())
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and attempt < retries:
                time.sleep(min(30, float(e.headers.get('Retry-After') or 2 ** (attempt + 1)))); continue
            raise RuntimeError(f'Hevy answered HTTP {e.code} for {path}') from None
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            if attempt < retries: time.sleep(2 ** (attempt + 1)); continue
            raise RuntimeError(f'Hevy request failed for {path}: {type(e).__name__}') from None

def pages(path, field, key, params=None):
    page = 1
    while page <= MAX_PAGES:
        data = get(path, {**(params or {}), 'page': page, 'pageSize': PAGE_SIZE}, key)
        yield from data.get(field) or []
        if page >= int(data.get('page_count') or 1): return
        page += 1


# ---------- conversion ----------

def epoch(text):
    if not text: return None
    return int(datetime.fromisoformat(str(text).replace('Z', '+00:00')).timestamp())

def local_date(ts): return datetime.fromtimestamp(ts, ZoneInfo(CONFIG['timezone'])).date().isoformat()

def lb(kg): return round(float(kg) * LB_PER_KG, 1)

def set_of(s):
    out = {'type': s.get('type') or 'normal'}
    if s.get('reps') is not None: out['reps'] = int(s['reps'])
    if s.get('weight_kg') is not None: out['weightLb'] = lb(s['weight_kg'])
    if s.get('distance_meters'): out['distanceMi'] = round(float(s['distance_meters']) * MI_PER_M, 2)
    if s.get('duration_seconds'): out['durationS'] = int(s['duration_seconds'])
    return out

def is_working(s): return s.get('type') != 'warmup'

def totals(exercises):
    volume = sum(s['weightLb'] * s['reps'] for e in exercises for s in e['sets'] if is_working(s) and s.get('weightLb') and s.get('reps'))
    return round(volume, 1), sum(1 for e in exercises for s in e['sets'] if is_working(s))

def convert(w):
    """Hevy workout object -> store entry body (public + raw)."""
    start, end = epoch(w.get('start_time')), epoch(w.get('end_time'))
    exercises = [{'title': str(e.get('title') or 'Exercise'), 'sets': [set_of(s) for s in (e.get('sets') or [])]}
                 for e in sorted(w.get('exercises') or [], key=lambda e: e.get('index') or 0)]
    volume, count = totals(exercises)
    pub = {'id': str(w['id']), 'title': str(w.get('title') or 'Workout').strip() or 'Workout', 'date': local_date(start), 'start': start, 'end': end,
           'durationS': max(0, end - start) if start and end else None, 'exercises': exercises, 'volumeLb': volume, 'setCount': count}
    return {k: v for k, v in pub.items() if v is not None}, w


# ---------- private store ----------

def store(): return vault() / '_System/hevy'
def status_path(): return vault() / '_System/hevy-status.json'
def matches_path(): return vault() / '_System/hevy-matches.json'
def update_status(**fields):
    s = read_json(status_path()); before = dict(s); s.update(fields)
    if s != before: write_json(status_path(), s, True)

def all_workouts():
    """Public workout bodies, oldest first; a workout's `muscles` ({group: {primary, secondary}} set counts) rides along when known."""
    items = [read_json(p) for p in sorted(store().glob('*.json'))] if store().exists() else []
    return sorted(({**e['public'], **({'muscles': e['muscles']} if e.get('muscles') else {})} for e in items if e.get('public')),
                  key=lambda p: (p.get('start') or 0, p['id']))

def save_workout(w):
    if not re.fullmatch(r'[0-9A-Za-z-]+', str(w.get('id', ''))): return False
    pub, raw = convert(w)
    path = store() / f'{pub["id"]}.json'
    old = read_json(path)
    if old.get('public') == pub and (old.get('private') or {}).get('raw') == raw: return False
    write_json(path, {'importedAt': old.get('importedAt') or now(), 'public': pub, 'private': {'raw': raw}}, True)
    return True

def delete_workout(ident):
    path = store() / f'{ident}.json'
    if not path.exists(): return False
    path.unlink()
    m = read_json(matches_path())
    if m.pop(ident, None) is not None: write_json(matches_path(), m, True)
    return True


# ---------- matching against COROS ----------

def overlap_score(w, a):
    """Seconds of overlap between a Hevy workout and a COROS activity (each side padded by the slack), or None."""
    if not (w.get('start') and w.get('end') and a.get('start') and a.get('durationS')): return None
    a_end = a['start'] + a['durationS']
    low, high = max(w['start'], a['start'] - MATCH_SLACK_S), min(w['end'], a_end + MATCH_SLACK_S)
    return high - low if high > low else None

def match_workouts(workouts, activities, current, noted=()):
    """{hevyId: corosId}. Existing matches stay; each COROS activity takes at most one workout (the best overlap)."""
    ids = {a['id'] for a in activities}
    result = {k: v for k, v in current.items() if v in ids and any(w['id'] == k for w in workouts)}
    taken = set(result.values())
    for w in workouts:
        if w['id'] in result or w['id'] in noted: continue    # a workout that already has its own note stays separate
        scored = [(overlap_score(w, a), a['id']) for a in activities if a['id'] not in taken]
        scored = [s for s in scored if s[0]]
        if scored:
            _, cid = max(scored); result[w['id']] = cid; taken.add(cid)
    return result

def coros_activities():
    """Strength sessions only: lifting next to an elliptical or a ride is a separate workout, not that activity."""
    return [e['public'] for e in coros_sync.all_entries() if e['public'].get('id') and e['public'].get('group') == 'strength']

def lifts_for(coros_id):
    """Lifts attached to a COROS activity, or None."""
    for hid, cid in read_json(matches_path()).items():
        if cid == coros_id:
            pub = read_json(store() / f'{hid}.json').get('public')
            if pub: return pub
    return None


# ---------- notes for unmatched workouts ----------

def owned_properties(pub):
    props = {'title': pub['title'], 'type': 'activity', 'id': 'hevy-' + pub['id'], 'date': pub['date'], 'sport': 'Strength', 'source_app': 'hevy'}
    if pub.get('durationS'): props['duration'] = coros_sync.hms(pub['durationS'])
    if pub.get('volumeLb'): props['volume_lb'] = round(pub['volumeLb'])
    if pub.get('setCount'): props['sets'] = pub['setCount']
    return props

def note_ids():
    """Hevy workout ids that already have a note."""
    folder = vault() / 'Training/Activities'; found = set()
    for path in sorted(folder.glob('*.md')) if folder.exists() else []:
        try: meta, _ = coros_sync.split_note(path.read_text(encoding='utf-8'))
        except (ValueError, yaml.YAMLError, UnicodeDecodeError): continue
        if meta and str(meta.get('id', '')).startswith('hevy-'): found.add(str(meta['id'])[5:])
    return found

def sync_notes(workouts, matches):
    """One note per workout that has no COROS activity. Properties are refreshed; the body is never touched."""
    folder = vault() / 'Training/Activities'; folder.mkdir(parents=True, exist_ok=True)
    existing = {}
    for path in sorted(folder.glob('*.md')):
        try: meta, _ = coros_sync.split_note(path.read_text(encoding='utf-8'))
        except (ValueError, yaml.YAMLError, UnicodeDecodeError): continue
        if meta and str(meta.get('id', '')).startswith('hevy-'): existing.setdefault(str(meta['id']), path)
    taken = {p.name.lower() for p in folder.glob('*')}
    changed = set()
    for pub in workouts:
        ident = 'hevy-' + pub['id']; path = existing.get(ident)
        if path is None and pub['id'] in matches: continue    # shown on the COROS activity's page
        want = owned_properties(pub)
        if path is None:
            base = f"{pub['date']} {coros_sync.safe_title(pub['title'])}"; name, n = base + '.md', 1
            while name.lower() in taken: n += 1; name = f'{base} {n}.md'
            taken.add(name.lower())
            coros_sync.put_note(folder / name, want, '\n'); changed.add(ident); continue
        meta, rest = coros_sync.split_note(path.read_text(encoding='utf-8'))
        if all(str(meta.get(k)) == str(v) for k, v in want.items()) and not (set(OWNED) - set(want)) & set(meta): continue
        coros_sync.put_note(path, {**want, **{k: v for k, v in meta.items() if k not in OWNED}}, rest); changed.add(ident)
    return changed


# ---------- estimated 1RM ----------

def e1rm(weight_lb, reps):
    """Epley estimate; a single is its own maximum. None outside 1-12 reps."""
    if not weight_lb or not reps or weight_lb <= 0 or not (1 <= reps <= ONE_RM_MAX_REPS): return None
    return round(weight_lb if reps == 1 else weight_lb * (1 + reps / 30), 1)

def exercise_progress(workouts):
    """{title: {sessions, daily: {date: best e1RM}, best: {e1rmLb, weightLb, reps, date}}} from working sets."""
    out = defaultdict(lambda: {'sessions': set(), 'daily': {}, 'best': None})
    for w in workouts:
        for e in w['exercises']:
            sets = [(e1rm(s.get('weightLb'), s.get('reps')), s) for s in e['sets'] if is_working(s)]
            sets = [(v, s) for v, s in sets if v]
            if not sets: continue
            o = out[e['title']]; o['sessions'].add(w['id'])
            value, top = max(sets, key=lambda x: (x[0], x[1]['weightLb']))
            o['daily'][w['date']] = max(o['daily'].get(w['date'], 0), value)
            if not o['best'] or value > o['best']['e1rmLb']:      # workouts run oldest first, so a tie keeps the first time
                o['best'] = {'e1rmLb': value, 'weightLb': top['weightLb'], 'reps': top['reps'], 'date': w['date']}
    return {k: {'sessions': len(v['sessions']), 'daily': v['daily'], 'best': v['best']} for k, v in out.items()}


# ---------- muscles worked ----------

SKIP_GROUPS = {'cardio', 'full_body', 'other'}       # not a region of the body
PAGE_SIZE_TEMPLATES = 100                             # the API maximum for /exercise_templates

def templates_path(): return vault() / '_System/hevy-templates.json'     # outside _System/hevy/, which holds one file per workout

def template_ids(raw):
    return {str(e['exercise_template_id']) for e in (raw.get('exercises') or []) if e.get('exercise_template_id')}

def trim_template(t):
    primary = str(t.get('primary_muscle_group') or '')
    return {'title': str(t.get('title') or ''), 'primary': primary, 'secondary': [str(m) for m in (t.get('secondary_muscle_groups') or [])]}

def refresh_templates(wanted, key):
    """Cache of exercise templates ({id: {title, primary, secondary}}). Only ids not yet cached are fetched:
    the paginated list first (a handful of requests), then single lookups for what the list lacks."""
    cache = read_json(templates_path())
    missing = {i for i in wanted if i not in cache}
    if not missing: return cache
    page = 1
    while missing and page <= MAX_PAGES:
        data = get('/exercise_templates', {'page': page, 'pageSize': PAGE_SIZE_TEMPLATES}, key)
        for t in data.get('exercise_templates') or []:
            if t.get('id') and str(t['id']) in missing: cache[str(t['id'])] = trim_template(t); missing.discard(str(t['id']))
        if page >= int(data.get('page_count') or 1): break
        page += 1
    for ident in sorted(missing):
        try: cache[ident] = trim_template(get(f'/exercise_templates/{urllib.parse.quote(ident, safe="")}', None, key))
        except RuntimeError: continue          # unavailable (e.g. a deleted custom exercise): left uncached, tried again next time
    write_json(templates_path(), cache, True)
    return cache

def muscles_of(raw, templates):
    """{group: {'primary': n, 'secondary': n}} counted in working sets (warm-ups skipped) for one raw Hevy workout."""
    out = {}
    for e in raw.get('exercises') or []:
        t = templates.get(str(e.get('exercise_template_id')))
        if not t: continue
        n = sum(1 for s in (e.get('sets') or []) if s.get('type') != 'warmup')
        if not n: continue
        for group, kind in [(t['primary'], 'primary')] + [(g, 'secondary') for g in t['secondary'] if g != t['primary']]:
            if group and group not in SKIP_GROUPS:
                o = out.setdefault(group, {'primary': 0, 'secondary': 0}); o[kind] += n
    return out

def attach_muscles(key):
    """Write `muscles` into every stored workout (private store only). Returns the number of workouts updated."""
    paths = sorted(store().glob('*.json')) if store().exists() else []
    entries = [(p, read_json(p)) for p in paths]
    wanted = set().union(*[template_ids((e.get('private') or {}).get('raw') or {}) for _, e in entries]) if entries else set()
    templates = refresh_templates(wanted, key) if wanted else {}
    changed = 0
    for path, entry in entries:
        raw = (entry.get('private') or {}).get('raw')
        if not raw: continue
        muscles = muscles_of(raw, templates)
        if (entry.get('muscles') or {}) != muscles:
            entry['muscles'] = muscles; write_json(path, entry, True); changed += 1
    return changed


# ---------- orchestration ----------

def full_import(key):
    changed = set()
    for w in pages('/workouts', 'workouts', key):
        if save_workout(w): changed.add(str(w['id']))
    return changed

def incremental(key, since):
    changed = set()
    for ev in pages('/workouts/events', 'events', key, {'since': since}):
        if ev.get('type') == 'deleted' and ev.get('id'):
            if delete_workout(str(ev['id'])): changed.add(str(ev['id']))
        elif ev.get('type') == 'updated' and ev.get('workout'):
            if save_workout(ev['workout']): changed.add(str(ev['workout']['id']))
    return changed

def sync(full=False):
    """Returns the number of changed workouts and notes. Never raises: problems are recorded in the status file."""
    key = api_key()
    if not key:
        update_status(state=NOT_CONNECTED); return 0
    started = (datetime.now(timezone.utc) - timedelta(minutes=10)).strftime('%Y-%m-%dT%H:%M:%SZ')   # overlap absorbs clock skew
    try:
        status = read_json(status_path())
        local = {p.stem for p in store().glob('*.json')} if store().exists() else set()
        count = int(get('/workouts/count', None, key).get('workout_count', 0))
        cursor = status.get('cursor')
        if full or not cursor or not local:
            changed = full_import(key)
        else:
            changed = incremental(key, cursor)
            if len(list(store().glob('*.json'))) != count: changed |= full_import(key)   # drifted: reconcile
        try: attach_muscles(key)
        except RuntimeError as e: update_status(muscleError=str(e)[:200])     # the workouts themselves are unaffected
        else: update_status(muscleError=None)
        workouts = all_workouts()
        matches = match_workouts(workouts, coros_activities(), read_json(matches_path()), note_ids())
        if matches != read_json(matches_path()): write_json(matches_path(), matches, True)
        changed |= {'note:' + i for i in sync_notes(workouts, matches)}
        update_status(state='hevy: connected', lastSync=now(), cursor=started, count=len(workouts), matched=len(matches), changedLastSync=len(changed), lastError=None)
        return len(changed)
    except Exception as e:
        update_status(lastError=f'{type(e).__name__}: {e}'[:300], lastAttempt=now())
        return 0


if __name__ == '__main__':
    p = argparse.ArgumentParser(description='Hevy workout importer (read-only)')
    p.add_argument('action', choices=['sync', 'full-sync'])
    a = p.parse_args()
    print(sync(full=a.action == 'full-sync'))
    s = read_json(status_path())
    print(s.get('state') or '', s.get('lastError') or '')
