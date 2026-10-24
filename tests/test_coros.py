import json, tempfile, unittest
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import common, coros_sync as c

def ident(n): return f'48097320790448{n:04d}'

def record(n, date, sport='Outdoor Run', st=100, location='Galveston Run', dist='1.63 km', start=1791764137, coords=True):
    return (f"{n}. {sport} — {date}\n   Location: {location}\n"
            + ("   Start Coordinates: 29.257999, -94.841003\n" if coords else '')
            + f"   Time Window: startTimestamp={start} | endTimestamp={start + 669}\n"
            f"   Duration: 11:09 | Distance: {dist}\n   Average Pace: 6:50 /km | Avg HR: 161 bpm | Calories: 135 kcal\n"
            f"   LabelId: {ident(n)} | SportType: {st}\n\n")

RECORDS = 'Sport Records — 2010-01-01 to 2026-10-15 (3 records)\n====\n\n'
DETAIL = """🏃 Outdoor Run Activity Details
========================================

Workout Time: 11:09
Distance: 1.63 km
Total Time: 11:09
Average Pace: 6:50 /km
Moving Average Pace: 6:43 /km
Adjusted Pace: 6:52 /km
Best Kilometer: 6:47 /km
Average Heart Rate: 161 bpm
Average Cadence: 142 spm
Average Stride Length: 1.03 m
Average Power: 207 W
Elevation Gain / Loss: 6 m / 6 m
Calories: 135 kcal
Training Load: 35
Aerobic TE: 2.0
Anaerobic TE: 0.0
Training Focus: Base
Performance: Best
Workout Note: Felt easy.
Something Unknown: 12
"""
RUN_LAPS = {'lapGroups': [
    {'type': 2, 'lapDistance': 160934, 'laps': [
        {'lapIndex': 1, 'distance': 160934, 'time': 655.5, 'avgPace': 407.31, 'avgSpeedV2': 883.85, 'avgHr': 161, 'maxHr': 186, 'avgCadence': 142, 'avgPower': 209, 'elevGain': 6.0},
        {'lapIndex': 2, 'distance': 2101, 'time': 13.56, 'avgPace': 645.41, 'avgHr': 175, 'maxHr': 177, 'avgCadence': 110, 'avgPower': 0}]},
    {'type': -1, 'lapDistance': 163035, 'laps': [{'lapIndex': 1, 'distance': 163035, 'time': 669.07, 'avgHr': 161, 'maxHr': 190}]}]}
RIDE_LAPS = {'lapGroups': [
    {'type': 10, 'lapDistance': 160934, 'laps': [
        {'lapIndex': 1, 'distance': 160934, 'time': 207.85, 'avgSpeedV2': 2787.0, 'avgHr': 147, 'maxHr': 160, 'avgCadence': 80, 'avgPower': 120},
        {'lapIndex': 2, 'distance': 160934, 'time': 204.17, 'avgSpeedV2': 2838.0, 'avgHr': 159, 'maxHr': 167, 'avgCadence': 81, 'avgPower': 120}]},
    {'type': 2, 'lapDistance': 804672, 'laps': [{'lapIndex': 1, 'distance': 804672, 'time': 412.0}]},
    {'type': -1, 'laps': [{'lapIndex': 1, 'distance': 321868, 'time': 412.0, 'avgHr': 153, 'maxHr': 167}]}]}

def mcp_text(value):
    return {'content': [{'type': 'text', 'text': value if isinstance(value, str) else json.dumps(value)}]}

WELLNESS_TOOLS = ('querySleepOverview', 'querySleepHrv', 'queryRestingHeartRate', 'queryAvgHeartRate', 'queryStressLevel',
                  'queryDailyHealthData', 'queryTrainingLoadAssessment', 'queryRecoveryStatus')

