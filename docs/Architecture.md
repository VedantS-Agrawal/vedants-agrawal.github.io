# Architecture and data contracts

This is the working contract between the vault, the importer, the publisher, the public interface, and the publishing desk. When one part changes its output, this file changes with it.

```
Phone / laptop ──iCloud──▶ Obsidian vault (private, authoritative)
                               │
          COROS ──importer──▶  │  Training/Activities/*.md + _System/activities/*.json
                               │
                         publisher (laptop)
                               │  only public notes, their embedded media,
                               │  and the public activity fields
                               ▼
                 content/ ──Quartz──▶ dist/ ◀── web/ (custom views)
                                         │
                                  git push main ──▶ GitHub Pages
```

## 1. Vault conventions

| Folder | Holds | Default visibility (by `type`) |
| --- | --- | --- |
| `Inbox/` | Anything captured quickly | private |
| `Writing/` | Essays and free writing | private |
| `Library/` | One note per book, article, film, video, podcast, or paper | private |
| `Notes/Concepts/`, `Notes/Evergreen/` | Developing ideas | private |
| `Reflections/` | Reflections | private |
| `Daily/` | Daily notes | private |
| `Photos/` | Photo entries (a note that embeds one or more images) | private |
| `Training/Activities/` | One note per COROS activity, created by the importer | **public** |
| `Training/Blocks/` | Named training periods (`start`, `end`) | **public** |
| `Monthly/` | Optional `YYYY-MM.md` introductions for monthly archives | **public** |
| `Media/Photos/`, `Media/Audio/` | Original files | published only when embedded in a public note |
| `Templates/`, `Guide/`, `_System/` | Never published | — |

**The publication switch is the `visibility` property.** `visibility: public` publishes a note; `visibility: private` keeps it in the vault. When the property is absent, the default comes from the note's `type`: `activity`, `block`, and `month` are public; everything else is private. Folders are for your own organization only. This works identically on the phone and the laptop, so nothing has to be toggled in a separate tool.

Activity notes are created and refreshed by the importer. The importer owns their properties; you own the body. The body is your post-workout note (paste the COROS voice transcript here) and is published with the activity. Embed an audio file with `![[recording.m4a]]` to give the activity page a player.

Notes are identified by stable website addresses (`slug`) recorded in `_System/publishing.json` the first time they publish. Renaming a note or changing its title never changes its address.

## 2. Publication rules

1. Candidate notes come from §1. Everything else is skipped silently.
2. A candidate that links to a private note, embeds a missing file, or contains raw HTML is **held back** and reported in the desk's *Needs attention* list. It does not stop the rest of the site from publishing.
3. Images embedded in a public note are resized to 2000 px, re-encoded as WebP, and stripped of all metadata, including location. Audio is copied unchanged. Files are renamed by content hash.
4. Activity notes publish only the fields in §4. Coordinates, routes, and raw responses never leave `_System/`.
5. Dates: `date` is when something occurred (activities, reflections, photos, `date:` property); `published` is the first successful publication; `updated` changes only when the public content changes.

## 3. `site-data.json` (homepage, stream, library, projects, archive)

```jsonc
{
  "name": "Vedant Agrawal",
  "intro": "…", "description": "…",
  "built": "2026-10-15T12:00:00-05:00",
  "entries": [
    {
      "type": "writing|reflection|photo|literature|concept|evergreen|project|activity|page|month|block",
      "title": "…", "url": "/notes/slug",            // Quartz page, no .html
      "date": "2026-10-11",                          // occurred/published day used for ordering
      "published": "ISO", "updated": "ISO",
      "summary": "first paragraph, ≤240 chars",
      "image": "/media/<hash>.webp",                 // optional, first embedded image
      "images": ["/media/…"],                        // photo entries: all images
      "topics": [],
      // literature
      "creator": "", "medium": "book|article|film|video|podcast|paper", "consumption_status": "saved|reading|finished|abandoned", "finished": "YYYY-MM-DD",
      // project
      "status": "exploring|active|paused|completed|archived", "project_url": "https://…",
      // activity: a copy of the training.json summary (see §4)
      "activity": { }
    }
  ]
}
```

