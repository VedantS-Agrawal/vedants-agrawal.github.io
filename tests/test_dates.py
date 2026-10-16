import os, tempfile, time, unittest
from pathlib import Path
from unittest.mock import patch
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import dates


class DateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.vault = Path(self.tmp.name); p = patch.object(dates, 'vault', lambda: self.vault); p.start(); self.addCleanup(p.stop)

    def test_fills_created_and_updated_preserving_body_and_order(self):
        f = self.vault / 'Writing/A.md'; f.parent.mkdir()
        f.write_text('---\ntitle: A\ntype: writing # keep\n---\n\nBody line.\n')
        t = time.mktime((2024, 3, 5, 12, 0, 0, 0, 0, -1)); os.utime(f, (t, t))
        dates.stamp()
        text = f.read_text()
        self.assertTrue(text.startswith('---\ntitle: A\ntype: writing # keep\n'))
        self.assertIn('updated: "2024-03-05"', text); self.assertIn('created: "', text)
        self.assertTrue(text.endswith('---\n\nBody line.\n'))
        self.assertEqual(f.stat().st_mtime, t)            # our write doesn't count as an edit
        self.assertEqual(dates.stamp(), [])                # idempotent

    def test_keeps_existing_created_and_adds_frontmatter_when_missing(self):
        a = self.vault / 'A.md'; a.write_text('---\ncreated: "2023-01-02"\n---\nx\n')
        b = self.vault / 'B.md'; b.write_text('just text\n')
        dates.stamp()
        self.assertIn('created: "2023-01-02"', a.read_text())
        self.assertTrue(b.read_text().startswith('---\ncreated: "'))
        self.assertTrue(b.read_text().endswith('just text\n'))

    def test_skips_system_and_activities(self):
        for rel in ('Training/Activities/x.md', '_System/s.md', 'Templates/t.md', 'Home.md'):
            p = self.vault / rel; p.parent.mkdir(parents=True, exist_ok=True); p.write_text('---\ntitle: x\n---\n')
        self.assertEqual(dates.stamp(), [])


if __name__ == '__main__': unittest.main()
