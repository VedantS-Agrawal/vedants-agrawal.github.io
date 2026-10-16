---
title: Colophon
type: page
date: '2026-10-16'
published: '2026-10-16T13:08:03-05:00'
updated: '2026-10-16'
created: '2026-10-16T13:08:03-05:00'
modified: '2026-10-16'
---

How this site is made.

**Writing.** Everything starts as Markdown in [Obsidian](https://obsidian.md), in a vault that syncs over iCloud between laptop and phone. A note goes public when its `visibility` property says so; everything else stays in the vault.

**Build.** A Python 3.9 exporter (~1,700 lines; PyYAML, Pillow) reads the vault, keeps only public notes, strips location data from photos, and hands the result to [Quartz](https://quartz.jzhao.xyz) v5, a TypeScript static-site generator running on Node 26 (unified, remark, rehype). Links to notes that aren't public yet stay as plain text until they are.

**Interface.** The stream, library, and training pages are ~2,000 lines of plain JavaScript and ~850 lines of CSS — no framework, no chart library. Every chart is hand-written SVG. Type is set in Geist and Geist Mono.

**Training data.** A Python importer talks to COROS over its official MCP interface (OAuth), pulls workouts, lap splits, and wellness data, and parses original FIT files with fitdecode for the second-by-second charts. Routes and coordinates never leave the laptop. Units are converted to miles and feet at the last moment, because the watch thinks in kilometres.

**Publishing.** A macOS LaunchAgent (a few lines of bash) syncs and rebuilds every three hours; commits go to GitHub, and GitHub Actions deploys to GitHub Pages. A small local app, the publishing desk, shows what's ready, what changed, and what needs attention.

**Tests.** 43 Python unit tests, mostly about not publishing things that shouldn't be published.

**Credits.** Built on Quartz (MIT). The linked-intro homepage, library, season strip, and daily log borrow ideas from [Aaron Pham's garden](https://aarnphm.xyz). Colours: aubergine `#120a1c`, ivory `#ece6f1`, orange `#ff9a3c`.
