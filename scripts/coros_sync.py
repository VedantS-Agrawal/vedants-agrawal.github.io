"""Private COROS activity sync via the account's official regional MCP endpoint.

Per activity this keeps one private store file (_System/activities/<id>.json) and one
vault note (Training/Activities/YYYY-MM-DD <Title>.md). Only narrow, reviewed fields go
in `public`, `detail` and `series`; raw responses and anything location-like stay under
`private`, and FIT originals live in _System/fit/. Nothing here is ever copied into the
site repository except through scripts/publisher.py.
"""
import argparse, json, os, re, tempfile, time, urllib.request, urllib.parse
from collections import Counter
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo
import yaml
from common import ROOT, LOCAL, CONFIG, vault, read_json, write_json, now

ISSUER = 'https://mcpus.coros.com'
TOKEN = LOCAL / 'coros/us/token.json'
HISTORY = LOCAL / 'coros-history.json'

DETAIL_CALLS = 60       # MCP calls per run spent on detail + laps (2 per activity)
FIT_DAILY_CAP = 45      # COROS allows about 50 FIT downloads a day; keep headroom
RECENT_DAYS = 3         # activities this young are refetched (COROS keeps updating them)
RETRY_DETAIL_S = 24 * 3600
RETRY_FIT_DAYS = 7
MAX_POINTS = 600

GENERIC_TITLES = {'indoor bike', 'outdoor bike', 'treadmill', 'indoor run', 'outdoor run', 'track run', 'gym cardio'}
NOTE_FIELD = re.compile(r'note|voice|audio|speech|transcript|memo|comment|annotation|text|caption', re.I)


# ---------- COROS MCP access ----------

def request(url, payload, bearer=None, form=False):
    data = urllib.parse.urlencode(payload).encode() if form else json.dumps(payload).encode()
    headers = {'Content-Type': 'application/x-www-form-urlencoded' if form else 'application/json', 'Accept': 'application/json, text/event-stream'}
    if bearer: headers['Authorization'] = 'Bearer ' + bearer
    with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=headers), timeout=35) as response:
        raw = response.read().decode()
    if raw.startswith('event:') or raw.startswith('data:'):
        raw = ''.join(line[6:] for line in raw.splitlines() if line.startswith('data:'))
    return json.loads(raw)

def token():
    t = read_json(TOKEN)
    if not t.get('refresh_token'): raise RuntimeError('Connect COROS in the publishing desk first')
    if time.time() + 120 >= int(t.get('expires_at_epoch', 0)):
        fresh = request(ISSUER + '/oauth2/token', {'grant_type': 'refresh_token', 'client_id': t['client_id'], 'refresh_token': t['refresh_token']}, form=True)
        if not fresh.get('access_token') or not fresh.get('refresh_token'): raise RuntimeError('COROS session expired; reconnect COROS')
        t.update(access_token=fresh['access_token'], refresh_token=fresh['refresh_token'], expires_at_epoch=int(time.time()) + int(fresh.get('expires_in', 3600)))
        write_json(TOKEN, t, True)
    return t['access_token']

def mcp(method, params=None):
    bearer = token(); url = ISSUER + '/mcp'
    if method != 'initialize':
        # COROS currently uses stateless MCP; initialization checks the session.
        _mcp_raw(url, bearer, 'initialize', {'protocolVersion': '2025-06-18', 'capabilities': {}, 'clientInfo': {'name': 'Vedant Publishing Desk', 'version': '1.0'}})
    return _mcp_raw(url, bearer, method, params or {})

