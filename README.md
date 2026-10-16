# Vedant — personal site

[vedants-agrawal.github.io](https://vedants-agrawal.github.io), published from a private Obsidian vault in iCloud.

- **Use it:** `Guide/Walkthrough.md` in the vault.
- **How it fits together:** [docs/Architecture.md](docs/Architecture.md) (vault rules, data contracts, routes).
- **Why it's built this way:** [docs/Design decisions.md](docs/Design%20decisions.md).
- **Change requests:** `Website changes.md` in the vault.

## Commands

| | |
| --- | --- |
| `Open Publishing Desk.command` | Local desk: exceptions, capture, sync, preview, publish |
| `npm run build` | Export the vault and build `dist/` |
| `npm run publish` | Build, commit, push (GitHub Pages deploys `dist/`) |
| `npm run sync` | One COROS sync (+ publish if scheduling is on) |
| `npm run schedule -- install` / `remove` | Sync and publish every 3 hours on this Mac |
| `npm run test:site` | Tests |

Vault path lives in ignored `site.local.json`. COROS tokens, FIT files, and logs stay in `.local/` or the vault's `_System/`, never in Git.

## Layout

`web/` public interface · `scripts/` publisher, COROS importer, desk · `quartz/` note renderer · `vault-starter/` templates and Obsidian settings for a fresh vault · `content/` and `dist/` generated.

## Credits

Built on [Quartz](https://github.com/jackyzha0/quartz) (MIT, `LICENSE.txt`). Several ideas (linked-intro homepage, writing index, library galleries, training season strip, daily wellness log, search palette, note metadata) adapted from [aarnphm.xyz](https://github.com/aarnphm/aarnphm.github.io) (Apache-2.0). The radiology tools live in [pneumonia-image-lab](https://github.com/VedantS-Agrawal/pneumonia-image-lab).
