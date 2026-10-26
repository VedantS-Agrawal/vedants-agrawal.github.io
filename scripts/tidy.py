"""File notes out of Inbox/ by their `type`, so new notes never need a folder decision.

Only notes directly in Inbox/ move, only once they have a type, and only after they've been left alone
for a few minutes (so nothing moves while you're typing). Published addresses follow the move.
Run: bash scripts/runtime.sh scripts/tidy.py [--dry-run]
"""
import argparse, time
from pathlib import Path
from common import vault, parse_note, state, save_state

FOLDERS = {
    'literature': 'Library',
    'literature-note': 'Notes/Literature Notes',
    'concept': 'Notes/Concepts',
    'evergreen': 'Notes/Evergreen',
    'reflection': 'Reflections',
    'writing': 'Writing',
    'photo': 'Photos',
    'daily': 'Daily',
    'month': 'Monthly',
    'block': 'Training/Blocks',
}
QUIET_SECONDS = 600


def tidy(dry_run=False, now=None):
    base = vault(); inbox = base / 'Inbox'; moved = []
    if not inbox.is_dir(): return moved
    now = now or time.time()
    s = state(); notes_state = s.setdefault('notes', {})
    for p in sorted(inbox.glob('*.md')):
        if now - p.stat().st_mtime < QUIET_SECONDS: continue
        try: meta, _ = parse_note(p)
        except Exception: continue
        folder = FOLDERS.get(str(meta.get('type') or '').strip())
        if not folder: continue
        dest_dir = base / folder; dest = dest_dir / p.name; n = 2
        while dest.exists(): dest = dest_dir / f'{p.stem} {n}.md'; n += 1
        old_rel, new_rel = p.relative_to(base).as_posix(), dest.relative_to(base).as_posix()
        moved.append((old_rel, new_rel))
        if dry_run: continue
        dest_dir.mkdir(parents=True, exist_ok=True)
        p.rename(dest)
        if old_rel in notes_state: notes_state[new_rel] = notes_state.pop(old_rel)   # keep its web address and dates
    if moved and not dry_run: save_state(s)
    return moved


if __name__ == '__main__':
    a = argparse.ArgumentParser(); a.add_argument('--dry-run', action='store_true'); args = a.parse_args()
    for old, new in tidy(args.dry_run): print(f'{old} → {new}')