## 4. Training data

`/data/training.json` — every public activity, compact, for the history page and homepage summary:

```jsonc
{
  "coverage": { "start": "2026-08-21", "end": "2026-10-13", "lastSync": "ISO" },
  "blocks": [ { "title": "Base building", "start": "YYYY-MM-DD", "end": "YYYY-MM-DD", "url": "/training/blocks/…" } ],
  "activities": [
    {
      "id": "480973207904485777", "url": "/stream/training/2026-10-11-outdoor-run",
      "date": "2026-10-11", "start": 1791764137,      // unix seconds, optional
      "sport": "Outdoor Run", "group": "run|ride|swim|strength|walk|hike|other",
      "durationS": 669, "distanceKm": 1.63, "elevGainM": 6,
      "avgHr": 161, "load": 35, "title": "Galveston Run",
      "hasNote": true, "hasAudio": false
    }
  ]
}
```

`/data/activities/<id>.json` — one per activity, loaded only on its page:

```jsonc
{
  "id": "…", "sport": "Outdoor Run", "group": "run", "date": "2026-10-11", "title": "Galveston Run",
  "metrics": {                       // every key optional; absent means not recorded
    "durationS": 669, "movingS": 660, "distanceKm": 1.63,
    "paceSPerKm": 410, "movingPaceSPerKm": 403, "adjustedPaceSPerKm": 412, "bestKmSPerKm": 407,
    "speedKmh": 28.5,
    "avgHr": 161, "maxHr": 170,
    "cadence": 142, "strideM": 1.03, "power": 207, "normalizedPower": 210,
    "elevGainM": 6, "elevLossM": 6, "calories": 135,
    "load": 35, "aerobicTE": 2.0, "anaerobicTE": 0.3, "focus": "Base"
  },
  "laps": [ { "index": 1, "distanceKm": 1.0, "timeS": 405, "paceSPerKm": 405, "speedKmh": 8.9, "avgHr": 158, "maxHr": 165, "cadence": 142, "power": 205 } ],
  "series": {                        // downsampled to ≤ 600 points, from the FIT file; omitted until downloaded
    "t": [0, 5, 10],                 // seconds from start
    "hr": [], "speedKmh": [], "elevM": [], "power": [], "cadence": [], "distanceKm": []
  }
}
```

Private storage per activity: `_System/activities/<id>.json` holds `{source, importedAt, public: {…summary…}, detail: {metrics, laps}, series: {…}, fit: {downloaded: bool, file}, private: {raw…}}`. FIT originals live in `_System/fit/<id>.fit`. COROS allows about 50 FIT downloads per day, so the importer downloads newest-first and resumes on later runs.

## 5. Site routes

| Route | Renderer |
| --- | --- |
| `/` | `web/app.js` — introduction, recent entries (training compacted by day), current projects, this week in training |
| `/stream/` | timeline of writing, reflections, photos, library updates, project updates, and daily training |
| `/stream/training/` | training history: year ribbon, weekly volume with block bands, year-over-year cumulative, sport mix, monthly totals, activity list |
| `/stream/training/<slug>` | Quartz page + `web/article.js` activity panel (metrics, charts, splits, note, audio) |
| `/library/` | shelves by status; medium filter |
| `/projects/` | project index from project entries |
| `/archive/`, `/archive/YYYY-MM/` | year index; self-assembled monthly pages |
| any other note | Quartz page styled by `web/site.css` + `web/article.js` |

## 6. Publishing desk

Local only (`127.0.0.1`, random port, per-session token). Shows exceptions, not everything:

- **Ready** — public notes never published.
- **Changed** — published notes whose public content changed since the last publish.
- **Needs attention** — held-back notes with the reason; failed COROS syncs.
- **Recent** — last publication, last COROS sync, activity coverage, FIT backlog.

Plus quick capture (write, save a source, add photos, new project), *Sync COROS*, *Preview* (local server on the built `dist/`), and *Publish*.

## 7. Automation

