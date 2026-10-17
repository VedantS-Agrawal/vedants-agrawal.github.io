"""Body weight, kept privately as one file per day: _System/weight/YYYY-MM-DD.json.

Sources, highest priority first, so a better reading replaces a weaker one for the same day:
  renpho  direct cloud read (experimental, see renpho_client)  >  coros  daily snapshot from the COROS profile  >  csv  RENPHO app export

Only the publisher's trend() output ever leaves the vault, and it contains differences from the first day,
never an absolute weight. Body-composition numbers from the scale stay under `private`.
"""
import argparse, base64, csv, hashlib, json, re, statistics, subprocess, time, urllib.error, urllib.request
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo
import common
from common import LOCAL, CONFIG, read_json, write_json, now
import coros_sync

def vault(): return common.vault()

LB_PER_KG = 2.20462
PRIORITY = {'csv': 1, 'coros': 2, 'renpho': 3}
RENPHO_LOGIN = LOCAL / 'renpho.json'
KEYCHAIN_SERVICE = 'renpho-personal-site'
RENPHO_EVERY_S = 6 * 3600
SANE_KG = (20.0, 400.0)
README = """# RENPHO export

To backfill your weight history, export it from the RENPHO app and drop the CSV file in this folder:

1. RENPHO app: Me, then Settings, then Export data.
2. Send the CSV to your computer (AirDrop, Files, or e-mail) and put it here.

The next sync reads every new CSV once. Days that already have a reading from the scale or COROS keep that reading.
Weight is published as a trend only (change since the first day), never as an absolute number.
"""

def today_local(): return datetime.now(ZoneInfo(CONFIG['timezone'])).date()
def store(): return vault() / '_System/weight'
def status_path(): return vault() / '_System/weight-status.json'
def imports_dir(): return vault() / '_System/imports/renpho'
def update_status(**fields):
    s = read_json(status_path()); before = json.dumps(s, sort_keys=True); s.update(fields)
    errors = [s[k] for k in ('corosError', 'renphoError', 'csvError') if s.get(k)]
    s['lastError'] = '; '.join(errors) or None
    if json.dumps(s, sort_keys=True) != before: write_json(status_path(), s, True)

def kg_lb(kg): return round(kg * LB_PER_KG, 1)

def days():
    """[(date, kg)] oldest first."""
    out = []
    for p in sorted(store().glob('*.json')) if store().exists() else []:
        d = read_json(p)
        if isinstance(d.get('kg'), (int, float)): out.append((p.stem, float(d['kg'])))
    return out

def write_day(day, kg, source, private=None):
    """Store one day's weight unless a higher-priority source already holds it. True when a file changed."""
    if not (SANE_KG[0] <= kg <= SANE_KG[1]): return False
    path = store() / f'{day}.json'; old = read_json(path)
    if old and PRIORITY.get(old.get('source'), 0) > PRIORITY[source]: return False
    entry = {'kg': round(kg, 2), 'lb': kg_lb(kg), 'source': source}
    if private: entry['private'] = private
    if old and {k: old.get(k) for k in entry} == entry: return False
    write_json(path, {**entry, 'importedAt': now()}, True)
    return True


# ---------- COROS daily snapshot ----------

def parse_user_weight(text):
    m = re.search(r'Weight:\s*(\d+(?:\.\d+)?)\s*kg', str(text), re.I)
    return float(m[1]) if m else None

def coros_snapshot():
    """At most one COROS call per day. A new day always gets a file; an existing file changes only if the value moved."""
    today = today_local().isoformat()
    if read_json(status_path()).get('corosDay') == today: return 0
    try:
        kg = parse_user_weight(coros_sync.text_result(coros_sync.tool('queryUserInfo', {})))
        if kg is None: raise RuntimeError('No weight in the COROS profile')
        changed = write_day(today, kg, 'coros')
        update_status(corosDay=today, corosError=None)
        return int(changed)
    except Exception as e:
        update_status(corosError=f'coros: {type(e).__name__}: {e}'[:200]); return 0


