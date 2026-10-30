import json, re, shutil, subprocess, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
import sys
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import common, coros_sync as c, publisher


def chunk(n, date, sport, st, location, start=1791764137, secs=900, hr=62):
    return (f"{n}. {sport} — {date}\n   Location: {location}\n"
            f"   Time Window: startTimestamp={start} | endTimestamp={start + secs}\n"
            f"   Duration: {secs // 60}:{secs % 60:02d} | Distance: 0 m\n   Avg HR: {hr} bpm | Calories: 20 kcal\n"
            f"   LabelId: 5550000000{n:04d} | SportType: {st}\n\n")


def ident(n): return f'5550000000{n:04d}'


class ClassificationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.vault = Path(self.tmp.name) / 'vault'; (self.vault / '_System').mkdir(parents=True)
        for p in (patch.object(c, 'vault', lambda: self.vault), patch.object(common, 'vault', lambda: self.vault)):
            p.start(); self.addCleanup(p.stop)

    def test_labels_decide_whatever_the_sport_type(self):
        g = c.sport_group
        self.assertEqual(g(9900, 'Meditation'), 'mindfulness')
        self.assertEqual(g(904, 'Yoga', 'Morning breathwork'), 'mindfulness')
        self.assertEqual(g(100, 'Outdoor Run', 'Mindful run'), 'mindfulness')
        self.assertEqual(g(9999, 'Custom', 'Box BREATHING'), 'mindfulness')
        self.assertEqual(g(None, 'Meditate'), 'mindfulness')
        self.assertEqual(g(904, 'Yoga', 'Yoga'), 'other')            # plain yoga is not mindfulness
        self.assertEqual(g(100, 'Outdoor Run', 'Galveston Run'), 'run')
        self.assertEqual(g(100), 'run')                              # callers that pass only a type still work

    def test_import_and_reclassification_are_idempotent(self):
        text = 'Sport Records\n\n' + chunk(1, '2026-10-20', 'Meditation', 9900, 'Meditation') + chunk(2, '2026-10-21', 'Yoga', 904, 'Yoga')
        c.import_records(c.parse_records(text), 'test')
        self.assertEqual([c.load(ident(n))['public']['group'] for n in (1, 2)], ['mindfulness', 'other'])
        # an entry stored by an earlier importer (classified by sport type only) is corrected on the next sync, once
        old = c.load(ident(1)); old['public']['group'] = 'other'; c.save(ident(1), old)
        self.assertEqual(c.migrate_store(), {ident(1)})
        self.assertEqual(c.load(ident(1))['public']['group'], 'mindfulness')
        self.assertEqual(c.migrate_store(), set())

    def test_health_check_parser_skips_gracefully(self):
        self.assertEqual(c.parse_health_checks('No complete health check time series data'), [])
        self.assertEqual(c.parse_health_checks('nothing useful here'), [])
        got = c.parse_health_checks("1. Wellness check — 2026-10-20\n   startTimestamp=1791763800\n   Heart Rate: 66 bpm | HRV: 58 ms | Stress: 31 | Respiration: 13.5\n"
                                    "2. Wellness check — 2026-10-20\n   startTimestamp=1791765100\n   Heart Rate: 61 bpm | HRV: 64 ms | Stress: 24\n")
        self.assertEqual(got, [{'at': 1791763800, 'hr': 66, 'hrv': 58, 'stress': 31, 'respiration': 13.5}, {'at': 1791765100, 'hr': 61, 'hrv': 64, 'stress': 24}])

    def test_health_check_pass_queries_each_session_once(self):
        c.import_records(c.parse_records('Sport Records\n\n' + chunk(1, '2026-10-20', 'Meditation', 9900, 'Meditation')), 'test')
        calls = []
        def fake(name, args):
            calls.append((name, args)); return {'content': [{'type': 'text', 'text': 'No complete health check time series data'}]}
        with patch.object(c, 'tool', fake):
            c.health_check_pass(c.today_local(), set(), [])
            c.health_check_pass(c.today_local(), set(), [])
        self.assertEqual(calls, [('queryHealthCheckTimeSeries', {'startDate': '20261020', 'endDate': '20261020', 'days': 1})])
        self.assertEqual(c.load(ident(1))['private']['healthCheck']['checks'], [])


class PublishingTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name); self.vault = self.root / 'vault'; self.vault.mkdir()
        self.local = self.root / '.local'; self.local.mkdir()
        (self.vault / '_System').mkdir()
        common.write_json(self.vault / '_System/publishing.json', {'notes': {}, 'lastPublished': None})
        for p in [patch.object(common, 'vault', lambda: self.vault), patch.object(publisher, 'vault', lambda: self.vault),
                  patch.object(publisher, 'ROOT', self.root), patch.object(publisher, 'LOCAL', self.local),
                  patch.object(publisher, 'REPORT', self.local / 'last-build.json')]:
            p.start(); self.addCleanup(p.stop)

    def activity(self, ident, date, group, sport, title, start=None, secs=900, series=None, checks=None):
        common.write_note(self.vault / f'Training/Activities/{date} {title}.md', {'title': title, 'type': 'activity', 'id': ident, 'date': date}, '')
        pub = {'id': ident, 'date': date, 'sport': sport, 'group': group, 'durationS': secs, 'avgHr': 60, 'title': title}
        if start: pub['start'] = start
        private = {'healthCheck': {'queried': 'x', 'checks': checks}} if checks is not None else {}
        entry = {'public': pub, 'detail': {'metrics': {}, 'laps': []}, 'private': private}
        if series: entry['series'] = series
        common.write_json(self.vault / f'_System/activities/{ident}.json', entry)

    def build(self):
        publisher.export()
        data = lambda name: json.loads((self.root / 'content/data' / name).read_text())
        return data

    def test_mindfulness_stays_out_of_training_but_keeps_its_page(self):
        self.activity('111', '2026-10-20', 'run', 'Outdoor Run', 'Easy Run', secs=1800)
        self.activity('222', '2026-10-20', 'mindfulness', 'Meditation', 'Meditation', start=1000, secs=600, series={'t': [0, 5, 10], 'hr': [64, 0, 58]})
        self.activity('333', '2026-10-21', 'mindfulness', 'Meditation', 'Evening sit', start=2000, secs=1230)
        data = self.build()
        ids = [a['id'] for a in data('training.json')['activities']]
        self.assertEqual(ids, ['111'])
        entries = json.loads((self.root / 'content/site-data.json').read_text())['entries']
        m = [e for e in entries if e['type'] == 'activity' and e['activity']['group'] == 'mindfulness']
        self.assertEqual(len(m), 2)                                  # still linkable
        self.assertTrue((self.root / 'content/data/activities/222.json').exists())
        self.assertTrue(all(e['url'].startswith('/stream/training/') for e in m))

    def test_mindfulness_json_shape(self):
        self.activity('222', '2026-10-20', 'mindfulness', 'Meditation', 'Meditation', start=1000, secs=600, series={'t': [0, 5, 10], 'hr': [64, 0, 58]})
        self.activity('223', '2026-10-20', 'mindfulness', 'Meditation', 'Second sit', start=3000, secs=1260)
        self.activity('333', '2026-10-22', 'mindfulness', 'Meditation', 'Evening sit', start=2000, secs=20)
        j = self.build()('mindfulness.json')
        self.assertEqual(set(j), {'sessions', 'days'})
        self.assertEqual([s['date'] for s in j['sessions']], ['2026-10-20', '2026-10-20', '2026-10-22'])
        first = j['sessions'][0]
        self.assertEqual({k: first[k] for k in ('date', 'start', 'durationS', 'avgHr', 'minHr', 'title')},
                         {'date': '2026-10-20', 'start': 1000, 'durationS': 600, 'avgHr': 60, 'minHr': 58, 'title': 'Meditation'})
        self.assertTrue(first['url'].startswith('/stream/training/'))
        self.assertNotIn('minHr', j['sessions'][1])                  # no samples, no minimum
        self.assertEqual(j['days'], {'2026-10-20': 31, '2026-10-22': 1})   # 600 s + 1260 s; a 20 s session still counts as a minute

    def test_sleep_and_recovery_hub_links(self):
        common.write_note(self.vault / 'Writing/A.md', {'title': 'A', 'type': 'writing', 'visibility': 'public'}, 'About [[Sleep]] and [[Recovery|recovery]].')
        publisher.export()
        body = (self.root / 'content/notes/a.md').read_text()
        self.assertIn('[Sleep](/stream/sleep/)', body); self.assertIn('[recovery](/stream/sleep/)', body)

    def test_no_sessions_no_file(self):
        self.activity('111', '2026-10-20', 'run', 'Outdoor Run', 'Easy Run')
        self.build()
        self.assertFalse((self.root / 'content/data/mindfulness.json').exists())

    def test_before_and_after_need_a_check_on_both_sides(self):
        both = [{'at': 1000 - 600, 'hr': 66, 'hrv': 58, 'stress': 31}, {'at': 1000 + 600 + 300, 'hr': 61, 'hrv': 64, 'stress': 24, 'respiration': 12.5}]
        self.activity('222', '2026-10-20', 'mindfulness', 'Meditation', 'With checks', start=1000, secs=600, checks=both)
        self.activity('223', '2026-10-21', 'mindfulness', 'Meditation', 'Only before', start=5000, secs=600, checks=[{'at': 4800, 'hr': 70}])
        self.activity('224', '2026-10-22', 'mindfulness', 'Meditation', 'Too early', start=9000, secs=600, checks=[{'at': 9000 - 4000, 'hr': 70}, {'at': 9700, 'hr': 60}])
        s = {x['title']: x for x in self.build()('mindfulness.json')['sessions']}
        self.assertEqual(s['With checks']['before'], {'hr': 66, 'hrv': 58, 'stress': 31})
        self.assertEqual(s['With checks']['after'], {'hr': 61, 'hrv': 64, 'stress': 24, 'respiration': 12.5})
        for t in ('Only before', 'Too early'): self.assertNotIn('before', s[t])
        blob = ''.join(p.read_text() for p in (self.root / 'content').rglob('*') if p.is_file())
        self.assertNotIn('"at"', blob)                               # raw check times stay private


