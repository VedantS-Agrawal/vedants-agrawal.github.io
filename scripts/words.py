"""How much have I written? Counts words in the vault's prose, by type.

Counted as writing: essays, concepts, evergreen notes, reflections, daily notes, photo captions, pages,
and untyped notes (e.g. Inbox). Not counted: workout notes and Library entries (book/film details),
plus system files. Properties, comments, code, and link targets are stripped; link text counts.
Run: npm run words   (or: bash scripts/runtime.sh scripts/words.py [--public])
"""
import argparse, re
from collections import Counter
from common import notes

WRITING = {'writing', 'concept', 'evergreen', 'reflection', 'daily', 'photo', 'page', 'note', None, ''}
REFERENCE = {'literature', 'activity'}   # shown for reference, not in the total
LABEL = {'writing': 'essays & free writing', 'concept': 'concepts', 'evergreen': 'evergreen', 'reflection': 'reflections',
         'daily': 'daily notes', 'photo': 'photo captions', 'page': 'pages', None: 'untyped (inbox etc.)',
         'literature': 'library entries', 'activity': 'workout notes'}


def prose_words(body):
    t = re.sub(r'%%.*?%%|```.*?```|`[^`]*`|<[^>]+>', ' ', body, flags=re.S)
    t = re.sub(r'!\[\[[^\]]*\]\]|!\[[^\]]*\]\([^)]*\)', ' ', t)                        # embeds
    t = re.sub(r'\[\[([^\]|]*\|)?([^\]]*)\]\]', r'\2', t)                              # [[target|label]] → label
    t = re.sub(r'\[([^\]]*)\]\([^)]*\)', r'\1', t)                                      # [label](url) → label
    t = re.sub(r'https?://\S+', ' ', t)
    return len(re.findall(r"[A-Za-zÀ-ÿ0-9]+(?:['’-][A-Za-zÀ-ÿ0-9]+)*", t))


def count(public_only=False):
    words, files = Counter(), Counter()
    for n in notes():
        if n['path'] in ('Home.md', 'Website changes.md'): continue
        if public_only and str(n['meta'].get('visibility', '')).lower() != 'public': continue
        kind = n['meta'].get('type') or None
        key = kind if kind in WRITING | REFERENCE else ('note' if kind not in ('home', 'system', 'block', 'month') else None)
        if kind in ('home', 'system', 'block', 'month'): continue
        words[key] += prose_words(n['body']); files[key] += 1
    return words, files


if __name__ == '__main__':
    a = argparse.ArgumentParser(); a.add_argument('--public', action='store_true', help='only notes marked public'); args = a.parse_args()
    words, files = count(args.public)
    rows = sorted(((k, words[k], files[k]) for k in words if k not in REFERENCE), key=lambda r: -r[1])
    total = sum(r[1] for r in rows)
    print(f'Writing in the vault{" (public only)" if args.public else ""}\n')
    for k, w, f in rows: print(f'  {LABEL.get(k, k):24} {w:>8,} words  {f:>4} notes')
    print(f'  {"":24} {"-" * 8}\n  {"total":24} {total:>8,} words  ≈ {total / 250:,.0f} book pages\n')
    for k in ('literature', 'activity'):
        if files[k]: print(f'  not counted: {LABEL[k]:16} {words[k]:>7,} words  {files[k]:>4} notes')