# ---------- CSV backfill ----------

DATE_FORMATS = ('%Y-%m-%d %H:%M:%S', '%Y-%m-%d %H:%M', '%Y-%m-%d', '%Y/%m/%d %H:%M:%S', '%Y/%m/%d %H:%M', '%Y/%m/%d', '%m/%d/%Y %H:%M:%S',
                '%m/%d/%Y %H:%M', '%m/%d/%Y %I:%M %p', '%m/%d/%Y %I:%M:%S %p', '%m/%d/%Y', '%b %d, %Y %I:%M %p', '%b %d, %Y %H:%M', '%b %d, %Y',
                '%B %d, %Y', '%d.%m.%Y %H:%M:%S', '%d.%m.%Y')

def parse_day(text):
    t = str(text or '').strip().replace('T', ' ').rstrip('Z')
    t = re.sub(r'([+-]\d\d:?\d\d)$', '', t).strip()
    t = re.sub(r'\s+', ' ', t)
    for f in DATE_FORMATS:
        try: return datetime.strptime(t, f).date().isoformat()
        except ValueError: pass
    return None

def parse_csv(text):
    """{date: kg} from a RENPHO-style export: finds the date and weight columns by header, and the unit from the header or a unit column."""
    text = text.lstrip('﻿')
    try: delimiter = csv.Sniffer().sniff(text[:2000], ',;\t').delimiter
    except csv.Error: delimiter = ','
    rows = list(csv.reader(text.splitlines(), delimiter=delimiter))
    if len(rows) < 2: return {}
    head = [h.strip().lower() for h in rows[0]]
    wcol = next((i for i, h in enumerate(head) if 'weight' in h and not re.search(r'goal|target|fat.?free|lean|muscle|bone', h)), None)
    if wcol is None: return {}
    dcols = [i for i, h in enumerate(head) if re.search(r'date|time|day', h)]
    if not dcols: return {}
    ucol = next((i for i, h in enumerate(head) if h in ('unit', 'units', 'weight unit', 'weight_unit')), None)
    header_unit = 'lb' if re.search(r'\blbs?\b|pound', head[wcol]) else 'kg' if re.search(r'\bkgs?\b|kilo', head[wcol]) else None
    per_day = {}
    for r in rows[1:]:
        if len(r) <= wcol: continue
        day = next((parse_day(r[i]) for i in dcols if i < len(r) and parse_day(r[i])), None)
        if not day:
            joined = ' '.join(r[i] for i in dcols if i < len(r))     # separate date and time columns
            day = next((parse_day(p) for p in re.findall(r'\d{4}[-/]\d{2}[-/]\d{2}|\d{1,2}/\d{1,2}/\d{4}', joined)), None)
        m = re.search(r'\d+(?:[.,]\d+)?', r[wcol])
        if not day or not m: continue
        v = float(m[0].replace(',', '.'))
        unit = header_unit or (('lb' if re.search(r'lb|pound', r[ucol].lower()) else 'kg') if ucol is not None and ucol < len(r) else None) \
            or ('lb' if re.search(r'lb|pound', r[wcol].lower()) else 'kg')
        per_day.setdefault(day, []).append(v / LB_PER_KG if unit == 'lb' else v)
    return {d: round(statistics.mean(v), 2) for d, v in per_day.items()}

def csv_import():
    folder = imports_dir(); folder.mkdir(parents=True, exist_ok=True)
    if not (folder / 'README.md').exists(): (folder / 'README.md').write_text(README, encoding='utf-8')
    done = list(read_json(status_path()).get('csvHashes') or [])
    changed, errors = 0, []
    for path in sorted(folder.glob('*.csv')):
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest in done: continue
        try:
            values = parse_csv(path.read_text(encoding='utf-8-sig'))
            if not values: raise ValueError('no date and weight columns found')
            changed += sum(write_day(d, kg, 'csv') for d, kg in values.items())
            done.append(digest)
        except Exception as e:
            errors.append(f'{path.name}: {e}')
    update_status(csvHashes=done, csvError=('csv: ' + '; '.join(errors))[:200] if errors else None)
    return changed


