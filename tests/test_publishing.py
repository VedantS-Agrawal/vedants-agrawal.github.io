import json, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import publisher, common


class PublicationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name); self.vault = self.root / 'vault'; self.vault.mkdir()
        self.local = self.root / '.local'; self.local.mkdir()
        (self.vault / '_System').mkdir()
        common.write_json(self.vault / '_System/publishing.json', {'notes': {}, 'lastPublished': None})
        for p in [patch.object(common, 'vault', lambda: self.vault), patch.object(publisher, 'vault', lambda: self.vault),
                  patch.object(publisher, 'ROOT', self.root), patch.object(publisher, 'LOCAL', self.local),
                  patch.object(publisher, 'REPORT', self.local / 'last-build.json')]:
            p.start(); self.addCleanup(p.stop)

    def note(self, rel, body, kind='writing', **meta):
        common.write_note(self.vault / rel, {'title': Path(rel).stem, 'type': kind, **meta}, body)

    def entries(self):
        return json.loads((self.root / 'content/site-data.json').read_text())['entries']

    def test_visibility_and_folder_defaults(self):
        self.note('Writing/Draft.md', 'private words')
        self.note('Writing/Essay.md', 'public words', visibility='public')
        self.note('Training/Blocks/Base.md', 'a block', 'block', start='2026-09-01', end='2026-10-01')
        self.note('Training/Blocks/Hidden.md', 'x', 'block', visibility='private')
        titles = {e['title'] for e in (publisher.export(), self.entries())[1]}
        self.assertEqual(titles, {'Essay', 'Base'})

    def test_private_link_publishes_note_with_inert_text(self):
        self.note('Writing/Public.md', 'See [[Secret|the secret]].', visibility='public')
        self.note('Writing/Secret.md', 'private words')
        result = publisher.export()
        self.assertEqual(result['held'], [])
        page = (self.root / 'content/notes/public.md').read_text()
        self.assertIn('<span class="link-private" title="Not public yet">the secret</span>', page)
        self.assertNotIn('/notes/secret', page)
        self.assertNotIn('private words', (self.root / 'content/site-data.json').read_text())

    def test_link_to_held_note_becomes_inert(self):
        self.note('Writing/A.md', 'see [[B]]', visibility='public')
        self.note('Writing/B.md', '<script>x</script>', visibility='public')
        held = {h['path'] for h in publisher.export()['held']}
        self.assertEqual(held, {'Writing/B.md'})
        self.assertIn('link-private', (self.root / 'content/notes/a.md').read_text())

    def test_hub_links_in_notes(self):
        self.note('Writing/A.md', 'I [[Training|train]] and [read](/library/).', visibility='public')
        publisher.export()
        body = (self.root / 'content/notes/a.md').read_text()
        self.assertIn('[train](/stream/training/)', body); self.assertIn('[read](/library/)', body)

    def test_started_date_orders_notes(self):
        self.note('Notes/Idea.md', 'x', 'concept', visibility='public', created='2023-02-01')
        publisher.export()
        self.assertEqual(self.entries()[0]['date'], '2023-02-01')

    def test_embedded_photo_is_stripped_of_metadata(self):
        from PIL import Image
        (self.vault / 'Media/Photos').mkdir(parents=True)
        img = Image.new('RGB', (50, 40), 'orange'); exif = Image.Exif(); exif[0x8825] = {1: 'N', 2: (29.0, 15.0, 0.0)}
        img.save(self.vault / 'Media/Photos/p.jpg', exif=exif)
        self.note('Photos/Beach.md', '![[p.jpg]]', 'photo', visibility='public', date='2026-10-01')
        publisher.export()
        out = list((self.root / 'content/media').glob('*.webp'))
        self.assertEqual(len(out), 1)
        self.assertFalse(Image.open(out[0]).getexif())
        self.assertEqual(self.entries()[0]['images'], ['/media/' + out[0].name])

    def test_unreferenced_private_photo_never_ships(self):
        (self.vault / 'Media/Photos').mkdir(parents=True); (self.vault / 'Media/Photos/x.jpg').write_bytes(b'x')
        self.note('Writing/Essay.md', 'no images', visibility='public')
        publisher.export()
        self.assertFalse((self.root / 'content/media').exists() and any((self.root / 'content/media').iterdir()))

    def test_activity_publishes_fields_not_coordinates(self):
        self.note('Training/Activities/2026-10-01 Run.md', 'Felt good.', 'activity', id='123', date='2026-10-01')
        common.write_json(self.vault / '_System/activities/123.json', {
            'public': {'id': '123', 'date': '2026-10-01', 'sport': 'Run', 'group': 'run', 'durationS': 1200, 'distanceKm': 3.2},
            'detail': {'metrics': {'avgHr': 150}, 'laps': []},
            'private': {'raw': {'latitude': 29.123, 'longitude': -94.456}}})
        publisher.export()
        blob = ''.join(p.read_text() for p in (self.root / 'content').rglob('*') if p.is_file())
        self.assertNotIn('29.123', blob); self.assertNotIn('latitude', blob)
        self.assertIn('Felt good.', blob)
        t = json.loads((self.root / 'content/data/training.json').read_text())
        self.assertEqual(t['activities'][0]['hasNote'], True)

    def test_home_intro_links_hubs_and_hides_private(self):
        self.note('Writing/Essay.md', 'x', visibility='public')
        self.note('Writing/Secret.md', 'x')
        common.write_note(self.vault / 'Home.md', {'title': 'Home', 'type': 'home'}, 'I [[Training|run]], wrote [[Essay]], hid [[Secret]] <b>.')
        publisher.export()
        intro = json.loads((self.root / 'content/site-data.json').read_text())['introHtml']
        self.assertIn('<a href="/stream/training/">run</a>', intro)
        self.assertIn('<a href="/notes/essay.html">Essay</a>', intro)
        self.assertIn('hid Secret &lt;b&gt;', intro)

    def test_cover_from_vault_image(self):
        from PIL import Image
        (self.vault / 'Media/Photos').mkdir(parents=True); Image.new('RGB', (20, 30)).save(self.vault / 'Media/Photos/c.jpg')
        self.note('Library/Book.md', '', 'literature', visibility='public', cover='c.jpg')
        publisher.export()
        cover = self.entries()[0]['cover']
        self.assertTrue((self.root / 'content' / cover.lstrip('/')).is_file())

    def test_tags_come_only_from_yaml(self):
        self.note('Notes/Radiology/Lab.md', 'uses #ml', 'writing', visibility='public', tags=['ml', 'Radiology'])
        self.note('Library/Book.md', '', 'literature', visibility='public', medium='book', tags='philosophy')
        tags = {e['title']: e['tags'] for e in (publisher.export(), self.entries())[1]}
        self.assertEqual(tags, {'Lab': ['ml', 'radiology'], 'Book': ['philosophy']})

    def test_traversal_and_raw_html_are_held(self):
        self.note('Writing/A.md', '[x](../Secret.md)', visibility='public')
        self.note('Writing/B.md', '<img src="/secret">', visibility='public')
        self.note('Writing/C.md', 'a < b is fine', visibility='public')
        held = {h['path'] for h in publisher.export()['held']}
        self.assertEqual(held, {'Writing/B.md'})                  # raw HTML is held
        self.assertNotIn('Secret', (self.root / 'content/notes/a.md').read_text().split('---')[-1].replace('x', ''))  # traversal → inert text


if __name__ == '__main__': unittest.main()