A LaunchAgent runs `scripts/auto_sync.py` every three hours while the laptop is awake: COROS sync → build → commit and push when something public changed. The lock file prevents overlapping runs. Logs go to `.local/logs/`.

## 8. Additions adapted from aarnphm.xyz (Apache-2.0 code, ideas only)

**Homepage intro.** `Home.md`'s *body* is the homepage introduction. Wikilinks in it may point at public notes or at the hub names `[[Stream]]`, `[[Writing]]`, `[[Library]]`, `[[Training]]`, `[[About]]`, `[[Colophon]]` (aliases allowed: `[[Training|running]]`). The publisher renders it to restricted HTML (`p`, `a`, `em`, `strong`) as `site-data.json` → `introHtml`. Hub routes: Stream `/stream/`, Writing `/writing/`, Library `/library/`, Training `/stream/training/`, About `/about.html`, Colophon `/colophon.html`.

**Entry additions.** Every entry gets `words` (body word count) and `tags` (lowercase list from the YAML `tags` property only). Literature entries may have `cover` — a public image URL (`/media/<hash>.webp` when the `cover` property names a vault image, or an `https://` URL kept as-is).

**Writing index.** `/writing/` lists entries of type `writing` and `evergreen` and `reflection` that are public: title, date, topics; text filter. Nav: Stream · Writing · Library · About.

**Wellness** (`site.config.json` → `wellnessPublic: true`). The importer stores `_System/wellness/YYYY-MM-DD.json` = `{source, importedAt, public: {…}, private: {raw}}`. The publisher writes `/data/wellness.json`:

```jsonc
{
  "coverage": {"start": "YYYY-MM-DD", "end": "YYYY-MM-DD"},
  "days": [
    { "date": "2026-10-13",
      "sleepS": 23580, "deepS": 5400, "lightS": 12540, "remS": 5640, "awakeS": 3545, "sleepScore": 69,
      "hrv": 65, "hrvLow": 50, "hrvHigh": 80,        // nightly average and the COROS normal range
      "restingHr": 54, "avgHr": 70, "stress": 30, "steps": 7759, "calories": 2500,
      "acuteLoad": 577, "chronicLoad": 794, "loadRatio": 0.73, "recoveryPct": 80 }
  ]
}
```

Every field optional. In the stream and on the homepage each day's training group shows a compact wellness line (sleep · HRV · resting HR · load) that expands to the full day card. Training history adds an HRV / resting-HR trend.

**Search and shortcuts** (`web/palette.js` + `web/palette.css`, loaded on every page). ⌘K / Ctrl-K or `/` opens a search palette over `site-data.json` (title, summary, `search`, topics) plus hub pages. `g h` home, `g s` stream, `g w` writing, `g l` library, `g t` training, `g a` archive, `?` shortcut help. Ignored while typing in inputs.

**Note metadata strip** (Quartz pages, `article.js`): type, topics, published, updated (if different), reading time (`words`/230), permalink copy, citation copy (BibTeX). Data comes from the matching entry in `/site-data.json`.

**Training season strip** (top of `/stream/training/`): one thin vertical line per session across the selected year, height = duration, grouped/colored by sport group; under it per-sport totals with small inline-SVG icons (count · distance or time); and a reference table of race distances (sprint, olympic, 70.3, ironman — swim/bike/run km) with your longest swim/ride/run so far marked against them.


## 9. No projects

There is no project type. Work like the radiology tools lives as ordinary notes (e.g. `Notes/Radiology/`, `type: writing`, `visibility: public`). Their original `/projects/<slug>` addresses are kept via `_System/publishing.json`; `/projects/` redirects to Writing.

## 10. Links, tags, photos (interactive layer)

`/data/links.json` (publisher):

```jsonc
{
  "nodes": [ { "url": "/notes/x", "title": "…", "type": "evergreen" } ],      // every public non-activity entry
  "edges": [ ["/notes/x", "/library/y"] ],                                     // from → to, public targets only
  "backlinks": { "/library/y": [ { "url": "/notes/x", "title": "…", "type": "…",
                                   "context": "…sentence with ⁣linked words⁤ marked…" } ] }
}
```

