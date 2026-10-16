# Design decisions

This records the chosen design and its tradeoffs so the system can be maintained without reconstructing the project conversation.

## A personal front door

The homepage starts with a personal introduction followed by recent entries. Deep purple (`#160d24`), warm white, and orange (`#ff9a3c`) establish the visual system; typography, spacing, and rules do most of the structural work.

| Destination | Purpose |
| --- | --- |
| Stream | A chronological record of writing, reflections, photographs, training, and daily wellness |
| Writing | A plain index of essays, evergreen notes, and reflections |
| Library | Projects, plus sources being saved, read, watched, or listened to |
| About | A short introduction and personal context |

Training lives inside Stream. Its longitudinal view and calendar are useful when exploring workouts; a separate top-level training destination would overemphasize one part of a personal site. Monthly archives make older entries discoverable without an endless homepage feed.

## One source of truth

The iCloud Obsidian vault is the editable source. The site is a derived public subset. Markdown preserves portability, local access, and links. Obsidian provides backlinks and quick capture without requiring a custom application to replace the writing environment.

Quartz renders notes and backlinks. The custom interface handles the introduction, collection browsing, filtering, and training views. This retains Quartz's linked-note strengths while allowing an editorial homepage.

Templates provide properties and an empty body. They do not force a writing prompt or outline. A project has exactly four properties: `title`, `type`, `status`, and `url`. Projects are public by default; `visibility: private` hides one.

## Explicit publication boundaries

The `visibility` property is the only switch, so publishing works the same from the phone. Writing, sources, and photos start private; projects, workouts, training blocks, and month notes start public. Credentials, private notes, source activity files, and original photographs stay outside the public deployment.

A public note that links to a private note is held back and listed in the desk; the rest of the site still publishes. The exporter never publishes a note merely because another note links to it.

Public photographs are resized and re-encoded; originals remain in the vault. Embedding a photo or recording in a public note is what publishes it; files referenced only by private notes never leave the vault. Activity publication uses a narrow schema excluding route coordinates.

The publishing desk is local and excluded from the public build. GitHub receives the site source and exported public subset. Published material also enters public Git history; later unpublishing cannot recall copies and caches.

## Dates answer different questions

- **Occurred:** when a workout, reflection, or photographed event happened.
- **Published:** when the entry first successfully entered the public site.
- **Updated:** when its published content changed.

An old workout belongs on its actual day. A newly published essay should not look old because its private draft was created earlier. Previewing must not claim publication occurred. Stable publication metadata is recorded after a successful push and preserved on later builds.

## Direct COROS synchronization

The local importer connects directly to the official COROS MCP service through OAuth and a private refresh-token cache. It does not route the account through Intervals.icu. History and subsequent updates use real records; the public interface derives totals from available records.

The importer requests activity data, not unrelated health information. Missing power, heart-rate samples, or recordings remain unavailable. COROS exposes the post-workout note's transcript (not the audio) through activity detail; it fills an empty workout note once and is then yours to edit. Audio can be added by embedding a file.

## Local operations, static hosting

GitHub Pages keeps hosting independent of the laptop. Account synchronization and publishing happen locally, so no private vault or refresh credential needs to reside on a public hosting platform. The tradeoff is that new updates wait until the laptop is awake and connected.

iCloud makes the vault accessible on phone and laptop. The phone is a capture and editing surface; the laptop is the publishing station. This keeps review consistent without a publicly reachable administration server. iCloud synchronization is not a substitute for a separate backup.
