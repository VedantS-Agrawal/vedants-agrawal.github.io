"""One scheduled laptop run: COROS sync, then publish if anything public changed."""
import fcntl, sys
from common import LOCAL, now
import coros_sync, publisher

def run():
    LOCAL.mkdir(parents=True, exist_ok=True)
    with (LOCAL / 'sync.lock').open('w') as lock:
        try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError: return 'Another sync is already running'
        changed = coros_sync.sync()
        if not (LOCAL / 'auto-publish-enabled').exists():
            publisher.export()
            return f'{changed} changed activities; automatic publishing is off'
        if not changed: return '0 changed activities'
        result = publisher.publish()
        return f'{changed} changed activities; published {result["entries"]} entries, {len(result["held"])} held back'

if __name__ == '__main__':
    try: print(now(), run(), flush=True)
    except Exception as e: print(now(), 'Sync failed:', e, file=sys.stderr); sys.exit(1)
