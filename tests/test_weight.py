import base64, json, tempfile, unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import common, coros_sync, weight as w, publisher
from zoneinfo import ZoneInfo

TZ = ZoneInfo('America/Chicago')
def ts(day, hour=7): y, m, d = map(int, day.split('-')); return int(datetime(y, m, d, hour, tzinfo=TZ).timestamp())
def mcp_text(t): return {'content': [{'type': 'text', 'text': t}]}
USER_INFO = 'User Info\n====\nName: Test\nHeight: 180 cm\nWeight: {kg} kg\nAge: 30\n'


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name); self.vault = self.root / 'vault'; (self.vault / '_System').mkdir(parents=True)
        self.local = self.root / '.local'; self.local.mkdir()
        for p in (patch.object(common, 'vault', lambda: self.vault), patch.object(coros_sync, 'vault', lambda: self.vault),
                  patch.object(w, 'RENPHO_LOGIN', self.local / 'renpho.json')):
            p.start(); self.addCleanup(p.stop)
    def day(self, d): return common.read_json(self.vault / '_System/weight' / f'{d}.json')
    def status(self): return common.read_json(self.vault / '_System/weight-status.json')


class WeightTests(Base):
    def test_parse_user_weight(self):
        self.assertEqual(w.parse_user_weight(USER_INFO.format(kg='80.1')), 80.1)
        self.assertIsNone(w.parse_user_weight('nothing here'))

    def test_coros_snapshot_once_a_day_and_only_when_changed(self):
        calls = []
        def fake(name, args): calls.append(name); return mcp_text(USER_INFO.format(kg='80.1'))
        with patch.object(coros_sync, 'tool', fake):
            self.assertEqual(w.coros_snapshot(), 1)
            self.assertEqual(w.coros_snapshot(), 0)          # same day: no second call
        self.assertEqual(calls, ['queryUserInfo'])
        today = w.today_local().isoformat()
        self.assertEqual(self.day(today)['kg'], 80.1); self.assertEqual(self.day(today)['lb'], 176.6); self.assertEqual(self.day(today)['source'], 'coros')
        # a later run the same day (status reset) with a new value updates the file; an identical value does not
        w.update_status(corosDay=None)
        with patch.object(coros_sync, 'tool', lambda n, a: mcp_text(USER_INFO.format(kg='80.1'))): self.assertEqual(w.coros_snapshot(), 0)
        w.update_status(corosDay=None)
        with patch.object(coros_sync, 'tool', lambda n, a: mcp_text(USER_INFO.format(kg='79.8'))): self.assertEqual(w.coros_snapshot(), 1)
        self.assertEqual(self.day(today)['kg'], 79.8)

    def test_coros_failure_is_recorded_not_raised(self):
        def boom(n, a): raise RuntimeError('COROS session expired')
        with patch.object(coros_sync, 'tool', boom): self.assertEqual(w.coros_snapshot(), 0)
        self.assertIn('COROS session expired', self.status()['lastError'])

    def test_priority_renpho_over_coros_over_csv(self):
        self.assertTrue(w.write_day('2026-10-01', 80, 'csv'))
        self.assertTrue(w.write_day('2026-10-01', 81, 'coros'))
        self.assertFalse(w.write_day('2026-10-01', 79, 'csv'))
        self.assertEqual(self.day('2026-10-01')['kg'], 81)
        self.assertTrue(w.write_day('2026-10-01', 80.5, 'renpho', {'readings': []}))
        self.assertFalse(w.write_day('2026-10-01', 90, 'coros'))
        self.assertEqual((self.day('2026-10-01')['kg'], self.day('2026-10-01')['source']), (80.5, 'renpho'))
        self.assertFalse(w.write_day('2026-10-02', 5, 'coros'))        # implausible values are ignored

    # ----- CSV -----
    def test_parse_csv_kg_and_lb_headers(self):
        kg = 'Time of Measurement,Weight(kg),BMI,Body Fat(%)\n2026-10-01 07:10:00,80.0,24,18\n2026-10-01 20:00:00,81.0,24,18\n2026-10-02 07:00:00,79.5,24,18\n'
        self.assertEqual(w.parse_csv(kg), {'2026-10-01': 80.5, '2026-10-02': 79.5})
        lb = 'Date,Time,Weight (lb)\n"Oct 1, 2026",07:10,176.4\n10/02/2026,07:10,175.0\n'
        got = w.parse_csv(lb)
        self.assertAlmostEqual(got['2026-10-01'], 176.4 / 2.20462, places=2); self.assertAlmostEqual(got['2026-10-02'], 175 / 2.20462, places=2)
        unit = 'date;weight;unit\n2026/10/01;176,4;lbs\n'
        self.assertAlmostEqual(w.parse_csv(unit)['2026-10-01'], 176.4 / 2.20462, places=2)
        self.assertEqual(w.parse_csv('foo,bar\n1,2\n'), {})

    def test_csv_import_hashes_and_never_overwrites_better_sources(self):
        w.write_day('2026-10-02', 78, 'coros')
        folder = w.imports_dir(); folder.mkdir(parents=True)
        (folder / 'export.csv').write_text('Date,Weight(kg)\n2026-10-01,80\n2026-10-02,99\n')
        self.assertEqual(w.csv_import(), 1)
        self.assertEqual((self.day('2026-10-01')['kg'], self.day('2026-10-01')['source']), (80, 'csv'))
        self.assertEqual(self.day('2026-10-02')['kg'], 78)
        self.assertTrue((folder / 'README.md').exists()); self.assertIn('Export data', (folder / 'README.md').read_text())
        self.assertEqual(len(self.status()['csvHashes']), 1)
        (self.vault / '_System/weight/2026-10-01.json').unlink()
        self.assertEqual(w.csv_import(), 0)                         # same file is not read again
        (folder / 'bad.csv').write_text('x,y\n1,2\n')
        w.csv_import(); self.assertIn('bad.csv', self.status()['lastError'])

    # ----- trend -----
    def test_trend_is_relative_and_smoothed(self):
        t = w.trend([('2026-10-01', 80.0), ('2026-10-02', 80.0), ('2026-10-03', 78.0)])
        self.assertEqual(t['start'], '2026-10-01'); self.assertEqual(t['points'][0], {'date': '2026-10-01', 'deltaLb': 0.0})
        # alpha = 0.25: smoothed = 80 - 0.25 * 2 = 79.5 -> -0.5 kg = -1.1 lb
        self.assertEqual(t['points'][2]['deltaLb'], -1.1)
        gap = w.trend([('2026-10-01', 80.0), ('2026-10-11', 70.0)])['points'][1]['deltaLb']
        self.assertLess(gap, -15)                                     # a long gap moves the average further
        self.assertEqual(w.trend([]), {'start': None, 'points': []})