# ---------- RENPHO cloud (experimental) ----------
# Reverse-engineered protocol of the RENPHO Health app, as documented by the open-source clients
# forkerer/RenphoGarminSync-CLI and jegork/renpho-mcp: POST {encryptData: base64(AES-128-ECB(json))}
# to cloud.renpho.com, answer {code: 101, data: base64(AES(json))}. The key is a constant of the app, not an account secret.

RENPHO_BASE = 'https://cloud.renpho.com'
PROTOCOL_KEY = b'ed*wijdi$h6fe3ew'

def _openssl(args, data, key):
    r = subprocess.run(['/usr/bin/openssl', 'enc', '-aes-128-ecb', '-K', key.hex(), '-nosalt', *args], input=data, capture_output=True, timeout=20)
    if r.returncode: raise ValueError('AES operation failed')
    return r.stdout

def aes_encrypt(text, key=PROTOCOL_KEY):
    return _openssl(['-base64', '-A'], text.encode(), key).decode()

def aes_decrypt(b64, key=PROTOCOL_KEY):
    return _openssl(['-d', '-base64', '-A'], str(b64).encode(), key).decode()

def keychain_password(email):
    r = subprocess.run(['/usr/bin/security', 'find-generic-password', '-a', email, '-s', KEYCHAIN_SERVICE, '-w'], capture_output=True, text=True, timeout=20)
    return r.stdout.rstrip('\n') if r.returncode == 0 and r.stdout.strip() else None

def renpho_credentials():
    login = read_json(RENPHO_LOGIN)
    email = str(login.get('email') or '').strip()
    if not email: return None
    password = keychain_password(email)
    return {'email': email, 'password': password, 'areaCode': str(login.get('areaCode') or 'US')} if password else None

def renpho_post(path, body, session=None, opener=urllib.request.urlopen):
    headers = {'Content-Type': 'application/json', 'User-Agent': 'personal-site-sync/1.0'}
    if session: headers.update(token=session['token'], userId=str(session['userId']), appVersion='7.0.0', platform='android')
    payload = json.dumps({'encryptData': aes_encrypt('' if body is None else json.dumps(body))}).encode()
    try:
        with opener(urllib.request.Request(f'{RENPHO_BASE}/{path}', data=payload, headers=headers, method='POST'), timeout=30) as response:
            envelope = json.loads(response.read().decode())
    except urllib.error.HTTPError as e: raise RuntimeError(f'RENPHO answered HTTP {e.code}') from None
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError): raise RuntimeError('RENPHO request failed') from None
    if envelope.get('code') != 101: raise RuntimeError(f'RENPHO rejected the request (code {envelope.get("code")})')
    if not envelope.get('data'): raise RuntimeError('RENPHO returned no data')
    try: return json.loads(aes_decrypt(envelope['data']))
    except (ValueError, json.JSONDecodeError): raise RuntimeError('RENPHO returned data that could not be decrypted') from None

def renpho_login(creds, post=renpho_post):
    data = post('renpho-aggregation/user/login', {'questionnaire': {}, 'login': {**creds, 'appRevision': '7.0.0', 'cellphoneType': 'PersonalSite', 'systemType': '11', 'platform': 'android'},
                                                    'bindingList': {'deviceTypes': ['2']}})
    login = data.get('login') if isinstance(data, dict) else None
    if not isinstance(login, dict) or not login.get('token') or login.get('id') is None: raise RuntimeError('RENPHO login response changed shape')
    return {'token': login['token'], 'userId': str(login['id'])}

def renpho_rows(session, post=renpho_post, max_pages=50):
    devices = post('renpho-aggregation/device/count', None, session)
    rows = {}
    for table in (devices.get('scale') or []) if isinstance(devices, dict) else []:
        if not table.get('tableName') or not table.get('userIds'): continue
        for page in range(1, max_pages + 1):
            chunk = post('RenphoHealth/scale/queryAllMeasureDataList', {'pageNum': page, 'pageSize': 200, 'tableName': table['tableName'], 'userIds': table['userIds']}, session)
            if not isinstance(chunk, list): raise RuntimeError('RENPHO measurement response changed shape')
            for row in chunk:
                if str(row.get('bUserId')) == session['userId'] and row.get('id') is not None and row.get('timeStamp'): rows[str(row['id'])] = row
            if len(chunk) < 200: break
    return list(rows.values())