def _mcp_raw(url, bearer, method, params):
    response = request(url, {'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params}, bearer)
    if 'error' in response: raise RuntimeError('COROS request failed: ' + str(response['error'].get('message', 'unknown error')))
    result = response.get('result', {})
    if result.get('isError'):
        text = ' '.join(c.get('text', '') for c in result.get('content', []) if c.get('type') == 'text')[:200]
        raise RuntimeError('COROS rejected ' + method + (': ' + text if text else ''))
    return result

def tool(name, args): return mcp('tools/call', {'name': name, 'arguments': args})

def text_result(result):
    parts = [c.get('text', '') for c in result.get('content', []) if c.get('type') == 'text']
    if not parts: raise RuntimeError('COROS returned no activity text')
    value = '\n'.join(parts)
    try:
        decoded = json.loads(value)
        if isinstance(decoded, str): value = decoded
        elif isinstance(decoded, (dict, list)): return decoded
    except json.JSONDecodeError: pass
    return value

def download(url):
    with urllib.request.urlopen(url, timeout=60) as response: return response.read()

class Budget:
    """Counts MCP calls so one run cannot hammer the endpoint."""
    def __init__(self, calls): self.left = calls
    def call(self, name, args):
        if self.left <= 0: raise BudgetSpent()
        self.left -= 1
        return text_result(tool(name, args))

class BudgetSpent(Exception): pass


# ---------- parsing ----------

def sport_group(t):
    if t is None: return 'other'
    t = int(t)
    if t in (100, 101, 102, 103): return 'run'
    if t in (104, 105): return 'hike'
    if 200 <= t <= 299: return 'ride'
    if t in (300, 301): return 'swim'
    if t in (400, 401, 402, 9901): return 'strength'
    if t == 900: return 'walk'
    return 'other'

def clock(text):
    m = re.fullmatch(r'\s*(\d+):(\d{2})(?::(\d{2}))?\s*', text or '')
    if not m: return None
    a, b, c = int(m[1]), int(m[2]), m[3]
    return a * 3600 + b * 60 + int(c) if c is not None else a * 60 + b

def number(text):
    m = re.search(r'-?\d+(?:\.\d+)?', text or '')
    return float(m[0]) if m else None

def parse_chunk(chunk):
    """One querySportRecords entry (text between the '3. ' markers)."""
    head = re.match(r'\s*(?:\d+\. )?(.+?) — (\d{4}-\d{2}-\d{2})', chunk)
    ident = re.search(r'LabelId: (\d+) \| SportType: (\d+)', chunk)
    if not head or not ident: return None
    duration = re.search(r'Duration: ([\d:]+)', chunk)
    distance = re.search(r'Distance: ([\d.]+) (km|m)\b', chunk)
    hr = re.search(r'Avg HR: (\d+) bpm', chunk)
    calories = re.search(r'Calories: (\d+) kcal', chunk)
    ts = re.search(r'startTimestamp=(\d+) \| endTimestamp=(\d+)', chunk)
    location = re.search(r'Location: ([^\n]*)', chunk)
    return {'id': ident[1], 'date': head[2], 'sport': head[1].strip(), 'sportType': int(ident[2]),
            'location': location[1].strip() if location else '',
            'durationS': clock(duration[1]) if duration else None,
            'distanceKm': round(float(distance[1]) / (1000 if distance[2] == 'm' else 1), 3) if distance else None,
            'avgHr': int(hr[1]) if hr else None, 'calories': int(calories[1]) if calories else None,
            'start': int(ts[1]) if ts else None, 'end': int(ts[2]) if ts else None, 'raw': chunk.strip('\n') + '\n'}

def parse_records(raw):
    """Parse querySportRecords output (text, or an MCP result holding that text)."""
    if isinstance(raw, dict) and 'content' in raw: raw = text_result(raw)
    if not isinstance(raw, str): raise ValueError('Unexpected COROS activity data')
    chunks = re.split(r'(?m)^\d+\. ', raw)[1:]
    found = [r for r in map(parse_chunk, chunks) if r]
    if not found and 'record' not in raw.lower(): raise ValueError('Unexpected COROS activity data')
    return found

# Detail text label -> (metric key, kind). Unknown labels are ignored.
DETAIL_FIELDS = {
    'Workout Time': ('durationS', 'time'), 'Total Time': ('elapsedS', 'time'), 'Distance': ('distanceKm', 'km'),
    'Average Pace': ('paceSPerKm', 'pace'), 'Moving Average Pace': ('movingPaceSPerKm', 'pace'),
    'Adjusted Pace': ('adjustedPaceSPerKm', 'pace'), 'Best Kilometer': ('bestKmSPerKm', 'pace'),
    'Average Speed': ('speedKmh', 'num'), 'Moving Average Speed': ('movingSpeedKmh', 'num'), 'Max Speed': ('maxSpeedKmh', 'num'),
    'Average Heart Rate': ('avgHr', 'int'), 'Max Heart Rate': ('maxHr', 'int'),
    'Average Cadence': ('cadence', 'int'), 'Average Stride Length': ('strideM', 'num'),
    'Average Power': ('power', 'int'), 'Normalized Power': ('normalizedPower', 'int'),
    'Calories': ('calories', 'int'), 'Training Load': ('load', 'int'),
    'Aerobic TE': ('aerobicTE', 'num'), 'Anaerobic TE': ('anaerobicTE', 'num'),
    'Training Focus': ('focus', 'text'), 'Performance': ('performance', 'text'),
    'Steps': ('steps', 'int'), 'Lengths': ('lengths', 'int'), 'Average SWOLF': ('swolf', 'int'),
    'Average Stroke Rate': ('strokeRate', 'int'), 'Water Temperature': ('waterTempC', 'num'),
    'Cycling IF': ('intensityFactor', 'num'), 'Efficiency Factor': ('efficiencyFactor', 'num'), 'Variation Index': ('variationIndex', 'num'),
}
KEEP_ZERO = {'load', 'aerobicTE', 'anaerobicTE'}  # a real zero; elsewhere 0 means "not recorded"

def parse_detail(text):
    """getActivityDetail text -> (metrics, workout note or None). Missing values are omitted, never 0."""
    metrics, note = {}, None
    for line in text.splitlines():
        label, sep, value = line.partition(': ')
        label, value = label.strip(), value.strip()
        if not sep or not value: continue
        if label == 'Workout Note': note = value; continue
        if label == 'Elevation Gain / Loss':
            m = re.match(r'(-?[\d.]+) m / (-?[\d.]+) m', value)
            if m and (float(m[1]) or float(m[2])): metrics['elevGainM'], metrics['elevLossM'] = round(float(m[1])), round(float(m[2]))
            continue
        if label not in DETAIL_FIELDS: continue
        key, kind = DETAIL_FIELDS[label]
        if kind == 'time': v = clock(value)
        elif kind == 'pace':
            v = clock(value.split(' ')[0])
            if v and '/100m' in value: v *= 10   # swim pace is stored per kilometre like every other pace
        elif kind == 'text': v = value
        else:
            v = number(value)
            if v is not None and kind == 'km' and not re.search(r'km', value): v /= 1000   # "400 m"
            if v is not None and kind == 'int': v = round(v)
        if v is None or (v == 0 and key not in KEEP_ZERO): continue
        metrics[key] = v
    if metrics.get('elapsedS') == metrics.get('durationS'): metrics.pop('elapsedS', None)
    return metrics, note

# Preferred lap-group types per sport group, best first. Type -1 is the whole activity.
LAP_PREFERENCE = {'run': (2, 1, 10, 3), 'walk': (2, 1, 10, 3), 'hike': (2, 1, 10, 3), 'ride': (10, 2, 1, 3), 'swim': (2, 1, 3)}

def parse_laps(data, group):
    """queryActivityLapData JSON -> (laps, maxHr of the whole activity). Distances arrive in cm, speeds in 0.01 km/h."""
    if not isinstance(data, dict): return [], None
    groups = [g for g in data.get('lapGroups') or [] if g.get('laps')]
    whole = next((g for g in groups if g.get('type') == -1), None)
    max_hr = (whole['laps'][0].get('maxHr') or None) if whole else None
    splits = [g for g in groups if g.get('type') != -1]
    chosen = None
    for t in LAP_PREFERENCE.get(group, (2, 1, 10, 3)):
        chosen = next((g for g in splits if g.get('type') == t and len(g['laps']) > 1), None)
        if chosen: break
    chosen = chosen or next((g for g in sorted(splits, key=lambda g: -len(g['laps'])) if len(g['laps']) > 1), None)
    laps = []
    for i, lap in enumerate(chosen['laps'] if chosen else [], 1):
        km = (lap.get('distance') or 0) / 100000
        seconds = lap.get('time') or 0
        out = {'index': i}
        if km: out['distanceKm'] = round(km, 3)
        if seconds: out['timeS'] = round(seconds, 1)
        if km and seconds:
            if group != 'ride': out['paceSPerKm'] = round(seconds / km)
            out['speedKmh'] = round(km / seconds * 3600, 2)
        for key, src in (('avgHr', 'avgHr'), ('maxHr', 'maxHr'), ('cadence', 'avgCadence'), ('power', 'avgPower'), ('elevGainM', 'elevGain')):
            if lap.get(src): out[key] = round(lap[src])
        laps.append(out)
    if not max_hr and laps: max_hr = max((l.get('maxHr') or 0 for l in laps), default=0) or None
    return laps, max_hr


# ---------- FIT ----------

def parse_fit(path, group):
    """FIT file -> (series downsampled to MAX_POINTS, scan of message names that might hold notes).
    Position fields are never read."""
    import fitdecode
    rows, messages, note_like, long_text = [], Counter(), set(), set()
    with fitdecode.FitReader(str(path), check_crc=fitdecode.CrcCheck.WARN) as reader:
        for frame in reader:
            if frame.frame_type != fitdecode.FIT_FRAME_DATA: continue
            first = frame.name not in messages
            messages[frame.name] += 1
            if first and (NOTE_FIELD.search(frame.name) or frame.name.startswith('unknown_')): note_like.add(frame.name)
            for f in frame.fields if first or frame.name != 'record' else ():
                if first and NOTE_FIELD.search(f.name): note_like.add(f'{frame.name}.{f.name}')
                if isinstance(f.value, str) and len(f.value) > 24: long_text.add(f'{frame.name}.{f.name}')
            if frame.name != 'record': continue
            get = frame.get_value
            rows.append({'ts': get('timestamp', fallback=None), 'hr': get('heart_rate', fallback=None),
                         'speed': get('enhanced_speed', fallback=None) if get('enhanced_speed', fallback=None) is not None else get('speed', fallback=None),
                         'elev': get('enhanced_altitude', fallback=None) if get('enhanced_altitude', fallback=None) is not None else get('altitude', fallback=None),
                         'power': get('power', fallback=None), 'cadence': get('cadence', fallback=None), 'dist': get('distance', fallback=None)})
    scan = {'messages': dict(messages), 'noteLike': sorted(note_like), 'longText': sorted(long_text)}
    return build_series(rows, group), scan

def fill(values):
    """Leading gaps take the first reading, later gaps repeat the last one."""
    known = next((v for v in values if v is not None), None)
    out = []
    for v in values:
        known = v if v is not None else known
        out.append(known)
    return out

def build_series(rows, group):
    rows = [r for r in rows if r['ts'] is not None]
    if not rows: return {}
    t0 = rows[0]['ts']
    n = len(rows)
    idx = list(range(n)) if n <= MAX_POINTS else sorted({round(i * (n - 1) / (MAX_POINTS - 1)) for i in range(MAX_POINTS)})
    scale = 2 if group in ('run', 'walk', 'hike') else 1   # FIT stores running cadence per leg
    columns = {
        'hr': [r['hr'] for r in rows],
        'speedKmh': [r['speed'] * 3.6 if r['speed'] is not None else None for r in rows],
        'elevM': [r['elev'] for r in rows],
        'power': [r['power'] for r in rows],
        'cadence': [r['cadence'] * scale if r['cadence'] is not None else None for r in rows],
        'distanceKm': [r['dist'] / 1000 if r['dist'] is not None else None for r in rows],
    }
    digits = {'hr': 0, 'speedKmh': 2, 'elevM': 1, 'power': 0, 'cadence': 0, 'distanceKm': 3}
    series = {'t': [round((rows[i]['ts'] - t0).total_seconds()) for i in idx]}
    for key, values in columns.items():
        values = fill(values)
        picked = [None if values[i] is None else round(values[i], digits[key]) for i in idx]
        present = [v for v in picked if v is not None]
        if not present: continue
        if key in ('power', 'cadence', 'hr') and max(present) == 0: continue
        if key == 'elevM' and max(present) == min(present): continue   # a flat line says nothing
        series[key] = [int(v) if digits[key] == 0 else v for v in picked]
    return series


# ---------- private store ----------

def store(): return vault() / '_System/activities'
def load(ident): return read_json(store() / f'{ident}.json')
def save(ident, entry): write_json(store() / f'{ident}.json', entry, True)
def fit_file(ident): return vault() / '_System/fit' / f'{ident}.fit'
def status_path(): return vault() / '_System/coros-status.json'
def update_status(**fields):
    s = read_json(status_path()); s.update(fields); write_json(status_path(), s, True)

def today_local(): return datetime.now(ZoneInfo(CONFIG['timezone'])).date()

def title_of(location, sport):
    loc = (location or '').strip()
    return sport if not loc or loc.lower() == sport.lower() or loc.lower() in GENERIC_TITLES else loc

def public_of(entry):
    """Build the reviewed public summary from the stored record text plus fetched metrics."""
    rec = parse_chunk(entry['private']['raw'])
    m = (entry.get('detail') or {}).get('metrics') or {}
    pub = {'id': rec['id'], 'date': rec['date'], 'start': rec['start'], 'sport': rec['sport'], 'group': sport_group(rec['sportType']),
           'durationS': rec['durationS'] or m.get('durationS'), 'distanceKm': rec['distanceKm'] or m.get('distanceKm'),
           'elevGainM': m.get('elevGainM'), 'avgHr': rec['avgHr'] or m.get('avgHr'), 'load': m.get('load'),
           'title': title_of(rec['location'], rec['sport'])}
    return {k: v for k, v in pub.items() if v is not None}

def signature(entry): return json.dumps([entry.get('public'), entry.get('detail'), entry.get('series')], sort_keys=True)

def import_records(records, source):
    """Create or refresh store entries from parsed records. Fetched detail, series and FIT state are kept."""
    store().mkdir(parents=True, exist_ok=True)
    changed = set()
    for rec in records:
        ident = str(rec['id'])
        if not re.fullmatch(r'\d+', ident): continue
        entry = load(ident); before = signature(entry)
        entry.setdefault('detail', {}); entry.setdefault('fit', {'downloaded': False})
        entry['source'] = 'COROS'
        entry['private'] = {**entry.get('private', {}), 'sportType': rec['sportType'], 'raw': rec['raw']}
        entry['public'] = public_of(entry)
        if not entry.get('importedAt') or signature(entry) != before:
            entry['importedAt'] = now(); save(ident, entry)
            if signature(entry) != before: changed.add(ident)
    return changed

def migrate_store():
    """Rewrite entries saved by the previous importer into the current shape, using their stored record text."""
    changed = set()
    for path in sorted(store().glob('*.json')) if store().exists() else []:
        entry = read_json(path)
        raw = (entry.get('private') or {}).get('raw')
        if not isinstance(raw, str) or not parse_chunk(raw): continue
        want = public_of(entry)
        if entry.get('public') == want and 'fit' in entry and 'detail' in entry: continue
        entry.setdefault('detail', {}); entry.setdefault('fit', {'downloaded': False})
        entry['public'] = want; entry['importedAt'] = now()
        write_json(path, entry, True); changed.add(path.stem)
    return changed

def seed_history():
    if not HISTORY.exists(): return []
    return parse_records(read_json(HISTORY))

def all_entries():
    """Entries newest first."""
    items = [read_json(p) for p in store().glob('*.json')] if store().exists() else []
    items = [e for e in items if e.get('public')]
    return sorted(items, key=lambda e: (e['public'].get('start') or 0, e['public']['date']), reverse=True)


# ---------- detail, laps, FIT ----------

def needs_detail(entry, today):
    if not entry['public'].get('id'): return False
    failed = (entry.get('private') or {}).get('detailFailedAt')
    if failed and time.time() - failed < RETRY_DETAIL_S: return False
    if 'metrics' not in (entry.get('detail') or {}): return True
    return (today - date.fromisoformat(entry['public']['date'])).days <= RECENT_DAYS

def fetch_detail(entry, budget):
    ident, sport_type = entry['public']['id'], entry['private']['sportType']
    args = {'labelId': ident, 'sportType': sport_type}
    text = budget.call('getActivityDetail', args)
    if not isinstance(text, str): raise RuntimeError('Unexpected COROS activity detail')
    metrics, note = parse_detail(text)
    laps, max_hr = [], None
    try:
        laps, max_hr = parse_laps(budget.call('queryActivityLapData', args), entry['public']['group'])
    except BudgetSpent: raise
    except RuntimeError: pass    # splits are optional; keep the metrics
    if max_hr and 'maxHr' not in metrics: metrics['maxHr'] = max_hr
    entry['detail'] = {'metrics': metrics, 'laps': laps}
    entry['private'].pop('detailFailedAt', None)
    if note: entry['private']['workoutNote'] = note
    else: entry['private'].pop('workoutNote', None)
    entry['public'] = public_of(entry)

def detail_pass(calls, today, changed, errors):
    budget, failures = Budget(calls), 0
    for entry in all_entries():
        if not needs_detail(entry, today): continue
        if budget.left < 2 or failures >= 3: break    # three misses in a row means auth or network, not one bad activity
        ident, before = entry['public']['id'], signature(entry)
        try: fetch_detail(entry, budget); failures = 0
        except BudgetSpent: break
        except Exception as ex:
            failures += 1
            entry['private']['detailFailedAt'] = int(time.time()); errors.append(f'{ident}: {ex}')
        if signature(entry) != before: entry['importedAt'] = now(); changed.add(ident)
        save(ident, entry)
    return calls - budget.left

def fit_wanted(entry, today):
    fit = entry.get('fit') or {}
    if fit.get('downloaded'): return not entry.get('series') and not fit.get('error')   # parse a stored file we have not read
    failed = fit.get('failedOn')
    return not (failed and (today - date.fromisoformat(failed)).days < RETRY_FIT_DAYS)

def fit_url(entry):
    text = text_result(tool('queryActivityFitFileDownloadUrls', {'labelId': entry['public']['id'], 'sportType': entry['private']['sportType']}))
    found = re.search(r'https://\S+', text if isinstance(text, str) else json.dumps(text))
    if not found: raise RuntimeError('COROS has no FIT file for this activity')
    return found[0].rstrip('.,)"\\')

def fit_pass(limit, today, changed, errors):
    """Newest first. A stored file is parsed without spending quota; new downloads respect the daily cap."""
    status = read_json(status_path())
    quota = status.get('fitQuota') or {}
    if quota.get('date') != today.isoformat(): quota = {'date': today.isoformat(), 'used': 0}
    downloads = 0
    for entry in all_entries():
        if not fit_wanted(entry, today): continue
        ident, fit, before = entry['public']['id'], entry.get('fit') or {'downloaded': False}, signature(entry)
        path = fit_file(ident)
        if not path.exists():
            if downloads >= limit or quota['used'] >= FIT_DAILY_CAP: continue   # older activities may still be stored locally
            quota['used'] += 1; downloads += 1
            update_status(fitQuota=quota)    # count before the request: failed requests still count against COROS's limit
            try:
                data = download(fit_url(entry))
                path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(data)
            except Exception as ex:
                if 'daily limit' in str(ex).lower():   # COROS's own count is authoritative: stop for today, not an error
                    quota['used'] = FIT_DAILY_CAP; break
                entry['fit'] = {'downloaded': False, 'failedOn': today.isoformat(), 'error': str(ex)[:200]}
                errors.append(f'{ident}: FIT {ex}'); save(ident, entry); continue
        try:
            series, scan = parse_fit(path, entry['public']['group'])
            entry['series'] = series
            entry['fit'] = {'downloaded': True, 'file': f'_System/fit/{ident}.fit', 'messages': scan['messages'], 'noteLike': scan['noteLike'], 'longText': scan['longText']}
            if not series: entry['fit']['error'] = 'no records'
            metrics = (entry.get('detail') or {}).get('metrics')
            if metrics is not None and 'maxHr' not in metrics and series.get('hr'): metrics['maxHr'] = max(series['hr'])
        except Exception as ex:
            entry['fit'] = {'downloaded': True, 'file': f'_System/fit/{ident}.fit', 'error': f'unreadable: {ex}'[:200]}
            errors.append(f'{ident}: FIT unreadable {ex}')
        if signature(entry) != before: entry['importedAt'] = now(); changed.add(ident)
        save(ident, entry)
    update_status(fitQuota=quota)
    return downloads

def fit_scan_summary(entries):
    messages, note_like, long_text = Counter(), set(), set()
    files = 0
    for e in entries:
        fit = e.get('fit') or {}
        if not fit.get('messages'): continue
        files += 1; messages.update(fit['messages']); note_like.update(fit.get('noteLike', [])); long_text.update(fit.get('longText', []))
    return {'files': files, 'messages': dict(messages), 'noteLike': sorted(note_like), 'longText': sorted(long_text)}


# ---------- vault notes ----------

# Raw data stays metric (as COROS sends it); note properties are imperial. distance_km is listed so old notes lose it.
OWNED = ('title', 'type', 'id', 'date', 'sport', 'duration', 'distance_mi', 'distance_yd', 'pace', 'speed_mph',
         'elevation_ft', 'avg_hr', 'load', 'distance_km')
MI, YD, FT = 1.609344, 1.0936133, 3.28084

def mmss(seconds): seconds = round(seconds); return f'{seconds // 60}:{seconds % 60:02d}'

def hms(seconds): return f'{seconds // 3600}:{seconds % 3600 // 60:02d}:{seconds % 60:02d}'

def owned_properties(pub, metrics=None):
    metrics = metrics or {}
    props = {'title': pub['title'], 'type': 'activity', 'id': pub['id'], 'date': pub['date'], 'sport': pub['sport']}
    secs, km, group = pub.get('durationS'), pub.get('distanceKm'), pub.get('group')
    if secs: props['duration'] = hms(secs)
    if km and group == 'swim':
        props['distance_yd'] = round(km * 1000 * YD)
        per_km = metrics.get('paceSPerKm') or (secs / km if secs else None)   # COROS pace excludes rest
        if per_km: props['pace'] = mmss(per_km / 10 / YD) + ' /100yd'
    elif km:
        props['distance_mi'] = round(km / MI, 2)
        per_km = metrics.get('paceSPerKm') or (secs / km if secs else None)
        if per_km and group in ('run', 'walk', 'hike'): props['pace'] = mmss(per_km * MI) + ' /mi'
        kmh = metrics.get('speedKmh') or (km / (secs / 3600) if secs else None)
        if kmh and group == 'ride': props['speed_mph'] = round(kmh / MI, 1)
    if pub.get('elevGainM'): props['elevation_ft'] = round(pub['elevGainM'] * FT)
    if pub.get('avgHr'): props['avg_hr'] = pub['avgHr']
    if pub.get('load') is not None: props['load'] = pub['load']
    return props

def split_note(text):
    """(properties, everything after the closing --- verbatim). The body is never re-wrapped."""
    m = re.match(r'---[ \t]*\r?\n(.*?)\r?\n---[ \t]*(?:\r?\n|$)', text, re.S)
    if not m: return None, text
    meta = yaml.safe_load(m[1]) or {}
    if not isinstance(meta, dict): raise ValueError('Invalid properties')
    return meta, text[m.end():]

def put_note(path, meta, rest):
    text = '---\n' + yaml.safe_dump(meta, sort_keys=False, allow_unicode=True, width=1000).strip() + '\n---\n' + rest
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix='.write-')
    with os.fdopen(fd, 'w', encoding='utf-8') as f: f.write(text)
    os.replace(tmp, path)

def safe_title(title):
    clean = re.sub(r'[\\/:*?"<>|#^\[\]]', '', str(title))
    clean = re.sub(r'\s+', ' ', clean).strip(' .')
    return clean[:80].strip(' .') or 'Activity'

def sync_notes(entries):
    """One note per activity. Renames `<id>.md` notes; keeps every other filename, property and the whole body."""
    folder = vault() / 'Training/Activities'; folder.mkdir(parents=True, exist_ok=True)
    existing = {}
    for path in sorted(folder.glob('*.md')):
        try: meta, _ = split_note(path.read_text(encoding='utf-8'))
        except (ValueError, yaml.YAMLError, UnicodeDecodeError): continue
        if meta and meta.get('id') is not None: existing.setdefault(str(meta['id']), path)
    taken = {p.name.lower() for p in folder.glob('*')}
    changed = set()
    for entry in sorted(entries, key=lambda e: (e['public'].get('start') or 0, e['public']['date'])):
        pub, ident = entry['public'], entry['public']['id']
        want = owned_properties(pub, (entry.get('detail') or {}).get('metrics'))
        path = existing.get(ident)
        if path is None:
            base = f"{pub['date']} {safe_title(pub['title'])}"; name, n = base + '.md', 1
            while name.lower() in taken: n += 1; name = f'{base} {n}.md'
            taken.add(name.lower()); spoken = (entry.get('private') or {}).get('workoutNote')
            if spoken: entry['private']['noteFilled'] = True; save(ident, entry)
            put_note(folder / name, want, '\n' + (spoken.strip() + '\n' if spoken else '')); changed.add(ident); continue
        meta, rest = split_note(path.read_text(encoding='utf-8'))
        if path.stem == ident:   # created by the previous importer: give it a readable name
            base = f"{pub['date']} {safe_title(pub['title'])}"; name, n = base + '.md', 1
            while name.lower() in taken: n += 1; name = f'{base} {n}.md'
            taken.discard(path.name.lower()); taken.add(name.lower())
            path = path.rename(folder / name); changed.add(ident)
        # The COROS post-workout (voice) note fills an empty body once; after that the body is yours.
        spoken = (entry.get('private') or {}).get('workoutNote')
        fill_body = spoken and not rest.strip() and not entry['private'].get('noteFilled')
        if fill_body:
            rest = '\n' + spoken.strip() + '\n'; entry['private']['noteFilled'] = True; save(ident, entry)
        if not fill_body and all(str(meta.get(k)) == str(v) for k, v in want.items()) and not (set(OWNED) - set(want)) & set(meta): continue
        merged = {**want, **{k: v for k, v in meta.items() if k not in OWNED}}
        put_note(path, merged, rest); changed.add(ident)
    return changed


# ---------- wellness ----------

WELLNESS_CALLS = 60     # MCP calls per run for the daily wellness import
SLEEP_CHUNK_DAYS = 120  # querySleepOverview range per call
HRV_CHUNK_DAYS = 28     # querySleepHrv returns a long raw series per night, so keep ranges short
WELLNESS_FIELDS = ('sleepS', 'deepS', 'lightS', 'remS', 'awakeS', 'sleepScore', 'hrv', 'hrvLow', 'hrvHigh', 'restingHr', 'avgHr',
                   'stress', 'steps', 'calories', 'acuteLoad', 'chronicLoad', 'loadRatio', 'recoveryPct')

def wellness_dir(): return vault() / '_System/wellness'

def day_blocks(text):
    """Split COROS text into {YYYY-MM-DD: block}. A block starts at `YYYY-MM-DD` or `--- YYYYMMDD ---`."""
    out, cur = {}, None
    for line in str(text).splitlines():
        m = re.match(r'^(?:(\d{4}-\d{2}-\d{2})|--- (\d{4})(\d{2})(\d{2}) ---)(?::|\s|$)', line)
        if m: cur = m[1] or f'{m[2]}-{m[3]}-{m[4]}'; out[cur] = [line]
        elif cur is not None: out[cur].append(line)
    return {d: '\n'.join(lines).strip() for d, lines in out.items()}

def duration_s(text):
    """'7h 54min' / '11 min' / '2h' -> seconds; None when neither part is present."""
    h, m = re.search(r'(\d+)\s*h', text or ''), re.search(r'(\d+)\s*min', text or '')
    return int(h[1]) * 3600 + int(m[1]) * 60 if h and m else int(h[1]) * 3600 if h else int(m[1]) * 60 if m else None

def wnum(text, label, cast=int):
    m = re.search(re.escape(label) + r'\s*:\s*(-?[\d,]*\.?\d+)', text or '')
    return cast(float(m[1].replace(',', ''))) if m else None

def put_if(fields, key, value, positive=False):
    if value is None or (positive and value <= 0): return
    fields[key] = value

def parse_sleep_overview(text):
    """Sleep Overview: score, main sleep (asleep) and awake time, dated by wake-up day."""
    out = {}
    for d, block in day_blocks(text).items():
        f = {}
        put_if(f, 'sleepScore', wnum(block, 'Sleep Score'), True)
        m = re.search(r'Main Sleep \(asleep\):\s*([^\n]+)', block)
        put_if(f, 'sleepS', duration_s(m[1]) if m else None, True)
        m = re.search(r'Awake Time:\s*([^\n]+)', block)
        if m and f: put_if(f, 'awakeS', duration_s(m[1]), True)
        if f: out[d] = (f, block)
    return out

def parse_sleep_hrv(text):
    """Official nightly HRV assessment only (the raw time series is deliberately dropped)."""
    text = str(text).split('Sleep HRV Time Series')[0]
    out = {}
    for d, block in day_blocks(text).items():
        f = {}
        put_if(f, 'hrv', wnum(block, 'HRV Avg'), True)
        m = re.search(r'Normal Range:\s*(\d+)\s*-\s*(\d+)', block)
        if m: f['hrvLow'], f['hrvHigh'] = int(m[1]), int(m[2])
        if f: out[d] = (f, block)
    return out

def parse_resting_hr(text):
    out = {}
    for d, block in day_blocks(text).items():
        m = re.match(r'[\d-]+:\s*(\d+)\s*bpm', block)
        if m and int(m[1]) > 0: out[d] = ({'restingHr': int(m[1])}, block)
    return out

def parse_avg_hr(text):
    out = {}
    for d, block in day_blocks(text).items():
        m = re.match(r'[\d-]+:\s*(\d+)\s*bpm', block)
        if m and int(m[1]) > 0: out[d] = ({'avgHr': int(m[1])}, block)
    return out

def parse_stress(text):
    out = {}
    for d, block in day_blocks(text).items():
        v = wnum(block, 'Average Stress')
        if v is not None: out[d] = ({'stress': v}, block)
    return out

def parse_daily_health(text):
    """Steps, calories and sleep stages. 0 steps / 0 kcal means the watch recorded nothing, so it is left out."""
    out = {}
    for d, block in day_blocks(text).items():
        f = {}
        put_if(f, 'steps', wnum(block, 'Steps'), True)
        put_if(f, 'calories', wnum(block, 'Calories'), True)
        m = re.search(r'Total:[^\n]*', block)
        if m:
            for key, label in (('deepS', 'Deep'), ('lightS', 'Light'), ('remS', 'REM'), ('awakeS', 'Awake')):
                part = re.search(label + r':\s*((?:\d+\s*h)?\s*(?:\d+\s*min)?)', m[0])
                put_if(f, key, duration_s(part[1]) if part else None, True)
        if f: out[d] = (f, block)
    return out

def parse_training_load(text):
    out = {}
    for d, block in day_blocks(text).items():
        f = {}
        put_if(f, 'acuteLoad', wnum(block, 'Short-Term Load'))
        put_if(f, 'chronicLoad', wnum(block, 'Long-Term Load'))
        put_if(f, 'loadRatio', wnum(block, 'Load Ratio', float))
        if f: out[d] = (f, block)
    return out

def parse_recovery(text):
    pct = wnum(str(text), 'Recovery')
    return pct if pct is not None and 0 <= pct <= 100 else None

def month_chunks(start, end, size):
    while start <= end:
        stop = min(end, start + timedelta(days=size - 1)); yield start, stop; start = stop + timedelta(days=1)

def wellness_pass(start, end, budget, errors=None):
    """Import COROS daily wellness for start..end into _System/wellness/<date>.json.

    A tool that fails is recorded in `errors` and skipped so the others still land. Public fields from earlier
    imports are kept when COROS no longer returns them (recovery is only ever "current"); a file is rewritten
    only when its public part changes. Returns the set of changed dates."""
    errors = [] if errors is None else errors
    today = today_local()
    start, end = max(start, date(2015, 1, 1)), min(end, today)
    if start > end: return set()
    ymd = lambda d: d.strftime('%Y%m%d')
    days = (today - start).days + 1       # COROS `days` queries always end today
    sources = []                           # (name, parsed {date: (fields, raw)})
    def fetch(name, parser, queries):
        merged = {}
        try:
            for args in queries:
                for d, value in parser(budget.call(name, args)).items(): merged[d] = value
        except BudgetSpent: errors.append(f'wellness {name}: call budget spent')
        except Exception as ex: errors.append(f'wellness {name}: {ex}'[:160])
        sources.append((name, merged))
    fetch('querySleepOverview', parse_sleep_overview, [{'startDate': ymd(a), 'endDate': ymd(b)} for a, b in month_chunks(start, end, SLEEP_CHUNK_DAYS)])
    fetch('queryDailyHealthData', parse_daily_health, [{'days': days}])
    fetch('querySleepHrv', parse_sleep_hrv, [{'startDate': ymd(a), 'endDate': ymd(b), 'days': (b - a).days + 1} for a, b in month_chunks(start, end, HRV_CHUNK_DAYS)])
    fetch('queryRestingHeartRate', parse_resting_hr, [{'days': days}])
    fetch('queryAvgHeartRate', parse_avg_hr, [{'startDate': ymd(start), 'endDate': ymd(end)}])
    fetch('queryStressLevel', parse_stress, [{'days': days}])
    fetch('queryTrainingLoadAssessment', parse_training_load, [{'days': days}])
    recovery = None
    if end >= today:
        try: recovery = parse_recovery(budget.call('queryRecoveryStatus', {}))
        except BudgetSpent: errors.append('wellness queryRecoveryStatus: call budget spent')
        except Exception as ex: errors.append(f'wellness queryRecoveryStatus: {ex}'[:160])
        else: sources.append(('queryRecoveryStatus', {today.isoformat(): ({'recoveryPct': recovery} if recovery is not None else {}, f'Recovery: {recovery}%')}))
    days_map = {}
    for name, parsed in sources:
        for d, (fields, raw) in parsed.items():
            if not (start.isoformat() <= d <= end.isoformat()): continue
            day = days_map.setdefault(d, {'public': {}, 'raw': {}})
            for k, v in fields.items():
                if k in WELLNESS_FIELDS: day['public'].setdefault(k, v)   # first source wins (sleep overview before daily health)
            if fields: day['raw'][name] = raw
    changed = set()
    folder = wellness_dir()
    for d, day in sorted(days_map.items()):
        if not day['public']: continue
        path = folder / f'{d}.json'
        old = read_json(path)
        public = {k: v for k, v in {**(old.get('public') or {}), **day['public']}.items() if k in WELLNESS_FIELDS}
        if old and (old.get('public') or {}) == public: continue
        raw = {**((old.get('private') or {}).get('raw') or {}), **day['raw']}
        write_json(path, {'source': 'COROS', 'importedAt': now(), 'public': {k: public[k] for k in WELLNESS_FIELDS if k in public}, 'private': {'raw': raw}}, True)
        changed.add(d)
    return changed

def wellness_status():
    folder = wellness_dir()
    return len(list(folder.glob('*.json'))) if folder.exists() else 0


# ---------- orchestration ----------

def refresh_status(source, changed, **extra):
    entries = all_entries()
    dates = [e['public']['date'] for e in entries]
    update_status(coverageStart=min(dates) if dates else None, coverageEnd=max(dates) if dates else None, lastSync=now(),
                  recordCount=len(entries), source=source, changedLastSync=len(changed),
                  detailBacklog=sum(1 for e in entries if 'metrics' not in (e.get('detail') or {})),
                  fitBacklog=sum(1 for e in entries if not (e.get('fit') or {}).get('downloaded')),
                  fitScan=fit_scan_summary(entries), **extra)

def wellness_step(full, today, errors, extra):
    """Wellness for run(): the last 14 days, or everything since the earliest activity. Never raises."""
    try:
        dates = [e['public']['date'] for e in all_entries()]
        first = date.fromisoformat(min(dates)) if dates else today - timedelta(days=13)
        start = min(first, today) if full else today - timedelta(days=13)
        changed = wellness_pass(start, today, Budget(WELLNESS_CALLS), errors)
        extra.update(wellnessCoverage={'start': start.isoformat(), 'end': today.isoformat()}, wellnessDays=wellness_status())
        # Today's numbers are partial and change every run; they ride along with the next real change.
        return {'wellness:' + d for d in changed if d != today.isoformat()}
    except Exception as ex:
        errors.append(f'wellness: {type(ex).__name__}: {ex}'[:200]); return set()

def run(full=False, query=True, detail=None, fit=None, source='COROS MCP'):
    detail = DETAIL_CALLS if detail is None else detail
    fit = FIT_DAILY_CAP if fit is None else fit
    changed, errors, extra = set(), [], {}
    try:
        today = today_local()
        changed |= migrate_store()
        if not store().exists() or not any(store().glob('*.json')): changed |= import_records(seed_history(), 'COROS historical snapshot')
        if query:
            start = date(2015, 1, 1) if full else today - timedelta(days=30)
            args = {'startDate': start.strftime('%Y%m%d'), 'endDate': today.strftime('%Y%m%d'), 'sportTypeCodes': None, 'minDistanceKm': None, 'maxDistanceKm': None,
                    'minDurationMinutes': None, 'maxDurationMinutes': None, 'maxAveragePace': None, 'locationKeyword': None, 'limit': 10000}
            records = parse_records(text_result(tool('querySportRecords', args)))
            if len(records) >= 10000: raise RuntimeError('COROS hit its result limit; import a smaller date range')
            changed |= import_records(records, source)
        detail_pass(detail, today, changed, errors)
        fit_pass(fit, today, changed, errors)
        changed |= sync_notes(all_entries())
        if query: changed |= wellness_step(full, today, errors, extra)
        refresh_status(source, changed, **extra, lastError=('; '.join(errors[:3]) + (f' (+{len(errors) - 3} more)' if len(errors) > 3 else '')) if errors else None)
    except Exception as ex:
        update_status(lastError=f'{type(ex).__name__}: {ex}'[:300], lastAttempt=now())
        raise
    return len(changed)

def sync(full=False, detail=None, fit=None): return run(full=full, detail=detail, fit=fit)
def backfill(detail=None, fit=None): return run(query=False, detail=detail, fit=fit, source='COROS backfill')

if __name__ == '__main__':
    p = argparse.ArgumentParser(description='COROS activity importer')
    p.add_argument('action', choices=['seed', 'sync', 'full-sync', 'backfill', 'wellness'])
    p.add_argument('--start', type=date.fromisoformat, help='wellness: first day, YYYY-MM-DD (default: 14 days ago)')
    p.add_argument('--end', type=date.fromisoformat, help='wellness: last day, YYYY-MM-DD (default: today)')
    p.add_argument('--detail', type=int, help='MCP calls to spend on detail and laps (2 per activity; default 60)')
    p.add_argument('--fit', type=int, help='FIT downloads this run (daily cap 45)')
    a = p.parse_args()
    if a.action == 'seed':
        store().mkdir(parents=True, exist_ok=True)
        c = import_records(seed_history(), 'COROS historical snapshot'); sync_notes(all_entries()); refresh_status('COROS historical snapshot', c); print(len(c))
    elif a.action == 'backfill': print(backfill(a.detail, a.fit))
    elif a.action == 'wellness':
        errors, budget, today = [], Budget(WELLNESS_CALLS), today_local()
        start, end = a.start or today - timedelta(days=13), a.end or today
        days = wellness_pass(start, end, budget, errors)
        update_status(wellnessCoverage={'start': start.isoformat(), 'end': min(end, today).isoformat()}, wellnessDays=wellness_status())
        print(f'{len(days)} wellness days written, {WELLNESS_CALLS - budget.left} calls' + ''.join('\n' + e for e in errors))
    else: print(sync(a.action == 'full-sync', a.detail, a.fit))
