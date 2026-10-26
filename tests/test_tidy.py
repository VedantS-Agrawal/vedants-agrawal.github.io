import os, tempfile, time, unittest
from pathlib import Path
from unittest.mock import patch
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import common, tidy


class TidyTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.vault = Path(self.tmp.name); (self.vault / 'Inbox').mkdir(); (self.vault / '_System').mkdir()
        common.write_json(self.vault / '_System/publishing.json', {'notes': {'Inbox/Book.md': {'slug': 'library/book'}}})
        for p in [patch.object(common, 'vault', lambda: self.vault), patch.object(tidy, 'vault', lambda: self.vault)]: p.start(); self.addCleanup(p.stop)

    def put(self, name, kind, age=3600):
        p = self.vault / 'Inbox' / name; common.write_note(p, {'title': p.stem, **({'type': kind} if kind else {})}, 'x')
        t = time.time() - age; os.utime(p, (t, t)); return p

    def test_files_by_type_and_keeps_address(self):
        self.put('Book.md', 'literature'); self.put('Thoughts.md', 'literature-note'); self.put('Idea.md', 'concept')
        moved = dict(tidy.tidy())
        self.assertEqual(moved, {'Inbox/Book.md': 'Library/Book.md', 'Inbox/Thoughts.md': 'Notes/Literature Notes/Thoughts.md', 'Inbox/Idea.md': 'Notes/Concepts/Idea.md'})
        self.assertEqual(common.state()['notes']['Library/Book.md']['slug'], 'library/book')

    def test_leaves_untyped_recent_and_clashing(self):
        self.put('Loose.md', None); self.put('Fresh.md', 'concept', age=30)
        (self.vault / 'Library').mkdir(); (self.vault / 'Library/Dup.md').write_text('existing')
        self.put('Dup.md', 'literature')
        moved = dict(tidy.tidy())
        self.assertEqual(moved, {'Inbox/Dup.md': 'Library/Dup 2.md'})
        self.assertTrue((self.vault / 'Inbox/Loose.md').exists() and (self.vault / 'Inbox/Fresh.md').exists())
        self.assertEqual((self.vault / 'Library/Dup.md').read_text(), 'existing')


if __name__ == '__main__': unittest.main()