`context` is plain text; U+2063 … U+2064 wrap the words that were the link (render them highlighted). Entry `url`s have no `.html`; pages live at `url + '.html'`.

New app-shell routes: `/photos/` (gallery of `type: photo` entries; each has `images: ["/media/…webp"]`, `summary`, `date`) and `/tags/` + `/tags/<tag>/` (one shell per tag in use).

Auto-publish: the scheduled run publishes when COROS changed **or** any public note is ready/changed — so a photo note made on the phone goes live on the next run.

## 11. Strength and body weight

**Hevy** (`scripts/hevy_sync.py`, read-only, API key in `.local/hevy.key` written by `scripts/set_hevy_key.sh`). Endpoints used: `GET /v1/workouts/count`, `GET /v1/workouts?page&pageSize` (page size is capped at 10), `GET /v1/workouts/events?since=` (updated and deleted workouts). The first run reads every page; later runs read events since the stored cursor, and fall back to a full read if the local count drifts from `/workouts/count`. Without a key the sync does nothing and the status reads `hevy: not connected`.

Private store `_System/hevy/<id>.json`, status `_System/hevy-status.json` (`state`, `lastSync`, `cursor`, `count`, `matched`, `lastError`):

```jsonc
{ "importedAt": "ISO",
  "public": { "id": "uuid", "title": "Lower", "date": "2026-10-16", "start": 1791764137, "end": 1791767612, "durationS": 3475,
              "exercises": [ { "title": "Bench Press (Barbell)", "sets": [ { "type": "warmup|normal|failure|dropset", "reps": 8, "weightLb": 132.3, "distanceMi": 0.5, "durationS": 60 } ] } ],
              "volumeLb": 31095.0, "setCount": 15 },          // volume and setCount skip warm-ups; weights are kg x 2.20462, 1 decimal
  "private": { "raw": { /* the Hevy response: descriptions, notes, routine ids */ } } }
```

*Matching.* A Hevy workout that overlaps a COROS **strength** activity (start/end padded by 20 minutes) is attached to it through `_System/hevy-matches.json` (`{hevyId: corosId}`, sticky); the COROS store is never edited. Other COROS activities (cardio before or after the lifts) are not matched. Every other workout becomes `Training/Activities/YYYY-MM-DD <title>.md` with importer-owned properties `title, type: activity, id: hevy-<id>, date, sport: Strength, source_app: hevy, duration, volume_lb, sets`; the body and any other property are yours. Such notes are public by default like COROS activities (`group: strength`). A workout that already has a note is never matched later.

*Muscles worked.* Each workout's exercises carry an `exercise_template_id`. Templates come from `GET /v1/exercise_templates?page&pageSize=100` (single `GET /v1/exercise_templates/{id}` for any id the list lacks) and are cached privately in `_System/hevy-templates.json` (`{templateId: {title, primary, secondary: []}}`; outside `_System/hevy/` because that folder holds one file per workout); only ids not yet cached are fetched. Muscle groups are Hevy's own (`abdominals, shoulders, biceps, triceps, forearms, quadriceps, hamstrings, calves, glutes, abductors, adductors, lats, upper_back, traps, lower_back, chest, neck`; `cardio`, `full_body`, `other` are ignored). Each store entry gains a top-level `muscles: {group: {primary, secondary}}` of working-set counts (warm-ups skipped), never published as is.

*Estimated 1RM.* Epley `w x (1 + reps/30)` per working set (not warm-ups), 1 to 12 reps (a single is its own maximum); one value per exercise per day (the best).