BODY_FIELDS = ('bodyfat', 'water', 'muscle', 'bone', 'bmi', 'bmr', 'visfat', 'protein', 'bodyage', 'subfat', 'sinew', 'fatFreeWeight', 'heartRate')

def row_kg(row):
    w = row.get('weight')
    if not isinstance(w, (int, float)) or w <= 0: return None
    unit = row.get('weightUnit')
    kg = w / LB_PER_KG if unit == 2 else w / 0.15747 if unit in (3, 4) else w
    return kg if SANE_KG[0] <= kg <= SANE_KG[1] else None

def renpho_days(rows):
    """{date: (kg, private)}: the day's mean weight, and every reading with its body-composition values (private only)."""
    per_day = {}
    for row in rows:
        kg = row_kg(row)
        if kg is None: continue
        ts = int(row['timeStamp'])
        d = datetime.fromtimestamp(ts, ZoneInfo(CONFIG['timezone'])).date().isoformat()
        reading = {'ts': ts, 'kg': round(kg, 2), **{k: row[k] for k in BODY_FIELDS if isinstance(row.get(k), (int, float))}}
        per_day.setdefault(d, []).append(reading)
    return {d: (statistics.mean(r['kg'] for r in rs), {'readings': sorted(rs, key=lambda r: r['ts'])}) for d, rs in per_day.items()}

def renpho_sync(post=renpho_post):
    """Experimental. Any problem is recorded in the status file and the other sources carry on."""
    status = read_json(status_path())
    if time.time() - float(status.get('renphoAttempt') or 0) < RENPHO_EVERY_S: return 0
    creds = renpho_credentials()
    if not creds:
        update_status(renpho='renpho: not connected'); return 0
    update_status(renphoAttempt=time.time())
    try:
        found = renpho_days(renpho_rows(renpho_login(creds, post), post))
        changed = sum(write_day(d, kg, 'renpho', priv) for d, (kg, priv) in found.items())
        update_status(renpho='renpho: connected', renphoError=None, renphoLastSync=now(), renphoDays=len(found))
        return changed
    except Exception as e:
        update_status(renphoError=f'renpho (experimental): {type(e).__name__}: {e}'[:200]); return 0


# ---------- public trend ----------

def trend(series, span=7):
    """[(date, kg)] -> {start, points: [{date, deltaLb}]}. Exponential smoothing over `span` days; deltas against the first day's smoothed value."""
    series = sorted(series)
    if not series: return {'start': None, 'points': []}
    alpha = 2 / (span + 1)
    smooth, prev, first, points = None, None, None, []
    for d, kg in series:
        gap = max(1, (date.fromisoformat(d) - date.fromisoformat(prev)).days) if prev else 1
        smooth = kg if smooth is None else smooth + (1 - (1 - alpha) ** gap) * (kg - smooth)
        first = smooth if first is None else first
        points.append({'date': d, 'deltaLb': round((smooth - first) * LB_PER_KG, 1) + 0.0})
        prev = d
    return {'start': series[0][0], 'points': points}


def sync():
    """Snapshot, scale and CSV in turn; returns the number of day files written or changed."""
    return coros_snapshot() + renpho_sync() + csv_import()

if __name__ == '__main__':
    p = argparse.ArgumentParser(description='Body weight sync')
    p.add_argument('action', choices=['sync', 'snapshot', 'csv', 'renpho'])
    a = p.parse_args()
    print({'sync': sync, 'snapshot': coros_snapshot, 'csv': csv_import, 'renpho': renpho_sync}[a.action]())
    s = read_json(status_path()); print(s.get('lastError') or 'ok')