class RenphoTests(Base):
    def test_aes_known_answer_and_round_trip(self):
        key = bytes.fromhex('2b7e151628aed2a6abf7158809cf4f3c')       # NIST SP 800-38A ECB vector
        block = bytes.fromhex('6bc1bee22e409f96e93d7e117393172a')
        # the first ciphertext block of the NIST vector, via bytes input
        raw = w._openssl(['-base64', '-A'], block, key)
        self.assertEqual(base64.b64decode(raw)[:16].hex(), '3ad77bb40d7a3660a89ecaf32466ef97')
        text = json.dumps({'login': {'email': 'a@b.c'}, 'n': 1})
        enc = w.aes_encrypt(text)
        self.assertNotIn('login', enc); self.assertEqual(len(base64.b64decode(enc)) % 16, 0)
        self.assertEqual(w.aes_decrypt(enc), text)
        self.assertEqual(w.aes_decrypt(w.aes_encrypt('')), '')
        with self.assertRaises(ValueError): w.aes_decrypt('bm90IGFlcw==')

    def test_post_envelope(self):
        sent = {}
        class Resp:
            def __init__(self, body): self.body = body
            def read(self): return self.body
            def __enter__(self): return self
            def __exit__(self, *a): return False
        def opener(req, timeout=0):
            sent['url'], sent['headers'] = req.full_url, dict(req.header_items())
            sent['plain'] = w.aes_decrypt(json.loads(req.data)['encryptData'])
            return Resp(json.dumps({'code': 101, 'data': w.aes_encrypt(json.dumps({'ok': 1}))}).encode())
        self.assertEqual(w.renpho_post('x/y', {'a': 1}, {'token': 'T', 'userId': '9'}, opener), {'ok': 1})
        self.assertEqual(sent['url'], 'https://cloud.renpho.com/x/y'); self.assertEqual(json.loads(sent['plain']), {'a': 1})
        self.assertEqual((sent['headers']['Token'], sent['headers']['Userid'], sent['headers']['Appversion']), ('T', '9', '7.0.0'))
        bad = lambda req, timeout=0: Resp(json.dumps({'code': 400, 'data': None}).encode())
        with self.assertRaises(RuntimeError): w.renpho_post('x', None, None, bad)

    def fake_post(self, rows, log=None):
        def post(path, body, session=None):
            if log is not None: log.append(path)
            if path.endswith('user/login'):
                assert body['login']['email'] == 'me@example.com' and body['login']['password'] == 'pw'
                return {'login': {'token': 'TOK', 'id': 555, 'email': 'me@example.com'}}
            if path.endswith('device/count'): return {'scale': [{'tableName': 't1', 'count': len(rows), 'userIds': ['555']}]}
            if path.endswith('queryAllMeasureDataList'): return rows
            raise AssertionError(path)
        return post

    def connect(self):
        (self.local / 'renpho.json').write_text(json.dumps({'email': 'me@example.com'}))
        p = patch.object(w, 'keychain_password', lambda email: 'pw' if email == 'me@example.com' else None); p.start(); self.addCleanup(p.stop)

    def rows(self):
        return [{'id': 1, 'timeStamp': ts('2026-10-01'), 'bUserId': 555, 'weight': 80.0, 'weightUnit': 1, 'bodyfat': 18.2, 'muscle': 40.1, 'water': 55.0},
                {'id': 2, 'timeStamp': ts('2026-10-01', 20), 'bUserId': 555, 'weight': 81.0, 'weightUnit': 1},
                {'id': 3, 'timeStamp': ts('2026-10-02'), 'bUserId': 555, 'weight': 176.4, 'weightUnit': 2},
                {'id': 4, 'timeStamp': ts('2026-10-02'), 'bUserId': 999, 'weight': 50.0, 'weightUnit': 1},      # another family member
                {'id': 5, 'timeStamp': ts('2026-10-03'), 'bUserId': 555, 'weight': 0, 'weightUnit': 1}]

    def test_not_connected_skips_quietly(self):
        log = []
        self.assertEqual(w.renpho_sync(self.fake_post([], log)), 0)
        self.assertEqual(log, []); self.assertEqual(self.status()['renpho'], 'renpho: not connected'); self.assertIsNone(self.status()['lastError'])

    def test_sync_parses_units_filters_user_and_keeps_body_composition_private(self):
        self.connect(); w.write_day('2026-10-01', 70, 'coros'); w.write_day('2026-10-02', 70, 'csv'); w.write_day('2026-09-30', 75, 'coros')
        self.assertEqual(w.renpho_sync(self.fake_post(self.rows())), 2)
        d1, d2 = self.day('2026-10-01'), self.day('2026-10-02')
        self.assertEqual((d1['source'], d1['kg']), ('renpho', 80.5))
        self.assertEqual(d1['private']['readings'][0]['bodyfat'], 18.2)
        self.assertAlmostEqual(d2['kg'], 80.0, places=1)
        self.assertEqual(self.day('2026-09-30')['source'], 'coros')                     # untouched
        self.assertFalse((self.vault / '_System/weight/2026-10-03.json').exists())
        self.assertEqual(self.status()['renpho'], 'renpho: connected'); self.assertIsNone(self.status()['lastError'])
        self.assertNotIn('pw', json.dumps(self.status()))

    def test_throttled_between_attempts(self):
        self.connect(); log = []
        w.renpho_sync(self.fake_post(self.rows(), log)); n = len(log)
        self.assertEqual(w.renpho_sync(self.fake_post(self.rows(), log)), 0)
        self.assertEqual(len(log), n)

    def test_failures_set_last_error_and_fall_back_to_coros(self):
        self.connect()
        def broken(path, body, session=None): raise RuntimeError('RENPHO returned data that could not be decrypted')
        self.assertEqual(w.renpho_sync(broken), 0)
        self.assertIn('experimental', self.status()['renphoError']); self.assertIn('decrypted', self.status()['lastError'])
        # a schema change is a failure too
        self.local.joinpath('x').touch(); w.update_status(renphoAttempt=0)
        shaky = lambda path, body, session=None: {'unexpected': 1} if path.endswith('login') else {}
        self.assertEqual(w.renpho_sync(shaky), 0); self.assertIn('changed shape', self.status()['lastError'])
        # the COROS snapshot still works and the sync as a whole never raises
        with patch.object(coros_sync, 'tool', lambda n, a: mcp_text(USER_INFO.format(kg='80.1'))), patch.object(w, 'renpho_post', broken):
            w.update_status(renphoAttempt=0)
            self.assertEqual(w.sync(), 1)
        self.assertEqual(self.day(w.today_local().isoformat())['source'], 'coros')

    def test_password_never_in_files(self):
        self.connect(); w.renpho_sync(self.fake_post(self.rows()))
        for p in self.vault.rglob('*.json'): self.assertNotIn('"pw"', p.read_text())
        self.assertEqual(json.loads((self.local / 'renpho.json').read_text()), {'email': 'me@example.com'})