**Weight** (`scripts/weight.py`). Private store `_System/weight/YYYY-MM-DD.json` = `{kg, lb, source: "renpho|coros|csv", importedAt, private?: {readings: [...]}}`, status `_System/weight-status.json`. Per day the best source wins: `renpho` > `coros` > `csv`.
- `coros`: `queryUserInfo` (`Weight: 80.1 kg`), at most once a day; a new day always writes a file, an existing day changes only if the value moved.
- `csv`: any `*.csv` in `_System/imports/renpho/` (README created there), read once per file hash. Date and weight columns are found by header; the unit comes from the header (`kg`/`lb`) or a unit column, else kg.
- `renpho` (experimental): the RENPHO Health cloud API as documented by the open-source clients forkerer/RenphoGarminSync-CLI and jegork/renpho-mcp. POST `https://cloud.renpho.com/<path>` with `{"encryptData": base64(AES-128-ECB(json))}` (the key is a constant of the app); success is `{code: 101, data: <encrypted>}`. Calls: `renpho-aggregation/user/login`, `renpho-aggregation/device/count`, `RenphoHealth/scale/queryAllMeasureDataList` (200 per page, only rows whose `bUserId` is the account). Weight unit per row (`weightUnit` 1 kg, 2 lb). The email is in `.local/renpho.json` (`{email}` only), the password in the macOS Keychain (service `renpho-personal-site`, set with `scripts/set_renpho_login.sh`); it is never written to a file or printed. At most one attempt per 6 hours. Body-fat, muscle and the other composition values are stored under `private.readings` only. Any failure (login, decryption, schema change) is recorded in `lastError` and the other sources carry on.

**Public outputs** (built by the publisher; `weight.json` is written with 2 or more days, `strength.json` with any workout):

```jsonc
// /data/weight.json: TREND ONLY. 7-day exponential smoothing (alpha 0.25 per day, gaps compound); deltaLb = smoothed value minus the first day's.
{ "start": "2026-08-21", "points": [ { "date": "2026-08-21", "deltaLb": 0.0 }, { "date": "2026-08-22", "deltaLb": -0.3 } ] }

// /data/strength.json
{ "weekly": [ { "week": "2026-10-12", "volumeLb": 34463, "sets": 18, "sessions": 2 } ],       // week = Monday
  "exercises": [ { "title": "Lat Pulldown (Cable)", "sessions": 11,                           // top 12 by sessions
                   "best": { "e1rmLb": 192.4, "weightLb": 148, "reps": 9, "date": "2026-10-15" },
                   "series": [ { "date": "2026-10-15", "e1rmLb": 192.4 } ] } ],
  "muscles":    { "2026-10": { "chest": 3.0, "triceps": 6.0 } },     // per month with lifts: working sets, primary x 1 + secondary x 0.5; raw, not normalized
  "muscleSets": { "2026-10": { "chest": [3, 0], "triceps": [2, 8] } } } // [primary sets, secondary sets] behind each score, for tooltips
```

Absolute body weight, body composition, Hevy notes and descriptions appear in no public file (a test asserts it). Activity detail JSON gains `lifts: [{title, sets: [...]}]` for Hevy activities and for COROS activities with an attached workout; their `training.json` entries gain `lift: {volumeLb, sets, exercises}`. Hevy-only activities use the id `hevy-<uuid>` in `training.json` and `/data/activities/`.

Front end: activity pages show a lifts table per exercise (warm-ups faint); `/stream/training/` has a **Strength** section (weekly volume, up to six e1RM small multiples on one shared time axis, a sortable exercise table, and a monthly **muscle map**: front and back figures filled by each group's score for the selected month, transparent to `--series-dim` to `--accent` at the month's maximum, with a month selector and a ranked list) and a **Body weight** section (change line on a zero baseline). Both sections are absent when their data file is.

Automation: `auto_sync.py` runs COROS, then `hevy_sync.sync()`, then `weight.sync()`; neither can stop the run, and any change they make counts toward publishing.

## 12. Sleep

**Importer fields** (`scripts/coros_sync.py`, `_System/wellness/YYYY-MM-DD.json` → `public`). Besides the stage totals in §8, each night stores, all parsed from the text COROS already returns (no extra calls): `bedtime`, `wake` (local `HH:MM` from *Main Sleep Window*), `bedDate` (the date the window began, so a bedtime before midnight is unambiguous), `inBedS` (*Main Sleep Period*, awake time included), `awakeCount`, `napS` (*Naps Total*, omitted when 0), `napAt` (start of the first nap), `sleepHrAvg`, `sleepHrMin` (*Sleep HR*). These stay minute-exact in the private store. `migrate_wellness()` refills them from the stored raw text for every past day (`coros_sync.py reparse`, and at the end of every wellness pass); a file is rewritten only when its public part changes.

