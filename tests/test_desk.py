import base64, io, json, subprocess, sys, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import common, publisher, desk

TEMPLATES = {
    'Free writing': '---\ntitle: "{{title}}"\ntype: writing\nvisibility: private\ncreated: "{{date}}"\ntopics: []\n---\n',
    'Literature': '---\ntitle: "{{title}}"\ntype: literature\nvisibility: private\ncreator: ""\nmedium: book\nsource_url: ""\nconsumption_status: saved\nfinished: ""\ncreated: "{{date}}"\ntopics: []\n---\n',
    'Photo': '---\ntitle: "{{title}}"\ntype: photo\nvisibility: private\ndate: "{{date}}"\n---\n',
}


class DeskTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name); self.vault = self.root / 'vault'; self.local = self.root / '.local'
        for d in ('_System', 'Templates', 'Inbox', 'Library', 'Photos', 'Library/Projects', 'Media/Photos', 'Writing'): (self.vault / d).mkdir(parents=True)
        self.local.mkdir()
        for name, text in TEMPLATES.items(): (self.vault / 'Templates' / (name + '.md')).write_text(text)
        patches = [patch.object(common, 'vault', lambda: self.vault), patch.object(desk, 'vault', lambda: self.vault),
                   patch.object(publisher, 'vault', lambda: self.vault), patch.object(publisher, 'ROOT', self.root),
                   patch.object(publisher, 'LOCAL', self.local), patch.object(publisher, 'REPORT', self.local / 'last-build.json'),
                   patch.object(desk, 'ROOT', self.root)]
        for p in patches: p.start(); self.addCleanup(p.stop)

    def read(self, rel): return (self.vault / rel).read_bytes().decode()

    # -- visibility ----------------------------------------------------------
    def test_visibility_rewrites_only_that_line(self):
        original = '---\ntitle: "A: tricky title"\ntype: writing\n# keep this comment\ntags:\n  - one\n  - two\ndate: 2026-10-01\ncreated: \'2026-10-01T10:00:00\'\n---\n\nBody with  trailing spaces  \n\n- [ ] item\r\nmixed endings\n'
        (self.vault / 'Writing/A.md').write_bytes(original.encode())
        out = desk.set_visibility('Writing/A.md', True)
        self.assertEqual(out['visibility'], 'public')
        expected = original.replace('type: writing\n', 'type: writing\nvisibility: public\n')
        self.assertEqual(self.read('Writing/A.md'), expected)
        desk.set_visibility('Writing/A.md', False)
        self.assertEqual(self.read('Writing/A.md'), original.replace('type: writing\n', 'type: writing\nvisibility: private\n'))
        # Existing property is replaced in place, not duplicated.
        desk.set_visibility('Writing/A.md', True)
        self.assertEqual(self.read('Writing/A.md').count('visibility'), 1)
        self.assertEqual(self.read('Writing/A.md'), expected)

    def test_visibility_preserves_key_order_and_crlf(self):
        text = '---\r\ntitle: X\r\nvisibility: private\r\nzeta: 1\r\nalpha: 2\r\n---\r\nbody\r\n'
        (self.vault / 'Writing/X.md').write_bytes(text.encode())
        desk.set_visibility('Writing/X.md', True)
        self.assertEqual(self.read('Writing/X.md'), text.replace('private', 'public'))

    def test_public_default_visibility_is_removed_when_public(self):
        (self.vault / 'Training/Blocks').mkdir(parents=True)
        text = '---\ntitle: P\ntype: block\nstart: ""\n---\n\nBody\n'
        (self.vault / 'Training/Blocks/P.md').write_text(text)
        out = desk.set_visibility('Training/Blocks/P.md', False)
        self.assertEqual(out['visibility'], 'private')
        self.assertEqual(self.read('Training/Blocks/P.md'), text.replace('type: block\n', 'type: block\nvisibility: private\n'))
        out = desk.set_visibility('Training/Blocks/P.md', True)
        self.assertEqual(out['visibility'], 'public')
        self.assertEqual(self.read('Training/Blocks/P.md'), text)

    def test_visibility_without_frontmatter_and_bad_input(self):
        (self.vault / 'Writing/Plain.md').write_text('Just text\n')
        desk.set_visibility('Writing/Plain.md', True)
        self.assertEqual(self.read('Writing/Plain.md'), '---\nvisibility: public\n---\n\nJust text\n')
        with self.assertRaises(ValueError): desk.set_visibility('Writing/Plain.md', 'yes')

    # -- capture ---------------------------------------------------------------
    def test_write_creates_inbox_note_from_template(self):
        out = desk.capture_write({'title': 'A / B: idea'})
        self.assertEqual(out['path'], 'Inbox/A B idea.md')
        meta, body = common.parse_note(self.vault / out['path'])
        self.assertEqual((meta['title'], meta['type'], meta['visibility']), ('A / B: idea', 'writing', 'private'))
        self.assertRegex(meta['created'], r'^\d{4}-\d{2}-\d{2}$')
        self.assertEqual(desk.capture_write({'title': 'A / B: idea'})['path'], 'Inbox/A B idea 2.md')
        with self.assertRaises(ValueError): desk.capture_write({'title': '  '})

    def test_source_uses_fetched_title_and_literature_properties(self):
        with patch.object(desk, 'fetch_title', return_value='Fetched Page'):
            out = desk.capture_source({'url': 'https://example.com/a'})
        self.assertEqual(out['path'], 'Library/Fetched Page.md')
        meta, _ = common.parse_note(self.vault / out['path'])
        self.assertEqual((meta['type'], meta['source_url'], meta['visibility'], meta['consumption_status']), ('literature', 'https://example.com/a', 'private', 'saved'))
        self.assertEqual(meta['medium'], 'article')
        with patch.object(desk, 'fetch_title') as fetch:
            out = desk.capture_source({'url': 'https://example.com/b', 'title': 'Mine'})
            fetch.assert_not_called()
        self.assertEqual(out['path'], 'Library/Mine.md')
        with self.assertRaises(ValueError): desk.capture_source({'url': 'javascript:alert(1)'})

    def test_fetch_title_refuses_http_and_local_addresses(self):
        self.assertEqual(desk.fetch_title('http://example.com/'), '')
        self.assertEqual(desk.fetch_title('https://127.0.0.1/'), '')
        self.assertEqual(desk.fetch_title('https://localhost/'), '')

    def test_photos_are_saved_and_embedded_in_a_private_note(self):
        from PIL import Image
        buf = io.BytesIO(); Image.new('RGB', (8, 8), 'red').save(buf, 'JPEG')
        blob = base64.b64encode(buf.getvalue()).decode()
        names = [desk.import_photo({'name': 'IMG 1.jpg', 'data': blob})['file'], desk.import_photo({'name': 'IMG 1.jpg', 'data': blob})['file']]
        self.assertEqual(names, ['IMG-1.jpg', 'IMG-1 2.jpg'])
        self.assertTrue((self.vault / 'Media/Photos/IMG-1.jpg').is_file())
        out = desk.capture_photos({'files': names, 'title': 'Beach day', 'caption': 'Warm.'})
        self.assertRegex(out['path'], r'^Photos/\d{4}-\d{2}-\d{2} Beach day\.md$')
        meta, body = common.parse_note(self.vault / out['path'])
        self.assertEqual((meta['type'], meta['visibility'], meta['title']), ('photo', 'private', 'Beach day'))
        self.assertRegex(str(meta['date']), r'^\d{4}-\d{2}-\d{2}$')
        self.assertEqual(body, '![[IMG-1.jpg]]\n\n![[IMG-1 2.jpg]]\n\nWarm.\n')
        with self.assertRaises(ValueError): desk.import_photo({'name': 'x.jpg', 'data': base64.b64encode(b'not an image').decode()})
        with self.assertRaises(ValueError): desk.capture_photos({'files': ['missing.jpg']})

    # -- containment -----------------------------------------------------------
    def test_path_escape_rejected(self):
        (self.root / 'outside.md').write_text('secret')
        for bad in ('../outside.md', '/etc/passwd.md', 'Writing/../../outside.md', 'Writing\\x.md', 'Writing/note.txt', None):
            with self.assertRaises(ValueError, msg=bad): desk.note_path(bad)
            with self.assertRaises(ValueError, msg=bad): desk.set_visibility(bad, True)
        with self.assertRaises(ValueError): desk.capture_photos({'files': ['../../outside.md']})
        with self.assertRaises(ValueError): desk.capture_photos({'files': ['../x.jpg']})
        self.assertEqual((self.root / 'outside.md').read_text(), 'secret')
        # A title cannot steer the file out of its folder.
        out = desk.capture_write({'title': '../../escape'})
        self.assertEqual(Path(out['path']).parent.as_posix(), 'Inbox')

    # -- status and long operations -----------------------------------------------
    def test_status_lists_ready_and_obsidian_link(self):
        (self.vault / 'Writing/Atlas.md').write_text('---\ntitle: Atlas\ntype: writing\nvisibility: public\n---\n\nAn essay.\n')
        (self.vault / 'Writing/Hidden.md').write_text('---\ntitle: Hidden\ntype: writing\n---\n\nPrivate.\n')
        s = desk.compute_status()
        self.assertEqual([x['title'] for x in s['ready']], ['Atlas'])
        self.assertEqual(s['ready'][0]['folder'], 'Writing')
        self.assertTrue(s['ready'][0]['obsidian'].startswith('obsidian://open?vault='))
        self.assertIn('file=Writing%2FAtlas', s['ready'][0]['obsidian'])
        self.assertEqual((s['attention'], s['changed']), ([], []))
        desk.set_visibility('Writing/Atlas.md', False)
        self.assertEqual(desk.compute_status()['ready'], [])

    def test_failed_command_output_is_reported_verbatim(self):
        def fail(): subprocess.run(['sh', '-c', 'echo "fatal: rejected (non-fast-forward)" >&2; exit 3'], check=True)
        with self.assertRaisesRegex(RuntimeError, r'exit status 3[\s\S]*fatal: rejected \(non-fast-forward\)'): desk.run_captured(fail)
        self.assertEqual(desk.run_captured(lambda: 7), 7)

    def test_one_operation_at_a_time(self):
        d = desk.Desk()
        with d.operation('publishing'):
            with self.assertRaises(desk.Busy): d.sync()
        with d.operation('again'): pass


if __name__ == '__main__': unittest.main()
