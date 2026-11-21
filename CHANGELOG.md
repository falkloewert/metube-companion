# Changelog

## 0.1.0 (unreleased)

First public release.

- Web UI: two-tap tiles for video, audio and text; one card per video with format cells (save, request, progress in the cell); transcript preview with copy and Markdown export; clear all; report button for failed downloads; installable on Android with a share target.
- Transcripts: spoken-language detection for YouTube (English/German), original caption track to avoid 429 errors.
- Browser extension for Chromium (MV3) and Firefox (MV2): send the current tab with the needed cookies, same format cells, notifications; instance address and optional token set on first start.
- Container image (amd64, arm64) with optional access token, automatic cleanup and health check; compose files for desktop and server.
- Smoke test in CI, weekly against the newest MeTube.
