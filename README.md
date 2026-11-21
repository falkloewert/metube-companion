# MeTube Companion

> **Status: work in progress, not released yet.** The code currently lives in a private homelab and is being turned into a standalone project. See the [v0.1.0 milestone](../../milestone/1) for the plan.

A friendlier web UI and browser extension for [MeTube](https://github.com/alexta69/metube), the self-hosted web UI for yt-dlp. It runs next to a stock MeTube instance and does not modify it.

## What it does

- **One link, four formats.** Paste a link and pick Video, Audio, Text (transcript) or Thumbnail. Tap once to select, tap again to send.
- **One card per video.** The history shows every video once, with all formats side by side: *save* what is there, *request* what is missing, and watch progress right inside the cell.
- **Transcripts that just work.** Detects whether a YouTube video is spoken in English or German (including AI-dubbed videos), fetches the original caption track to dodge YouTube's 429 errors, and turns captions into clean text. Preview, copy, or save as Markdown.
- **Browser extension** (Chromium and Firefox). Sends the current tab with the cookies MeTube needs for signed-in content, shows the same format cells, and notifies you when a download is done.
- **Installable on Android**, with a share target: share a link from the YouTube app straight to your instance.
- **Housekeeping.** Shows how long files stay before automatic cleanup and deletes all formats of a video at once.

## Security

MeTube Companion has **no login**. Run it on your home network or behind a VPN only. Never expose it to the internet without an authenticating reverse proxy in front.

## License

[MIT](LICENSE)

## Repository layout

- `web/`: the web UI (static files, PWA). `shared.js` and `shared.css` are shared with the extension.
- `extension/`: browser extension for Chromium and Firefox. `./build.sh` writes the packages to `extension/dist/`.
- `nginx/default.conf`: the sidecar config (static UI, `/api/` and `/ext/` proxy to MeTube, file list, YouTube page proxy).
