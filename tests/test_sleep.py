import json, re, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import publisher, common

# Exact clock times as the importer stores them. None of these strings may appear anywhere under content/.
EXACT = ('23:57', '00:43', '08:02', '15:34', '23:40', '01:07', '07:51')


def stored(date, **kw):
    return {'date': date, 'sleepS': 22380, **kw}


class RoundingTests(unittest.TestCase):
    def test_times_round_to_the_nearest_quarter_hour_across_midnight(self):
        nights = publisher.sleep_of([
            stored('2026-10-19', bedtime='00:43', bedDate='2026-10-19', wake='08:02'),
            stored('2026-10-18', bedtime='23:57', bedDate='2026-10-17', wake='09:11'),
            stored('2026-10-17', bedtime='23:40', bedDate='2026-10-16', wake='07:51'),
            stored('2026-10-16', bedtime='01:07', bedDate='2026-10-16', wake='07:52'),
        ], {})
        got = {n['date']: (n['bedtime'], n['wake']) for n in nights}
        self.assertEqual(got, {'2026-10-19': ('00:45', '08:00'), '2026-10-18': ('00:00', '09:15'), '2026-10-17': ('23:45', '07:45'), '2026-10-16': ('01:00', '07:45')})
        self.assertEqual([n['date'] for n in nights], sorted(got))   # oldest first

    def test_bedtime_without_a_stored_date_is_placed_by_comparing_clocks(self):
        n = publisher.sleep_of([stored('2026-10-18', bedtime='23:57', wake='09:11')], {})[0]
        self.assertEqual((n['bedtime'], n['wake']), ('00:00', '09:15'))

    def test_night_fields_nap_and_efficiency(self):
        n = publisher.sleep_of([stored('2026-10-19', bedtime='00:43', bedDate='2026-10-19', wake='08:02', inBedS=26340, deepS=3060, lightS=14280, remS=5040, awakeS=3960,
                                       awakeCount=1, napS=1560, napAt='15:34', sleepScore=69, hrv=74, hrvLow=63, hrvHigh=85, sleepHrMin=47, sleepHrAvg=55, restingHr=56,
                                       steps=6673, avgHr=73)], {'2026-10-19': ['caffeine']})[0]
        self.assertEqual(n, {'date': '2026-10-19', 'bedtime': '00:45', 'wake': '08:00', 'asleepS': 22380, 'inBedS': 26340, 'efficiency': 85, 'deepS': 3060, 'lightS': 14280, 'remS': 5040,
                             'awakeS': 3960, 'awakeCount': 1, 'napS': 1560, 'napAt': '15:30', 'score': 69, 'hrv': 74, 'hrvLow': 63, 'hrvHigh': 85, 'sleepHrMin': 47, 'sleepHrAvg': 55,
                             'restingHr': 56, 'tags': ['caffeine']})   # nothing outside the sleep shape (steps, average heart rate) is carried over

    def test_late_evening_nap_is_not_a_nap_and_days_without_sleep_are_skipped(self):
        nights = publisher.sleep_of([stored('2026-10-15', napS=1380, napAt='23:34'), {'date': '2026-10-14', 'steps': 5}], {})
        self.assertEqual(nights, [{'date': '2026-10-15', 'asleepS': 22380}])


class SleepPublishingTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name); self.vault = self.root / 'vault'; self.vault.mkdir()
        self.local = self.root / '.local'; self.local.mkdir()
        (self.vault / '_System/wellness').mkdir(parents=True)
        common.write_json(self.vault / '_System/publishing.json', {'notes': {}, 'lastPublished': None})
        for p in [patch.object(common, 'vault', lambda: self.vault), patch.object(publisher, 'vault', lambda: self.vault),
                  patch.object(publisher, 'ROOT', self.root), patch.object(publisher, 'LOCAL', self.local),
                  patch.object(publisher, 'REPORT', self.local / 'last-build.json')]:
            p.start(); self.addCleanup(p.stop)

    def night(self, date, **kw):
        common.write_json(self.vault / f'_System/wellness/{date}.json', {'source': 'COROS', 'public': {'sleepS': 22380, 'hrv': 74, 'steps': 100, **kw}, 'private': {'raw': {'querySleepOverview': 'Main Sleep Window: 00:43 - 08:02'}}})

    def daily(self, date, body='went to bed after a long argument', **meta):
        common.write_note(self.vault / f'Daily/{date}.md', {'title': date, 'type': 'daily', 'visibility': 'private', 'date': date, **meta}, body)

    def build(self):
        publisher.export()
        return json.loads((self.root / 'content/data/sleep.json').read_text())

    def test_no_unrounded_time_reaches_content(self):
        self.night('2026-10-19', bedtime='00:43', bedDate='2026-10-19', wake='08:02', napS=1560, napAt='15:34', inBedS=26340, sleepHrMin=47, sleepHrAvg=55)
        self.night('2026-10-18', bedtime='23:57', bedDate='2026-10-17', wake='09:11')
        self.night('2026-10-17', bedtime='23:40', bedDate='2026-10-16', wake='07:51')
        self.night('2026-10-16', bedtime='01:07', bedDate='2026-10-16', wake='07:52')
        sleep = self.build()
        blob = ''.join(p.read_text() for p in (self.root / 'content').rglob('*') if p.is_file())
        for exact in EXACT: self.assertNotIn(exact, blob)
        times = [n[k] for n in sleep['nights'] for k in ('bedtime', 'wake', 'napAt') if k in n]
        self.assertTrue(times)
        for t in times:
            self.assertRegex(t, r'^\d{2}:(00|15|30|45)$')
        # the older wellness file keeps the stage and heart-rate fields but none of the night-detail fields
        well = json.loads((self.root / 'content/data/wellness.json').read_text())
        for day in well['days']:
            for key in ('bedtime', 'bedDate', 'wake', 'napAt', 'napS', 'inBedS', 'awakeCount', 'sleepHrAvg', 'sleepHrMin'): self.assertNotIn(key, day)
        self.assertEqual(well['days'][0]['hrv'], 74)

    def test_sleep_json_shape(self):
        self.night('2026-10-19', bedtime='00:43', bedDate='2026-10-19', wake='08:02', inBedS=26340, deepS=3060, lightS=14280, remS=5040, awakeS=3960, awakeCount=1,
                   sleepScore=69, hrvLow=63, hrvHigh=85, restingHr=56, sleepHrMin=47, sleepHrAvg=55)
        sleep = self.build()
        self.assertEqual(list(sleep), ['nights'])
        n = sleep['nights'][0]
        self.assertEqual(set(n), {'date', 'bedtime', 'wake', 'asleepS', 'inBedS', 'efficiency', 'deepS', 'lightS', 'remS', 'awakeS', 'awakeCount', 'score', 'hrv', 'hrvLow', 'hrvHigh',
                                  'sleepHrMin', 'sleepHrAvg', 'restingHr'})
        self.assertEqual((n['date'], n['asleepS'], n['efficiency'], n['score']), ('2026-10-19', 22380, 85, 69))
        self.assertNotIn('respiration', n); self.assertNotIn('steps', n)

    def test_sleep_tags_come_from_daily_notes_lowercased_and_nothing_else_leaks(self):
        self.night('2026-10-19', bedtime='00:43', bedDate='2026-10-19', wake='08:02')
        self.night('2026-10-18', bedtime='23:57', bedDate='2026-10-17', wake='09:11')
        self.daily('2026-10-19', sleep_tags=['Late meal', ' Caffeine ', 'late meal'])
        self.daily('2026-10-18', sleep_tags='Alcohol, #Screens')
        common.write_note(self.vault / 'Writing/Essay.md', {'title': 'Essay', 'type': 'writing', 'visibility': 'public', 'date': '2026-10-19', 'sleep_tags': ['ignored']}, 'public words')
        sleep = self.build()
        tags = {n['date']: n.get('tags') for n in sleep['nights']}
        self.assertEqual(tags, {'2026-10-19': ['late meal', 'caffeine'], '2026-10-18': ['alcohol', 'screens']})
        blob = ''.join(p.read_text() for p in (self.root / 'content').rglob('*') if p.is_file())
        self.assertNotIn('long argument', blob)   # the daily note itself stays private
        self.assertNotIn('ignored', blob)

    def test_no_sleep_no_file_and_shell_exists(self):
        publisher.export()
        self.assertFalse((self.root / 'content/data/sleep.json').exists())
        self.assertIn(('stream/sleep', 'Sleep &amp; recovery'), publisher.SHELLS)
        self.assertEqual(publisher.HUBS['sleep'], '/stream/sleep/')


if __name__ == '__main__':
    unittest.main()
