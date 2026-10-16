"""Automatic note dates, written into each note's properties so they show in Obsidian.

  created  — when the note was started: filled once from the file's creation time if missing
  updated  — when the note was last edited: follows the file's modification day
  published — written by publisher.finalize() after a note's first successful publish

Edits are line-level inside the frontmatter (no YAML re-dump), and a note is only touched when a
value actually changes, so running this every few hours leaves untouched notes alone.
Run: bash scripts/runtime.sh scripts/dates.py [--dry-run]
"""
import argparse, os, re
from datetime import date
from pathlib import Path
from common import vault

SKIP = ('_System/', 'Templates/', 'Guide/', 'Training/Activities/', '.obsidian/', '.trash/')
SKIP_FILES = ('Home.md', 'Website changes.md')
FRONT = re.compile(r'\A---[ \t]*\r?\n(.*?\r?\n)?---[ \t]*(?:\r?\n|\Z)', re.S)


def _day(ts): return date.fromtimestamp(ts).isoformat()


def get_property(text, key):
    m = FRONT.match(text)
    if not m or not m.group(1): return None
    hit = re.search(rf'^{re.escape(key)}:[ \t]*(.*)$', m.group(1), re.M)
    return hit.group(1).strip().strip('"\'') if hit else None


def _split(text):
    """(frontmatter lines or None, rest of the file verbatim)."""
    if not re.match(r'---[ \t]*\r?\n', text): return None, text
    lines = text.split('\n')
    for i in range(1, len(lines)):
        if lines[i].rstrip('\r').strip() == '---':
            return lines[1:i], '\n'.join(lines[i + 1:])
    return None, text


def set_property(path, key, value, text=None, keep_mtime=False):
    """Set `key: "value"` in the note's frontmatter (adding frontmatter if there is none). Returns True if changed."""
    path = Path(path); text = path.read_text(encoding='utf-8') if text is None else text
    if get_property(text, key) == str(value): return False
    line = f'{key}: "{value}"'
    fm, rest = _split(text)
    if fm is None:
        new = f'---\n{line}\n---\n' + ('\n' if not text.startswith('\n') else '') + text
    else:
        idx = next((i for i, l in enumerate(fm) if re.match(rf'{re.escape(key)}:', l)), None)
        if idx is None: fm.append(line)
        else: fm[idx] = line
        new = '---\n' + '\n'.join(fm) + '\n---\n' + rest
    st = path.stat()
    path.write_text(new, encoding='utf-8')
    if keep_mtime: os.utime(path, (st.st_atime, st.st_mtime))
    return True


def stamp(dry_run=False):
    base = vault(); changed = []
    for p in sorted(base.rglob('*.md')):
        rel = p.relative_to(base).as_posix()
        if rel.startswith(SKIP) or rel in SKIP_FILES or any(part.startswith('.') for part in p.relative_to(base).parts): continue
        st = p.stat(); text = p.read_text(encoding='utf-8')
        born = _day(getattr(st, 'st_birthtime', st.st_mtime)); edited = _day(st.st_mtime)
        todo = []
        created = get_property(text, 'created')
        if not created or '{{' in created: todo.append(('created', min(born, edited)))
        if get_property(text, 'updated') != edited: todo.append(('updated', edited))
        if not todo: continue
        changed.append((rel, todo))
        if dry_run: continue
        for key, value in todo:
            set_property(p, key, value, keep_mtime=True)   # keep mtime so "updated" doesn't chase its own write
            text = p.read_text(encoding='utf-8')
    return changed


if __name__ == '__main__':
    a = argparse.ArgumentParser(); a.add_argument('--dry-run', action='store_true'); args = a.parse_args()
    out = stamp(args.dry_run)
    for rel, todo in out: print(rel, ' '.join(f'{k}={v}' for k, v in todo))
    print(f'{len(out)} notes {"would change" if args.dry_run else "updated"}')
