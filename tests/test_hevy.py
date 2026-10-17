import json, tempfile, unittest, urllib.request
from datetime import date
from pathlib import Path
from unittest.mock import patch
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import common, coros_sync, hevy_sync as h, publisher

START = 1791764137          # 2026-10-11 ~19:55 UTC


def iso(ts):
    from datetime import datetime, timezone
    return datetime.fromtimestamp(ts, timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def workout(n, start=START, minutes=50, title='Push Day', sets=None):
    sets = sets if sets is not None else [
        {'index': 0, 'type': 'warmup', 'weight_kg': 20, 'reps': 10},
        {'index': 1, 'type': 'normal', 'weight_kg': 60, 'reps': 8},
        {'index': 2, 'type': 'normal', 'weight_kg': 60, 'reps': 6, 'rpe': 9}]
    return {'id': f'00000000-0000-0000-0000-{n:012d}', 'title': title, 'description': 'PRIVATE DESCRIPTION', 'routine_id': 'r1',
            'start_time': iso(start), 'end_time': iso(start + minutes * 60), 'updated_at': iso(start + 3600), 'created_at': iso(start),
            'exercises': [{'index': 0, 'title': 'Bench Press (Barbell)', 'notes': 'PRIVATE NOTE', 'sets': sets},
                          {'index': 1, 'title': 'Plank', 'sets': [{'index': 0, 'type': 'normal', 'duration_seconds': 60}]}]}


class FakeHevy:
    """Stands in for hevy_sync.get. Records every path; serves pages of 10."""
    def __init__(self, workouts, events=None): self.workouts, self.events, self.calls = list(workouts), events or [], []
    def __call__(self, path, params=None, key=None, retries=3):
        assert key == 'secret-test-key'
        self.calls.append((path, dict(params or {})))
        if path == '/workouts/count': return {'workout_count': len(self.workouts)}
        page, size = (params or {}).get('page', 1), (params or {}).get('pageSize', 10)
        items = self.workouts if path == '/workouts' else self.events
        field = 'workouts' if path == '/workouts' else 'events'
        return {'page': page, 'page_count': max(1, -(-len(items) // size)), field: items[(page - 1) * size:page * size]}


class HevyTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name); self.vault = self.root / 'vault'; (self.vault / '_System').mkdir(parents=True)
        self.key = self.root / 'hevy.key'
        for p in (patch.object(common, 'vault', lambda: self.vault), patch.object(coros_sync, 'vault', lambda: self.vault),
                  patch.object(h, 'KEY_FILE', self.key)):
            p.start(); self.addCleanup(p.stop)

    def connect(self): self.key.write_text('secret-test-key\n')
    def status(self): return common.read_json(self.vault / '_System/hevy-status.json')
    def notes(self): return sorted(p.name for p in (self.vault / 'Training/Activities').glob('*.md')) if (self.vault / 'Training/Activities').exists() else []
    def coros_entry(self, ident, start, duration):
        coros_sync.save(ident, {'source': 'COROS', 'public': {'id': ident, 'date': '2026-10-11', 'start': start, 'sport': 'Gym', 'group': 'strength', 'durationS': duration, 'title': 'Gym'}})

    def test_not_connected_is_quiet(self):
        fake = FakeHevy([])
        with patch.object(h, 'get', fake): self.assertEqual(h.sync(), 0)
        self.assertEqual(fake.calls, [])
        self.assertEqual(self.status()['state'], 'hevy: not connected')
        self.assertFalse((self.vault / '_System/hevy').exists())

    def test_convert_to_pounds_and_totals(self):
        pub, raw = h.convert(workout(1))
        bench = pub['exercises'][0]['sets']
        self.assertEqual([s['weightLb'] for s in bench], [44.1, 132.3, 132.3])
        self.assertEqual(pub['exercises'][1]['sets'][0], {'type': 'normal', 'durationS': 60})
        self.assertEqual(pub['volumeLb'], round(132.3 * 8 + 132.3 * 6, 1))
        self.assertEqual(pub['setCount'], 3)          # warm-up excluded, plank counted
        self.assertEqual(pub['durationS'], 3000)
        self.assertEqual(pub['date'], '2026-10-11')
        self.assertNotIn('PRIVATE', json.dumps(pub)); self.assertEqual(raw['description'], 'PRIVATE DESCRIPTION')

    def test_e1rm_epley(self):
        self.assertEqual(h.e1rm(100, 10), round(100 * (1 + 10 / 30), 1))
        self.assertEqual(h.e1rm(200, 1), 200)
        self.assertIsNone(h.e1rm(100, 13)); self.assertIsNone(h.e1rm(None, 5)); self.assertIsNone(h.e1rm(100, 0))
        pub, _ = h.convert(workout(1))
        prog = h.exercise_progress([pub])
        self.assertEqual(prog['Bench Press (Barbell)']['daily']['2026-10-11'], h.e1rm(132.3, 8))   # warm-up ignored
        self.assertNotIn('Plank', prog)

    def test_full_import_then_incremental_events(self):
        self.connect()
        ws = [workout(i, START + i * 86400) for i in range(1, 13)]
        fake = FakeHevy(ws)
        with patch.object(h, 'get', fake): self.assertEqual(h.sync(), 12 + 12)    # 12 workouts + 12 notes
        self.assertEqual(len(list((self.vault / '_System/hevy').glob('*.json'))), 12)
        self.assertEqual(len(self.notes()), 12)
        st = self.status(); self.assertEqual(st['count'], 12); self.assertIsNone(st['lastError'])
        stored = common.read_json(self.vault / '_System/hevy' / f'{ws[0]["id"]}.json')
        self.assertEqual(set(stored), {'importedAt', 'public', 'private'}); self.assertEqual(stored['private']['raw']['routine_id'], 'r1')
        # second run: only events are read, nothing changes
        again = FakeHevy(ws, events=[])
        with patch.object(h, 'get', again): self.assertEqual(h.sync(), 0)
        self.assertEqual([c[0] for c in again.calls], ['/workouts/count', '/workouts/events'])
        self.assertEqual(again.calls[1][1]['since'], st['cursor'])
        # an edit and a deletion
        edited = workout(1, START + 86400, title='Push Day 2'); edited['exercises'][0]['sets'][1]['reps'] = 10
        events = [{'type': 'updated', 'workout': edited}, {'type': 'deleted', 'id': ws[1]['id'], 'deleted_at': iso(START)}]
        ev = FakeHevy(ws[:1] + ws[2:], events=events)
        with patch.object(h, 'get', ev): self.assertGreater(h.sync(), 0)
        self.assertEqual(common.read_json(self.vault / '_System/hevy' / f'{ws[0]["id"]}.json')['public']['title'], 'Push Day 2')
        self.assertFalse((self.vault / '_System/hevy' / f'{ws[1]["id"]}.json').exists())

    def test_only_get_requests(self):
        seen = []
        class Resp:
            def read(self): return b'{"workout_count": 1}'
            def __enter__(self): return self
            def __exit__(self, *a): return False
        def fake_open(req, timeout=0): seen.append((req.get_method(), req.data, req.get_header('Api-key'))); return Resp()
        with patch.object(urllib.request, 'urlopen', fake_open): h.get('/workouts/count', None, 'k')
        self.assertEqual(seen, [('GET', None, 'k')])
        self.assertNotIn('POST', Path(h.__file__).read_text().replace('POST/PUT', ''))

    def test_error_is_recorded_without_the_key(self):
        self.connect()
        def boom(*a, **k): raise RuntimeError('Hevy answered HTTP 401 for /workouts/count')
        with patch.object(h, 'get', boom): self.assertEqual(h.sync(), 0)
        err = self.status()['lastError']; self.assertIn('401', err); self.assertNotIn('secret-test-key', err)

    def test_match_attaches_to_coros_activity_and_skips_note(self):
        self.connect()
        self.coros_entry('480973207904485777', START + 10 * 60, 40 * 60)           # overlaps
        self.coros_entry('480973207904485778', START + 5 * 86400, 1800)            # far away
        fake = FakeHevy([workout(1), workout(2, START + 3 * 86400, title='Legs')])
        with patch.object(h, 'get', fake): h.sync()
        m = common.read_json(self.vault / '_System/hevy-matches.json')
        self.assertEqual(m, {workout(1)['id']: '480973207904485777'})
        self.assertEqual(self.notes(), ['2026-10-14 Legs.md'])                      # the matched workout has no note of its own
        self.assertEqual(h.lifts_for('480973207904485777')['title'], 'Push Day')
        self.assertIsNone(h.lifts_for('480973207904485778'))
        # the COROS store is untouched
        self.assertNotIn('hevy', json.dumps(common.read_json(self.vault / '_System/activities/480973207904485777.json')))

    def test_only_strength_activities_take_lifts(self):
        self.connect()
        coros_sync.save('480973207904485779', {'source': 'COROS', 'public': {'id': '480973207904485779', 'date': '2026-10-11', 'start': START, 'sport': 'Elliptical', 'group': 'other', 'durationS': 3000, 'title': 'Elliptical'}})
        with patch.object(h, 'get', FakeHevy([workout(1)])): h.sync()
        self.assertEqual(common.read_json(self.vault / '_System/hevy-matches.json'), {})
        self.assertEqual(self.notes(), ['2026-10-11 Push Day.md'])

    def test_match_window_is_twenty_minutes(self):
        w = {'start': START, 'end': START + 3000}
        near = {'id': 'a', 'start': START + 3000 + 19 * 60, 'durationS': 600}
        far = {'id': 'b', 'start': START + 3000 + 21 * 60, 'durationS': 600}
        self.assertTrue(h.overlap_score(w, near)); self.assertIsNone(h.overlap_score(w, far))

    def test_unmatched_note_properties_and_user_body(self):
        self.connect()
        fake = FakeHevy([workout(1)])
        with patch.object(h, 'get', fake): h.sync()
        path = self.vault / 'Training/Activities/2026-10-11 Push Day.md'
        meta, body = common.parse_note(path)
        self.assertEqual(meta, {'title': 'Push Day', 'type': 'activity', 'id': 'hevy-' + workout(1)['id'], 'date': '2026-10-11', 'sport': 'Strength',
                                'source_app': 'hevy', 'duration': '0:50:00', 'volume_lb': 1852, 'sets': 3})
        common.write_note(path, {**meta, 'visibility': 'private', 'tags': ['lift']}, 'my own words\n')
        edited = workout(1, sets=[{'index': 0, 'type': 'normal', 'weight_kg': 100, 'reps': 5}])
        with patch.object(h, 'get', FakeHevy([edited])): h.sync(full=True)
        meta, body = common.parse_note(path)
        self.assertEqual(meta['visibility'], 'private'); self.assertEqual(meta['tags'], ['lift']); self.assertIn('my own words', body)
        self.assertEqual(meta['sets'], 2)                                            # plank + one set
        self.assertEqual(self.notes(), ['2026-10-11 Push Day.md'])

    def test_note_keeps_workout_separate_when_coros_arrives_later(self):
        self.connect()
        with patch.object(h, 'get', FakeHevy([workout(1)])): h.sync()
        self.coros_entry('480973207904485777', START, 3000)
        with patch.object(h, 'get', FakeHevy([workout(1)])): h.sync(full=True)
        self.assertEqual(common.read_json(self.vault / '_System/hevy-matches.json'), {})

    def with_templates(self, n, start=START):
        w = workout(n, start)
        w['exercises'][0]['exercise_template_id'] = 'T-BENCH'; w['exercises'][1]['exercise_template_id'] = 'T-PLANK'
        return w

    TEMPLATES = [{'id': 'T-BENCH', 'title': 'Bench Press (Barbell)', 'primary_muscle_group': 'chest', 'secondary_muscle_groups': ['triceps', 'shoulders']},
                 {'id': 'T-PLANK', 'title': 'Plank', 'primary_muscle_group': 'abdominals', 'secondary_muscle_groups': []},
                 {'id': 'T-CARDIO', 'title': 'Run', 'primary_muscle_group': 'cardio', 'secondary_muscle_groups': []}]

    def test_muscles_count_working_sets_primary_and_secondary(self):
        templates = {t['id']: h.trim_template(t) for t in self.TEMPLATES}
        self.assertEqual(h.muscles_of(self.with_templates(1), templates), {
            'chest': {'primary': 2, 'secondary': 0}, 'triceps': {'primary': 0, 'secondary': 2},
            'shoulders': {'primary': 0, 'secondary': 2}, 'abdominals': {'primary': 1, 'secondary': 0}})
        self.assertEqual(h.muscles_of(self.with_templates(1), {}), {})

    def test_template_cache_fetches_only_unknown_ids(self):
        self.connect()
        calls = []
        def fake(path, params=None, key=None, retries=3):
            calls.append(path)
            if path == '/exercise_templates': return {'page': 1, 'page_count': 1, 'exercise_templates': self.TEMPLATES}
            raise RuntimeError('404')
        with patch.object(h, 'get', fake):
            first = h.refresh_templates({'T-BENCH', 'T-PLANK'}, 'secret-test-key')
            self.assertEqual(first['T-BENCH']['primary'], 'chest'); self.assertEqual(calls, ['/exercise_templates'])
            h.refresh_templates({'T-BENCH', 'T-PLANK'}, 'secret-test-key'); self.assertEqual(calls, ['/exercise_templates'])
            h.refresh_templates({'T-BENCH', 'T-GONE'}, 'secret-test-key')
        self.assertEqual(calls[1:], ['/exercise_templates', '/exercise_templates/T-GONE'])
        self.assertNotIn('T-GONE', common.read_json(self.vault / '_System/hevy-templates.json'))

    def test_muscle_scores_by_month_in_strength_json(self):
        self.connect()
        for n, day in ((1, 0), (2, 30)):          # 2026-10-11 and 2026-11-10
            pub, raw = h.convert(self.with_templates(n, START + day * 86400))
            common.write_json(self.vault / '_System/hevy' / f'{pub["id"]}.json', {'public': pub, 'private': {'raw': raw}})
        def fake(path, params=None, key=None, retries=3): return {'page': 1, 'page_count': 1, 'exercise_templates': self.TEMPLATES}
        with patch.object(h, 'get', fake): self.assertEqual(h.attach_muscles('secret-test-key'), 2)
        with patch.object(h, 'get', fake): self.assertEqual(h.attach_muscles('secret-test-key'), 0)
        strength = publisher.strength_of(h.all_workouts())
        self.assertEqual(strength['muscles'], {'2026-10': {'abdominals': 1.0, 'chest': 2.0, 'shoulders': 1.0, 'triceps': 1.0},
                                               '2026-11': {'abdominals': 1.0, 'chest': 2.0, 'shoulders': 1.0, 'triceps': 1.0}})
        self.assertEqual(strength['muscleSets']['2026-10']['chest'], [2, 0]); self.assertEqual(strength['muscleSets']['2026-10']['triceps'], [0, 2])
        self.assertNotIn('muscles', publisher.strength_of([h.convert(workout(3))[0]]))


class HevyPublishTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name); self.vault = self.root / 'vault'; (self.vault / '_System').mkdir(parents=True)
        self.local = self.root / '.local'; self.local.mkdir()
        common.write_json(self.vault / '_System/publishing.json', {'notes': {}, 'lastPublished': None})
        for p in (patch.object(common, 'vault', lambda: self.vault), patch.object(coros_sync, 'vault', lambda: self.vault),
                  patch.object(publisher, 'vault', lambda: self.vault), patch.object(publisher, 'ROOT', self.root),
                  patch.object(publisher, 'LOCAL', self.local), patch.object(publisher, 'REPORT', self.local / 'last-build.json')):
            p.start(); self.addCleanup(p.stop)

    def test_lifts_on_activity_pages_and_strength_json(self):
        for n, day in ((1, 0), (2, 7), (3, 8)):
            pub, raw = h.convert(workout(n, START + day * 86400))
            common.write_json(self.vault / '_System/hevy' / f'{pub["id"]}.json', {'public': pub, 'private': {'raw': raw}})
        coros_sync.save('480973207904485777', {'source': 'COROS', 'public': {'id': '480973207904485777', 'date': '2026-10-11', 'start': START, 'sport': 'Gym', 'group': 'strength', 'durationS': 3000, 'title': 'Gym'}, 'detail': {}})
        common.write_json(self.vault / '_System/hevy-matches.json', {workout(1)['id']: '480973207904485777'})
        common.write_note(self.vault / 'Training/Activities/2026-10-11 Gym.md', {'title': 'Gym', 'type': 'activity', 'id': '480973207904485777', 'date': '2026-10-11'}, '')
        common.write_note(self.vault / 'Training/Activities/2026-10-18 Push Day.md', {'title': 'Push Day', 'type': 'activity', 'id': 'hevy-' + workout(2)['id'], 'date': '2026-10-18'}, '')
        result = publisher.export()
        self.assertEqual(result['held'], [])
        data = json.loads((self.root / 'content/data/activities/480973207904485777.json').read_text())
        self.assertEqual(data['lifts'][0]['title'], 'Bench Press (Barbell)'); self.assertEqual(data['lifts'][0]['sets'][1], {'type': 'normal', 'reps': 8, 'weightLb': 132.3})
        own = json.loads((self.root / f'content/data/activities/hevy-{workout(2)["id"]}.json').read_text())
        self.assertEqual((own['group'], own['sport']), ('strength', 'Strength')); self.assertTrue(own['lifts'])
        training = json.loads((self.root / 'content/data/training.json').read_text())
        acts = {a['id']: a for a in training['activities']}
        self.assertEqual(acts['480973207904485777']['lift'], {'volumeLb': 1852.2, 'sets': 3, 'exercises': 2})
        self.assertEqual(acts['hevy-' + workout(2)['id']]['group'], 'strength')
        self.assertNotIn('PRIVATE', json.dumps([p.read_text() for p in (self.root / 'content').rglob('*') if p.is_file()]))
        strength = json.loads((self.root / 'content/data/strength.json').read_text())
        self.assertEqual([w['week'] for w in strength['weekly']], ['2026-10-05', '2026-10-12', '2026-10-19'])
        self.assertEqual([w['sessions'] for w in strength['weekly']], [1, 1, 1])
        self.assertEqual(strength['exercises'][0]['title'], 'Bench Press (Barbell)'); self.assertEqual(strength['exercises'][0]['sessions'], 3)
        self.assertEqual(strength['exercises'][0]['best'], {'e1rmLb': h.e1rm(132.3, 8), 'weightLb': 132.3, 'reps': 8, 'date': '2026-10-11'})
        self.assertEqual(len(strength['exercises'][0]['series']), 3)


if __name__ == '__main__':
    unittest.main()
