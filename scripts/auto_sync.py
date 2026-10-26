"""One scheduled laptop run: COROS sync, then publish if anything public changed."""
import fcntl, sys
from common import LOCAL, now, read_json
import coros_sync, dates, hevy_sync, publisher, tidy, weight

def run():
    LOCAL.mkdir(parents=True, exist_ok=True)
    with (LOCAL / 'sync.lock').open('w') as lock:
        try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError: return 'Another sync is already running'
        changed = coros_sync.sync()
        # Strength and weight are extras: a failure is recorded in their status files and never stops the run.
        for step in (hevy_sync.sync, weight.sync):
            try: changed += step()
            except Exception as e: print(now(), f'{step.__module__} failed: {type(e).__name__}', file=sys.stderr)
        tidy.tidy()
        dates.stamp()
        if not (LOCAL / 'auto-publish-enabled').exists():
            publisher.export()
            return f'{changed} changed activities; automatic publishing is off'
        # Publish when COROS brought something new OR a public note was added/edited (e.g. from the phone).
        publisher.export()
        report = read_json(publisher.REPORT)
        notes_changed = len(report.get('ready', [])) + len(report.get('changed', []))
        if not changed and not notes_changed: return '0 changed activities, no note changes'
        result = publisher.publish()
        return f'{changed} changed activities, {notes_changed} notes; published {result["entries"]} entries, {len(result["held"])} held back'

if __name__ == '__main__':
    try: print(now(), run(), flush=True)
    except Exception as e: print(now(), 'Sync failed:', e, file=sys.stderr); sys.exit(1)
