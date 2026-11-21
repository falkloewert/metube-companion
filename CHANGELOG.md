# Changelog

## Unreleased

- Web UI: files in the download folder without a MeTube history entry show up as cards (save, delete; request too when the YouTube ID is in the name) (#29).
- `compose.desktop.yml` also fits a server without MeTube: `COMPANION_BIND`, `COMPANION_PORT`, `TZ` and `YTDL_UPDATE_TIME` via `.env` (#30).
- README: push notifications via MeTube's own `Exec` postprocessor (#20).

## 0.1.0 - 2026-11-21

First public release.

- Web UI: two-tap tiles for video, audio and text; one card per video with format cells (save, request, progress in the cell); transcript preview with copy and Markdown export; clear all; report button for failed downloads; installable on Android with a share target.
- Transcripts: spoken-language detection for YouTube (English/German), original caption track to avoid 429 errors.
- Browser extension for Chromium (MV3) and Firefox (MV2): send the current tab with the needed cookies, same format cells, notifications; instance address and optional token set on first start.
- Container image (amd64, arm64) with optional access token, automatic cleanup and health check; compose files for desktop and server.
- Smoke test in CI, weekly against the newest MeTube.
