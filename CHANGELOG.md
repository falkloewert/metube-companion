# Changelog

## 0.5.0 - 2026-11-22

- Web UI and extension: one tap on Video, Audio or Text sends right away. For 5 seconds the tile then shows "cancel?"; a second tap cancels the job, MeTube stops the download and keeps no file. Before, the first tap only selected and a second tap sent; that cost a tap every time to guard against a rare mistake. Enter in the web UI's link field sends as Video. A job that already finished in those seconds (a short transcript) stays and says so.
- Extension: no "done" or "error" notification for a cancelled job.
- Web UI: may be framed by its own origin (the demo stage); other sites still cannot.
- Demo video re-recorded with the one-tap flow.

## 0.4.1 - 2026-11-22

- Extension: installed from the store without the server part? The settings page says up front that MeTube Companion has to run on your computer or server and links the setup guide; the popup shows "No MeTube Companion yet? How to set it up" when it cannot reach the instance.

## 0.4.0 - 2026-11-22

Note: update the image and the extension together. **If you open the companion by a domain name** (reverse proxy, `nas.example.com`, `*.ts.net`), add it to the new `COMPANION_HOSTS`, otherwise it answers "421". IP addresses, `localhost`, names without a dot and `.local` keep working. `compose.desktop.yml` now takes `COMPANION_TOKEN` and `COMPANION_HOSTS` from `.env`: if you set the token in the compose file before, move it to `.env` before replacing the file, otherwise the instance runs without a token.

- Security: the companion only answers to known host names (`COMPANION_HOSTS`, see above). Without it, a web page could use DNS rebinding to reach an instance without a token, including the desktop setup on `localhost`. The web UI can no longer be framed by other pages.
- Extension: sending cookies is optional and off by default. Installing asks for no website or cookie access at all (the instance answers the extension via CORS, so its address needs no permission); the settings page (opens after installing) has "Send my cookies with YouTube, Instagram and TikTok links", and only then the browser asks. Cookies only go to an `https://` address or this computer.
- Extension: the spoken language of a transcript is looked up through the instance (`/ext/yt/<id>`, the same as the web UI) instead of fetching YouTube directly.
- Firefox extension: the popup said "Cannot reach ..." although the instance answered, and the format bar did not see existing files (showed "request" instead of "save"). Firefox applies CORS to extension pages; the read-only `/files/` listing and `/ext/yt/` now answer extension origins (GET only, never MOVE or DELETE). The popup checks the instance via `/ext/`, so a login proxy that lets `/ext/` and `/files/` through (INSTALL.md) works.
- Extension settings: the status line sits under Save; a name the instance does not know ("421") is explained.
- Web UI: a wrong access token says so instead of showing "Offline"; the token field is no longer squeezed. Cells and tiles no longer cut off "tap to cancel" (now "cancel?") and the German "tap again".
- Docs: README quick start creates its own folder (on macOS/Windows `./downloads` in the home folder was the personal Downloads folder) and notes `curl.exe` for Windows PowerShell; INSTALL.md 4.1 explains `.env`; README FAQ on the trash; store texts and privacy policy match the optional cookies and name the thumbnails from i.ytimg.com.
- Container: a token with a line break is rejected.
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