def wellness_texts(d, p):
    """COROS wellness text in the live format. d = the day (date), p = the day before (date, a day with no data from some tools)."""
    iso, piso, compact, pcompact = d.isoformat(), p.isoformat(), d.strftime('%Y%m%d'), p.strftime('%Y%m%d')
    return {
        'querySleepOverview': f"Sleep Overview\n========================\nNote: each record below is dated by its wake-up day.\n\n{piso}\nSleep detail for this day is not available yet.\n\n{iso}\nSleep Score: 87\n"
            "Daily Sleep: 8h 4min (incl. naps)\nMain Sleep (asleep): 7h 54min\nMain Sleep Period (incl. awake): 8h 5min\nSleep metrics scope: daily\nDeep Sleep Ratio: 21%\n"
            "Awake Time: 11 min\nAwake Count (>5 min): 0\n"
            f"Main Sleep Window: {piso} 23:12 - {iso} 07:13\nNaps Total (asleep): 10 min\nNaps Period (incl. awake): 12 min\nNap Window: {iso} 15:34 - {iso} 15:46\n",
        'querySleepHrv': f"Sleep HRV — {piso} to {iso}\n========================\nNote: dates are wake-up days.\n\nHRV Assessment — Last 2 days\n========================\n\n{iso}:\n"
            f"  HRV Avg: 90 ms — Above normal\n  Normal Range: 61 - 83 ms\n  Baseline: 72 ms\n{piso}: no official sleep HRV value for this day; raw HRV points omitted.\n\n"
            f"Sleep HRV Time Series — Last 2 days\n========================\n\n{iso}:\n  timestamp=1791782090, timezone=-20, hrv=40 ms, status=4, confidence=100000\n",
        'queryRestingHeartRate': f"Resting Heart Rate — Last 2 days\n========================\n\n{iso}: 53 bpm\n{piso}: 0 bpm\n",
        'queryAvgHeartRate': f"Average Heart Rate — Last 2 days\n========================\n\n{iso}: 55 bpm (Min: 44, Max: 101)\n",
        'queryStressLevel': f"Stress Level — Last 2 days\n========================\n\n{iso}:\nAverage Stress: 14 (Relaxed)\nRelaxed: No data\nLow: No data\n\n{piso}:\nAverage Stress: No data\n",
        'queryDailyHealthData': f"Daily Health Data — Last 2 days | Resting HR: 46 bpm | HRV Baseline: 42 ms\nNote: sleep entries are dated by their wake-up day.\n\n--- {pcompact} ---\n"
            f"Steps: 0 | Calories: 0 kcal | Exercise: 0 min\n\n--- {compact} ---\nSteps: 7,759 | Calories: 1,043 kcal | Exercise: 1h 5min\nStress: Avg 14\nSleep Summary:\n"
            "  Total: 8h 5min | Deep: 1h 31min | Light: 4h 15min | REM: 58 min | Awake: 1h 1min\n  Sleep HR: Avg 51 bpm | Min 38 bpm | Max 70 bpm\n",
        'queryTrainingLoadAssessment': f"Training Load Assessment\n========================\n\n{iso}\nComment: Performance\nShort-Term Load: 34\nLong-Term Load: 55\nLoad Ratio: 0.61\n",
        'queryRecoveryStatus': "Recovery Status\n========================\n\nRecovery: 100%\nLevel: Heavy training allowed\nEstimated Full Recovery: 0h\n",
    }

class FakeCoros:
    def __init__(self, records, laps=None, wellness=None):
        self.records, self.laps, self.calls, self.wellness = records, laps or RUN_LAPS, [], wellness
    def __call__(self, name, args):
        self.calls.append((name, args))
        if name in WELLNESS_TOOLS:
            return mcp_text(self.wellness[name] if self.wellness else 'No data.')
        if name == 'querySportRecords': return mcp_text(RECORDS + ''.join(self.records))
        if name == 'getActivityDetail': return mcp_text(DETAIL)
        if name == 'queryActivityLapData': return mcp_text(self.laps)
        if name == 'queryActivityFitFileDownloadUrls': return mcp_text(f"Activity FIT file download URL(s):\n1. {args['labelId']}.fit\n   https://s3.coros.com/fit/1/{args['labelId']}.fit")
        raise AssertionError(name)
    def count(self, name): return sum(1 for n, _ in self.calls if n == name)

class CorosTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.vault = Path(self.tmp.name) / 'vault'; (self.vault / '_System').mkdir(parents=True)
        for p in (patch.object(c, 'vault', lambda: self.vault), patch.object(common, 'vault', lambda: self.vault),
                  patch.object(c, 'HISTORY', Path(self.tmp.name) / 'none.json')):
            p.start(); self.addCleanup(p.stop)
        self.today = c.today_local()
    def entry(self, ident): return common.read_json(self.vault / f'_System/activities/{ident}.json')
    def status(self): return common.read_json(self.vault / '_System/coros-status.json')
    def notes(self): return sorted(p.name for p in (self.vault / 'Training/Activities').glob('*.md'))

    # ----- parsing -----
    def test_parse_records(self):
        found = c.parse_records(RECORDS + record(1, '2026-10-11') + record(2, '2026-10-12', 'Indoor Cycling', 201, 'Indoor Bike', '14.28 km') +
                                record(3, '2026-10-13', 'Pool Swim', 300, 'Swim: Easy 400m', '400 m'))
        self.assertEqual([r['sportType'] for r in found], [100, 201, 300])
        self.assertEqual(found[0]['start'], 1791764137); self.assertEqual(found[0]['durationS'], 669)
        self.assertEqual(found[2]['distanceKm'], 0.4)
        self.assertEqual([c.title_of(r['location'], r['sport']) for r in found], ['Galveston Run', 'Indoor Cycling', 'Swim: Easy 400m'])
        self.assertEqual([c.sport_group(t) for t in (100, 104, 201, 301, 402, 900, 903, None)], ['run', 'hike', 'ride', 'swim', 'strength', 'walk', 'other', 'other'])
        self.assertEqual(c.clock('1:02:56'), 3776)

    def test_parse_detail(self):
        m, note = c.parse_detail(DETAIL)
        self.assertEqual((m['durationS'], m['paceSPerKm'], m['movingPaceSPerKm'], m['bestKmSPerKm']), (669, 410, 403, 407))
        self.assertEqual((m['avgHr'], m['cadence'], m['strideM'], m['power'], m['elevGainM'], m['load'], m['aerobicTE'], m['anaerobicTE'], m['focus']), (161, 142, 1.03, 207, 6, 35, 2.0, 0.0, 'Base'))
        self.assertNotIn('elapsedS', m); self.assertEqual(note, 'Felt easy.')
        swim, _ = c.parse_detail('Workout Time: 42:40\nTotal Time: 42:50\nDistance: 0.50 km\nAverage Pace: 3:32 /100m\nAverage Power: 0 W\nElevation Gain / Loss: 0 m / 0 m\n')
        self.assertEqual((swim['paceSPerKm'], swim['elapsedS']), (2120, 2570))
        self.assertNotIn('power', swim); self.assertNotIn('elevGainM', swim)   # missing is omitted, never 0

    def test_laps_units_and_group_choice(self):
        laps, max_hr = c.parse_laps(RUN_LAPS, 'run')
        self.assertEqual(max_hr, 190); self.assertEqual(len(laps), 2)
        self.assertEqual((laps[0]['distanceKm'], laps[0]['timeS'], laps[0]['paceSPerKm'], laps[0]['speedKmh']), (1.609, 655.5, 407, 8.84))
        self.assertNotIn('power', laps[1])
        ride, _ = c.parse_laps(RIDE_LAPS, 'ride')
        self.assertEqual((len(ride), ride[0]['speedKmh'], ride[0]['avgHr'], ride[0]['power']), (2, 27.87, 147, 120)); self.assertNotIn('paceSPerKm', ride[0])
        self.assertEqual(c.parse_laps({'lapGroups': []}, 'strength'), ([], None))

    def test_series_has_no_position_and_is_downsampled(self):
        from datetime import datetime, timezone
        t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
        rows = [{'ts': t0 + timedelta(seconds=i), 'hr': 100 + i % 50 if i else None, 'speed': 2.5, 'elev': i / 10, 'power': 0, 'cadence': 70, 'dist': i * 2.5} for i in range(2000)]
        s = c.build_series(rows, 'run')
        self.assertEqual(len(s['t']), 600); self.assertEqual(s['t'][0], 0); self.assertEqual(s['t'][-1], 1999)
        self.assertEqual(s['cadence'][0], 140); self.assertNotIn('power', s); self.assertEqual(s['hr'][0], 101)   # leading gap takes first reading
        self.assertTrue(set(s) <= {'t', 'hr', 'speedKmh', 'elevM', 'power', 'cadence', 'distanceKm'})

    # ----- sync -----
    def test_sync_stores_public_fields_without_coordinates(self):
        fake = FakeCoros([record(1, '2026-10-11')])
        with patch.object(c, 'tool', fake):
            self.assertEqual(c.sync(fit=0), 1)
        e = self.entry(ident(1))
        self.assertEqual(e['public'], {'id': ident(1), 'date': '2026-10-11', 'start': 1791764137, 'sport': 'Outdoor Run', 'group': 'run',
                                       'durationS': 669, 'distanceKm': 1.63, 'elevGainM': 6, 'avgHr': 161, 'load': 35, 'title': 'Galveston Run'})
        self.assertEqual(len(e['detail']['laps']), 2)
        self.assertEqual(e['detail']['metrics']['maxHr'], 190)
        exposed = json.dumps([e['public'], e['detail'], e.get('series')])
        for needle in ('29.257999', '94.841003', 'Coordinates', 'latitude', 'position_lat'): self.assertNotIn(needle, exposed)
        self.assertEqual(e['private']['workoutNote'], 'Felt easy.'); self.assertEqual(e['private']['sportType'], 100)
        self.assertEqual(self.notes(), ['2026-10-11 Galveston Run.md'])
        st = self.status()
        self.assertEqual((st['recordCount'], st['coverageStart'], st['coverageEnd'], st['detailBacklog'], st['fitBacklog'], st['lastError']), (1, '2026-10-11', '2026-10-11', 0, 1, None))
        # An unchanged second sync reports nothing changed and rewrites nothing.
        with patch.object(c, 'tool', FakeCoros([record(1, '2026-10-11')])):
            self.assertEqual(c.sync(fit=0), 0)

    def test_old_notes_are_migrated_without_losing_body_or_properties(self):
        oid = ident(1)
        folder = self.vault / 'Training/Activities'; folder.mkdir(parents=True)
        body = '\nMy note\n\n\n![[run.m4a]]\n  trailing spaces  \n'
        (folder / f'{oid}.md').write_text(f"---\ntitle: Outdoor Run · 2026-10-11\ntype: activity\nid: '{oid}'\ndate: '2026-10-11'\nvisibility: private\naudio: run.m4a\n---\n{body}", encoding='utf-8')
        common.write_json(self.vault / f'_System/activities/{oid}.json', {'source': 'COROS', 'public': {'id': oid, 'date': '2026-10-11', 'sport': 'Outdoor Run', 'durationSeconds': 669},
                          'private': {'sportType': 100, 'raw': record(1, '2026-10-11')[3:]}})
        with patch.object(c, 'tool', FakeCoros([])): c.backfill(fit=0)
        self.assertEqual(self.notes(), ['2026-10-11 Galveston Run.md'])
        meta, rest = c.split_note((folder / '2026-10-11 Galveston Run.md').read_text(encoding='utf-8'))
        self.assertEqual(rest, body)
        self.assertEqual((meta['visibility'], meta['audio'], meta['title'], meta['id'], meta['duration'], meta['distance_mi'], meta['pace'], meta['avg_hr'], meta['load']),
                         ('private', 'run.m4a', 'Galveston Run', oid, '0:11:09', 1.01, '11:00 /mi', 161, 35))   # from COROS pace 6:50 /km
        self.assertNotIn('distance_km', meta)
        owned = [k for k in meta if k in c.OWNED]; self.assertEqual(list(meta)[:len(owned)], owned)
        # A second pass leaves the note byte-for-byte alone.
        before = (folder / '2026-10-11 Galveston Run.md').read_bytes()
        with patch.object(c, 'tool', FakeCoros([])): c.backfill(fit=0)
        self.assertEqual((folder / '2026-10-11 Galveston Run.md').read_bytes(), before)
        self.assertEqual(self.entry(oid)['public']['durationS'], 669)

    def test_same_day_same_title_notes_are_numbered(self):
        with patch.object(c, 'tool', FakeCoros([record(1, '2026-10-11', location='Run'), record(2, '2026-10-11', location='Run', start=1791770000)])):
            c.sync(fit=0)
        self.assertEqual(self.notes(), ['2026-10-11 Run 2.md', '2026-10-11 Run.md'])

    def test_detail_budget_and_recent_refresh(self):
        old = [record(i, f'2026-01-{i:02d}', start=1780000000 + i) for i in range(1, 6)]
        fake = FakeCoros(old)
        with patch.object(c, 'tool', fake): c.sync(detail=6, fit=0)
        self.assertEqual(fake.count('getActivityDetail') + fake.count('queryActivityLapData'), 6)
        self.assertEqual(self.status()['detailBacklog'], 2)
        newest = self.entry(ident(5))   # newest first
        self.assertIn('metrics', newest['detail']); self.assertNotIn('metrics', self.entry(ident(1))['detail'])
        # Finished old activities are not refetched; activities from the last three days are.
        fresh = record(9, self.today.isoformat(), start=1790000000)
        fake = FakeCoros(old + [fresh])
        with patch.object(c, 'tool', fake): c.sync(detail=20, fit=0)
        self.assertEqual(fake.count('getActivityDetail'), 3)   # 2 backlog + 1 fresh
        fake = FakeCoros(old + [fresh])
        with patch.object(c, 'tool', fake): c.sync(detail=20, fit=0)
        self.assertEqual(fake.count('getActivityDetail'), 1)   # only the fresh one again
        self.assertEqual(self.status()['detailBacklog'], 0)

    def test_fit_quota_is_respected(self):
        recs = [record(i, f'2026-01-{i:02d}', start=1780000000 + i) for i in range(1, 5)]
        c.update_status(fitQuota={'date': self.today.isoformat(), 'used': 43})
        series = {'t': [0, 1], 'hr': [100, 101]}; scan = {'messages': {'record': 2}, 'noteLike': [], 'longText': []}
        fake = FakeCoros(recs)
        with patch.object(c, 'tool', fake), patch.object(c, 'download', lambda url: b'fit'), patch.object(c, 'parse_fit', lambda p, g: (series, scan)):
            c.sync(fit=10)
            self.assertEqual(fake.count('queryActivityFitFileDownloadUrls'), 2)   # 43 + 2 = 45 cap
            self.assertEqual(self.status()['fitQuota'], {'date': self.today.isoformat(), 'used': 45})
            self.assertEqual(self.status()['fitBacklog'], 2)
            self.assertTrue((self.vault / f'_System/fit/{ident(4)}.fit').exists())   # newest first
            self.assertTrue((self.vault / f'_System/fit/{ident(3)}.fit').exists())
            self.assertFalse((self.vault / f'_System/fit/{ident(2)}.fit').exists())
            self.assertEqual(self.entry(ident(4))['series'], series)
            self.assertEqual(self.entry(ident(4))['fit']['file'], f'_System/fit/{ident(4)}.fit')
            # A new day starts a new count; the explicit per-run limit also applies.
            c.update_status(fitQuota={'date': (self.today - timedelta(days=1)).isoformat(), 'used': 45})
            before = fake.count('queryActivityFitFileDownloadUrls')
            c.sync(fit=1)
            self.assertEqual(fake.count('queryActivityFitFileDownloadUrls') - before, 1)
            self.assertEqual(self.status()['fitQuota']['used'], 1)

    def test_failures_are_reported_and_cleared(self):
        def boom(name, args): raise RuntimeError('COROS session expired')
        with patch.object(c, 'tool', boom):
            with self.assertRaises(RuntimeError): c.sync()
        self.assertIn('session expired', self.status()['lastError'])
        with patch.object(c, 'tool', FakeCoros([record(1, '2026-10-11')])): c.sync(fit=0)
        self.assertIsNone(self.status()['lastError'])

    # ----- wellness -----
    def days(self, n=0): return self.today - timedelta(days=n)
    def texts(self): return wellness_texts(self.days(), self.days(1))

    def test_wellness_parsers(self):
        t = self.texts(); d, p = self.days().isoformat(), self.days(1).isoformat()
        sleep = c.parse_sleep_overview(t['querySleepOverview'])
        self.assertEqual(list(sleep), [d])   # a day with no detail yet is skipped
        self.assertEqual(sleep[d][0], {'sleepScore': 87, 'sleepS': 28440, 'inBedS': 29100, 'awakeS': 660, 'awakeCount': 0,
                                       'bedDate': p, 'bedtime': '23:12', 'wake': '07:13', 'napS': 600, 'napAt': '15:34'})   # main sleep, not the nap-inclusive total
        self.assertIn('Main Sleep (asleep)', sleep[d][1])
        hrv = c.parse_sleep_hrv(t['querySleepHrv'])
        self.assertEqual(hrv, {d: ({'hrv': 90, 'hrvLow': 61, 'hrvHigh': 83}, hrv[d][1])})
        self.assertNotIn('timestamp', hrv[d][1])   # raw time series is dropped
        self.assertEqual(c.parse_resting_hr(t['queryRestingHeartRate']), {d: ({'restingHr': 53}, f'{d}: 53 bpm')})   # 0 bpm = no reading
        self.assertEqual(c.parse_avg_hr(t['queryAvgHeartRate'])[d][0], {'avgHr': 55})
        self.assertEqual(list(c.parse_stress(t['queryStressLevel'])), [d]); self.assertEqual(c.parse_stress(t['queryStressLevel'])[d][0], {'stress': 14})
        health = c.parse_daily_health(t['queryDailyHealthData'])
        self.assertEqual(list(health), [d])   # 0 steps / 0 kcal means nothing recorded: omitted
        self.assertEqual(health[d][0], {'steps': 7759, 'calories': 1043, 'deepS': 5460, 'lightS': 15300, 'remS': 3480, 'awakeS': 3660, 'sleepHrAvg': 51, 'sleepHrMin': 38})
        self.assertEqual(c.parse_training_load(t['queryTrainingLoadAssessment'])[d][0], {'acuteLoad': 34, 'chronicLoad': 55, 'loadRatio': 0.61})
        self.assertEqual(c.parse_recovery(t['queryRecoveryStatus']), 100)
        self.assertEqual((c.duration_s('7h 54min'), c.duration_s('11 min'), c.duration_s('2h'), c.duration_s('none')), (28440, 660, 7200, None))
        self.assertEqual([r for r in c.month_chunks(self.days(9), self.days(), 4)], [(self.days(9), self.days(6)), (self.days(5), self.days(2)), (self.days(1), self.days())])

    def test_wellness_pass_writes_merged_days_and_is_idempotent(self):
        fake = FakeCoros([], wellness=self.texts())
        budget = c.Budget(20)
        with patch.object(c, 'tool', fake): changed = c.wellness_pass(self.days(13), self.days(), budget)
        d = self.days().isoformat()
        self.assertEqual(changed, {d}); self.assertEqual(sorted(p.name for p in (self.vault / '_System/wellness').glob('*.json')), [d + '.json'])
        rec = common.read_json(self.vault / f'_System/wellness/{d}.json')
        self.assertEqual((rec['source'], set(rec)), ('COROS', {'source', 'importedAt', 'public', 'private'}))
        self.assertEqual(rec['public'], {'sleepS': 28440, 'deepS': 5460, 'lightS': 15300, 'remS': 3480, 'awakeS': 660, 'sleepScore': 87, 'hrv': 90, 'hrvLow': 61, 'hrvHigh': 83,
                                         'restingHr': 53, 'avgHr': 55, 'stress': 14, 'steps': 7759, 'calories': 1043, 'acuteLoad': 34, 'chronicLoad': 55, 'loadRatio': 0.61, 'recoveryPct': 100,
                                         'inBedS': 29100, 'awakeCount': 0, 'bedDate': self.days(1).isoformat(), 'bedtime': '23:12', 'wake': '07:13', 'napS': 600, 'napAt': '15:34',
                                         'sleepHrAvg': 51, 'sleepHrMin': 38})
        self.assertEqual(set(rec['private']['raw']), set(WELLNESS_TOOLS))
        self.assertEqual(20 - budget.left, 8)   # one call per tool for a 14-day range
        # Same data again: nothing changes and the file is not touched.
        path = self.vault / f'_System/wellness/{d}.json'; before = path.read_bytes()
        with patch.object(c, 'tool', FakeCoros([], wellness=self.texts())): self.assertEqual(c.wellness_pass(self.days(13), self.days(), c.Budget(20)), set())
        self.assertEqual(path.read_bytes(), before)
        # A changed value rewrites it; recovery from an earlier run survives when the range no longer includes today.
        t = self.texts(); t['queryDailyHealthData'] = t['queryDailyHealthData'].replace('7,759', '8,000')
        with patch.object(c, 'tool', FakeCoros([], wellness=t)): self.assertEqual(c.wellness_pass(self.days(13), self.days(), c.Budget(20)), {d})
        self.assertEqual(common.read_json(path)['public']['steps'], 8000)
        with patch.object(c, 'tool', FakeCoros([], wellness={**t, 'queryRecoveryStatus': 'Recovery: 40%'})): c.wellness_pass(self.days(13), self.days(), c.Budget(20))
        self.assertEqual(common.read_json(path)['public']['recoveryPct'], 40)

    def test_sleep_overview_details_in_the_formats_coros_prints(self):
        text = ("2026-10-18\nSleep Score: 80\nDaily Sleep: 9h 15min (incl. naps)\nMain Sleep (asleep): 9h 15min\nMain Sleep Period (incl. awake): 9h 54min\n"
                "Awake Time: 39 min\nAwake Count (>5 min): 3\nMain Sleep Window: 2026-10-17 23:57 - 2026-10-18 09:51\nNaps Total: 0 min\n\n"
                "2026-10-19\nSleep Score: 69\nMain Sleep (asleep): 6h 13min\nMain Sleep Period (incl. awake): 7h 19min\nAwake Time: 1h 6min\nAwake Count (>5 min): 1\n"
                "Main Sleep Window: 2026-10-19 00:43 - 2026-10-19 08:02\nNaps Total (asleep): 1h 10min\nNaps Period (incl. awake): 1h 21min\n"
                "Nap Window: 2026-10-19 13:18 - 2026-10-19 14:04\nNap Window: 2026-10-19 16:21 - 2026-10-19 16:56")
        got = c.parse_sleep_overview(text)
        self.assertEqual(got['2026-10-18'][0], {'sleepScore': 80, 'sleepS': 33300, 'inBedS': 35640, 'awakeS': 2340, 'awakeCount': 3,
                                                'bedDate': '2026-10-17', 'bedtime': '23:57', 'wake': '09:51'})   # bed the evening before, no naps
        night = got['2026-10-19'][0]
        self.assertEqual((night['bedDate'], night['bedtime'], night['wake'], night['inBedS'], night['awakeCount']), ('2026-10-19', '00:43', '08:02', 26340, 1))
        self.assertEqual((night['napS'], night['napAt']), (4200, '13:18'))   # first nap window starts the tick
        self.assertNotIn('bedtime', c.parse_sleep_overview('2026-10-20\nSleep Score: 70\nMain Sleep (asleep): 7h')['2026-10-20'][0])   # no window, no clock fields
        hr = c.parse_daily_health('--- 20261019 ---\nSteps: 10 | Calories: 5 kcal\nSleep Summary:\n  Total: 7h 19min | Deep: 51 min\n  Sleep HR: Avg 55 bpm | Min 47 bpm | Max 86 bpm')
        self.assertEqual((hr['2026-10-19'][0]['sleepHrAvg'], hr['2026-10-19'][0]['sleepHrMin']), (55, 47))

    def test_stored_raw_text_fills_new_fields_without_api_calls(self):
        d = '2026-10-19'; folder = self.vault / '_System/wellness'; folder.mkdir(parents=True)
        raw = {'querySleepOverview': "2026-10-19\nSleep Score: 69\nMain Sleep (asleep): 6h 13min\nMain Sleep Period (incl. awake): 7h 19min\nAwake Time: 1h 6min\nAwake Count (>5 min): 1\n"
                                     "Main Sleep Window: 2026-10-19 00:43 - 2026-10-19 08:02\nNaps Total (asleep): 26 min\nNap Window: 2026-10-19 15:34 - 2026-10-19 16:05",
               'queryDailyHealthData': "--- 20261019 ---\nSteps: 6,673 | Calories: 421 kcal\nSleep Summary:\n  Total: 7h 19min | Deep: 51 min\n  Sleep HR: Avg 55 bpm | Min 47 bpm | Max 86 bpm"}
        old = {'sleepS': 22380, 'sleepScore': 69, 'awakeS': 3960, 'steps': 6673, 'napS': 99}   # a stale value that raw no longer supports is replaced
        common.write_json(folder / f'{d}.json', {'source': 'COROS', 'importedAt': 'x', 'public': old, 'private': {'raw': raw}}, True)
        self.assertEqual(c.migrate_wellness(), {d})
        pub = common.read_json(folder / f'{d}.json')['public']
        self.assertEqual({k: pub[k] for k in c.SLEEP_EXTRA}, {'bedtime': '00:43', 'bedDate': d, 'wake': '08:02', 'inBedS': 26340, 'awakeCount': 1, 'napS': 1560, 'napAt': '15:34', 'sleepHrAvg': 55, 'sleepHrMin': 47})
        self.assertEqual((pub['sleepS'], pub['steps']), (22380, 6673))   # fields from before are not touched
        before = (folder / f'{d}.json').read_bytes()
        self.assertEqual(c.migrate_wellness(), set()); self.assertEqual((folder / f'{d}.json').read_bytes(), before)   # idempotent: the file is not rewritten

    def test_recovery_is_only_attached_to_today_and_missing_means_omitted(self):
        fake = FakeCoros([], wellness=self.texts())
        with patch.object(c, 'tool', fake): c.wellness_pass(self.days(13), self.days(1), c.Budget(20))   # range ends yesterday
        self.assertEqual(fake.count('queryRecoveryStatus'), 0)
        self.assertNotIn('recoveryPct', common.read_json(self.vault / f'_System/wellness/{self.days().isoformat()}.json').get('public', {}))   # file for today not even written
        self.assertFalse((self.vault / f'_System/wellness/{self.days().isoformat()}.json').exists())
        empty = FakeCoros([])   # COROS has nothing: no files, no zeros
        with patch.object(c, 'tool', empty): self.assertEqual(c.wellness_pass(self.days(13), self.days(), c.Budget(20)), set())

    def test_wellness_tool_failure_is_isolated_and_budget_is_respected(self):
        base = FakeCoros([], wellness=self.texts())
        def flaky(name, args):
            if name == 'queryStressLevel': raise RuntimeError('boom')
            return base(name, args)
        errors = []
        with patch.object(c, 'tool', flaky): changed = c.wellness_pass(self.days(13), self.days(), c.Budget(20), errors)
        self.assertEqual(len(changed), 1); self.assertEqual(len(errors), 1); self.assertIn('queryStressLevel', errors[0])
        rec = common.read_json(self.vault / f'_System/wellness/{self.days().isoformat()}.json')['public']
        self.assertNotIn('stress', rec); self.assertEqual(rec['hrv'], 90)
        errors = []; fake = FakeCoros([], wellness=self.texts())
        with patch.object(c, 'tool', fake): c.wellness_pass(self.days(13), self.days(), c.Budget(3), errors)
        self.assertEqual(len(fake.calls), 3); self.assertTrue(errors)

    def test_long_ranges_are_chunked(self):
        fake = FakeCoros([], wellness=self.texts())
        with patch.object(c, 'tool', fake): c.wellness_pass(self.days(60), self.days(), c.Budget(40))
        self.assertEqual(fake.count('querySleepHrv'), 3); self.assertEqual(fake.count('querySleepOverview'), 1)
        self.assertTrue(all(a['days'] <= 28 for n, a in fake.calls if n == 'querySleepHrv'))
        self.assertEqual([a['days'] for n, a in fake.calls if n == 'queryStressLevel'], [61])

    def test_sync_runs_wellness_and_a_wellness_failure_does_not_break_activities(self):
        fake = FakeCoros([record(1, '2026-10-11')], wellness=self.texts())
        with patch.object(c, 'tool', fake): self.assertEqual(c.sync(fit=0), 1)   # the activity; today's partial wellness doesn't trigger a publish
        st = self.status()
        self.assertEqual(st['wellnessCoverage'], {'start': self.days(13).isoformat(), 'end': self.days().isoformat()}); self.assertEqual(st['wellnessDays'], 1)
        self.assertEqual((st['changedLastSync'], st['lastError']), (1, None))
        with patch.object(c, 'tool', FakeCoros([record(1, '2026-10-11')], wellness=self.texts())): self.assertEqual(c.sync(fit=0), 0)   # idempotent: scheduled run won't republish
        base = FakeCoros([record(1, '2026-10-11'), record(2, '2026-10-12', start=1791800000)])
        def broken(name, args):
            if name in WELLNESS_TOOLS: raise RuntimeError('COROS wellness down')
            return base(name, args)
        with patch.object(c, 'tool', broken): c.sync(fit=0)
        st = self.status()
        self.assertEqual(st['recordCount'], 2); self.assertIn('wellness', st['lastError']); self.assertEqual(st['wellnessDays'], 1)

    def test_full_sync_covers_from_the_earliest_activity(self):
        fake = FakeCoros([record(1, '2026-08-21')], wellness=self.texts())
        with patch.object(c, 'tool', fake): c.sync(full=True, fit=0)
        self.assertEqual(self.status()['wellnessCoverage'], {'start': '2026-08-21', 'end': self.days().isoformat()})
        days = (self.today - c.date(2026, 8, 21)).days + 1
        self.assertEqual([a['days'] for n, a in fake.calls if n == 'queryRestingHeartRate'], [days])

if __name__ == '__main__':
    unittest.main()