class WeightPrivacyTests(Base):
    def test_published_data_has_no_absolute_weight(self):
        for p in (patch.object(publisher, 'vault', lambda: self.vault), patch.object(publisher, 'ROOT', self.root),
                  patch.object(publisher, 'LOCAL', self.local), patch.object(publisher, 'REPORT', self.local / 'last-build.json')):
            p.start(); self.addCleanup(p.stop)
        common.write_json(self.vault / '_System/publishing.json', {'notes': {}, 'lastPublished': None})
        values = [('2026-10-01', 81.37), ('2026-10-02', 81.12), ('2026-10-03', 80.84), ('2026-10-05', 80.45)]
        for d, kg in values: w.write_day(d, kg, 'renpho', {'readings': [{'ts': 1, 'kg': kg, 'bodyfat': 19.7}]})
        common.write_note(self.vault / 'Writing/Essay.md', {'title': 'Essay', 'type': 'writing', 'visibility': 'public'}, 'words')
        publisher.export()
        out = json.loads((self.root / 'content/data/weight.json').read_text())
        self.assertEqual(set(out), {'start', 'points'}); self.assertEqual(out['start'], '2026-10-01'); self.assertEqual(out['points'][0]['deltaLb'], 0)
        self.assertEqual(set(out['points'][1]), {'date', 'deltaLb'}); self.assertLess(out['points'][-1]['deltaLb'], 0)
        blob = '\n'.join(p.read_text(errors='ignore') for p in (self.root / 'content').rglob('*') if p.is_file())
        for d, kg in values:
            for needle in (str(kg), str(round(kg * 2.20462, 1)), str(round(kg * 2.20462, 2)), '19.7', 'bodyfat'):
                self.assertNotIn(needle, blob)
        for p in (self.root / 'content/data').glob('*.json'):
            self.assertNotIn('weight', p.read_text().replace('weight.json', '') if p.name != 'weight.json' else '')


if __name__ == '__main__':
    unittest.main()