@unittest.skipUnless(shutil.which('node') or Path('/opt/homebrew/bin/node').exists(), 'node is not installed')
class StreakTests(unittest.TestCase):
    def streaks(self, days, today):
        src = (ROOT / 'web/app.js').read_text()
        body = re.search(r'/\* streaks:begin.*?\*/(.*?)/\* streaks:end \*/', src, re.S)[1]
        node = shutil.which('node') or '/opt/homebrew/bin/node'
        out = subprocess.run([node, '-e', body + f'console.log(JSON.stringify(streaksOf({json.dumps(days)}, {json.dumps(today)})))'], capture_output=True, text=True, check=True)
        return json.loads(out.stdout)

    def test_current_and_longest(self):
        days = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-09', '2026-10-10', '2026-10-11']
        self.assertEqual(self.streaks(days, '2026-10-11'), {'current': 3, 'longest': 4})
        self.assertEqual(self.streaks(days, '2026-10-12'), {'current': 3, 'longest': 4})   # today not yet practiced: the streak runs to yesterday
        self.assertEqual(self.streaks(days, '2026-10-13'), {'current': 0, 'longest': 4})   # a missed day breaks it
        self.assertEqual(self.streaks([], '2026-10-13'), {'current': 0, 'longest': 0})
        self.assertEqual(self.streaks(['2026-02-28', '2026-03-01', '2026-03-02', '2026-03-02'], '2026-03-02'), {'current': 3, 'longest': 3})   # month ends and duplicates


if __name__ == '__main__':
    unittest.main()