**Respiration is not collected.** `queryHealthCheckTimeSeries` returns respiration only for deliberate wellness-check measurements; for this account every date range returns "No complete health check time series data", so there is nothing to store. The page shows a respiration chart only if `respiration` ever appears in `sleep.json`.

**Tags.** A daily note (`type: daily`, in `Daily/`, with `date`) may carry `sleep_tags: [late meal, caffeine]` (a list or a comma-separated string). The tags attach to the night whose wake date equals the note's `date`. The notes stay private; only the lowercased tag strings are published.

**`/data/sleep.json`** (written with `wellnessPublic`, when at least one night has a sleep total; oldest first, dated by wake day):

```jsonc
{ "nights": [ { "date": "2026-10-19",
    "bedtime": "00:45", "wake": "08:00",              // rounded to the nearest 15 minutes
    "asleepS": 22380, "inBedS": 26340, "efficiency": 85,   // efficiency = asleep / in bed, percent
    "deepS": 3060, "lightS": 14280, "remS": 5040, "awakeS": 3960, "awakeCount": 1,
    "napS": 1560, "napAt": "15:30",                   // napAt rounded; a "nap" starting at 21:00 or later is dropped
    "score": 69, "hrv": 74, "hrvLow": 63, "hrvHigh": 85,
    "sleepHrMin": 47, "sleepHrAvg": 55, "restingHr": 56,
    "respiration": 14.5,                              // only if the importer ever stores it
    "tags": ["late meal", "caffeine"] } ] }
```

Every field except `date` and `asleepS` is optional. **Privacy:** bedtime, wake and nap times are rounded to 15 minutes in the publisher (`sleep_of`), computed across midnight from `bedDate`; exact times, `bedDate`, and the night-detail fields never appear in `wellness.json`. A test builds a vault with exact times and asserts none of them appears anywhere under `content/`.

**Page `/stream/sleep/`** (shell in `SHELLS`; linked from the Stream page next to *Training history →*, from the homepage intro nav, the search palette, and the `[[Sleep]]` hub link). Period switch Month (30 days) · Quarter (12 weeks, default) · Year (52 weeks), `?period=`. Sections: Schedule (one bar per night on a clock axis, 9 pm to 11 am and widened in whole hours when a night falls outside; segments show the night's stage mix, not stage timing; median bed-to-wake band; tag markers; nap ticks), Averages (asleep, efficiency, bedtime regularity as the standard deviation of bedtime, HRV, lowest sleeping HR, each with the change from the previous equal-length period; no target anywhere), Balance vs usual (running sum of asleep minus the median of the previous 28 nights), Stages, Overnight signals, Weekday vs weekend (Friday and Saturday evenings are weekend nights; social jetlag is the gap between the two groups' bed-to-wake midpoints), Sleep & training (training load of the day before, from `training.json`, against sleep score or next-morning HRV; a direction sentence appears only with 10 or more nights), Sleep ribbon, Tags (shown when any night is tagged).

## 13. Reading flow and auto-filing

`Library/` holds one `type: literature` entry per work (the facts). `Notes/Literature Notes/` holds `type: literature-note` notes (your thinking), each with `about: "[[Work]]"`; the publisher prepends "*On [[Work]]*" (a one-way link: the work's page does not list notes about it). Ideas graduate to `Notes/Concepts/` (`concept`) and `Notes/Evergreen/` (`evergreen`, `maturity: seedling|developing|evergreen`).

`scripts/tidy.py` runs before every build and sync: notes directly in `Inbox/` with a `type` and untouched for 10 minutes move to that type's folder (`literature`→Library, `literature-note`→Notes/Literature Notes, `concept`→Notes/Concepts, `evergreen`→Notes/Evergreen, `reflection`→Reflections, `writing`→Writing, `photo`→Photos, `daily`→Daily, `month`→Monthly, `block`→Training/Blocks). Publishing state follows the move, so addresses never change.
