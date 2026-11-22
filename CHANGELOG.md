# Changelog

## Unreleased

- Firefox extension: the popup said "Cannot reach ..." although the instance answered, and the format bar did not see existing files (showed "request" instead of "save"). Firefox applies CORS to extension pages; `/healthz` and the read-only `/files/` listing now answer extension origins (GET only, never MOVE or DELETE). Needs the new image.
- Extension: an unreachable instance says "Cannot reach <address> ..." instead of the browser's "Failed to fetch"; the settings page no longer adds the network hint to "the access token is wrong".
- Extension: notification data of dismissed notifications is cleaned up.

## 0.3.0 - 2026-11-22

- Web UI: German translation, picked from the browser language (first entry of the language list); everything else stays English. One strings file per language in `web/i18n/`, so more languages are a single file (#21). The extension stays English.
- YouTube 403 ("refused the download") is retried once automatically by the web UI and the extension; in tests about 1 in 15 downloads hit it and the retry worked.
- Transcripts: old videos with both German and English manual captions (no automatic track) now get the uploader's language, judged from title and description; "Me at the zoo" was German before.
- Web UI and extension: a download that YouTube refuses with HTTP 403 (intermittent, any format) says "YouTube refused the download (403). Usually temporary: tap retry." instead of the raw yt-dlp message.

## 0.2.0 - 2026-11-21

Note: deleting now moves files to the trash for 7 days; set `TRASH_DAYS: "0"` for the old behavior.

- Optional download settings: video quality (Best, 1080p, 720p, 480p) and audio format (M4A, MP3, Opus), in a collapsible section of the web UI and on the extension's settings page; the tiles stay two taps (#14).
- Trash: deleting a video (and "Clear all" with files) moves its files to the hidden folder `.trash` instead of deleting them; the Trash section of the web UI lists them with "Restore" and "Empty trash". New `TRASH_DAYS` (default 7, `0` = delete right away) purges the trash automatically (#12).
- Web UI: files in the download folder without a MeTube history entry show up as cards (save, delete; request too when the YouTube ID is in the name) (#29).
- `compose.desktop.yml` also fits a server without MeTube: `COMPANION_BIND`, `COMPANION_PORT`, `TZ` and `YTDL_UPDATE_TIME` via `.env` (#30).
- README: push notifications via MeTube's own `Exec` postprocessor (#20).
- Web UI: search and filter chips (Video, Audio, Text, Failed) above a history with more than five cards (#18).

## 0.1.0 - 2026-11-21

First public release.

- Web UI: two-tap tiles for video, audio and text; one card per video with format cells (save, request, progress in the cell); transcript preview with copy and Markdown export; clear all; report button for failed downloads; installable on Android with a share target.
- Transcripts: spoken-language detection for YouTube (English/German), original caption track to avoid 429 errors.
- Browser extension for Chromium (MV3) and Firefox (MV2): send the current tab with the needed cookies, same format cells, notifications; instance address and optional token set on first start.
- Container image (amd64, arm64) with optional access token, automatic cleanup and health check; compose files for desktop and server.
- Smoke test in CI, weekly against the newest MeTube.
