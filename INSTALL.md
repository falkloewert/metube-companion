# Installing MeTube Companion (guide for AI agents and humans)

This file is written so that an AI assistant can explain MeTube Companion to a user and set it up with them. If you are an agent: read it fully, explain the product in your own words, **ask the user every decision in section 3** (do not silently pick defaults), then follow section 4 and verify with section 5.

## 1. What it is

MeTube Companion is a web interface and browser extension for [MeTube](https://github.com/alexta69/metube). MeTube is a self-hosted download service built on yt-dlp: you give it a link (YouTube and [many other sites](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md)), it downloads the file to a folder.

The companion adds:

- **Four formats per link:** video, audio (m4a), text (transcript) and thumbnail. One card per video shows all four: *save* what exists, *request* what is missing, progress runs inside the cell.
- **Transcripts:** for YouTube it detects whether the video is spoken in English or German (also for AI-dubbed videos), uses the original caption track (avoids YouTube's 429 errors) and turns captions into plain text. Preview, copy, or save as Markdown.
- **Browser extension** for Chromium browsers (Chrome, Brave, Edge) and Firefox: send the current tab in two taps, with the cookies needed for signed-in content.
- **Housekeeping:** delete a video with all its formats, clear the whole history, optional automatic deletion after N days.
- **Android:** installable as an app with a share target (share a link from the YouTube app). Only in Chrome on Android and only over HTTPS or localhost.

What it is **not**:

- Not a hosted service. Everything runs on the user's own computer or server.
- Not a replacement for MeTube. It runs **next to** a normal MeTube and talks to it over HTTP.
- **No user accounts.** Anyone who can reach it can download, delete and use the stored cookies, unless an access token is set (decision 5).

## 2. Requirements

- Docker with Compose (Docker Desktop on Windows/macOS, Docker Engine on Linux, or a NAS with Docker).
- About 1 GB RAM free for MeTube while downloading, disk space for downloads.
- For the extension: a Chromium browser or Firefox on the same network as the instance (or VPN).

## 3. Decisions to make with the user

Ask these one by one. Defaults are what the shipped compose files use.

| # | Question | Options and consequences | Default |
|---|---|---|---|
| 1 | **Where should it run?** | **This computer** (desktop): simplest, only reachable from this computer, downloads land on this computer, runs only while it is on. **A server or NAS**: reachable from all devices at home, keeps running, needs Docker there. | Desktop |
| 2 | **Is MeTube already running there?** | Yes: only the companion is added (`compose.server.yml`), four MeTube settings must be added. No: use the bundled setup (`compose.desktop.yml`, also fine on a server). | No |
| 3 | **Download folder** | Use a **dedicated folder**, not your general Downloads or a shared NAS folder: MeTube takes ownership of everything in it at start (`chown` to `PUID`/`PGID`), automatic deletion (4) and "Delete everything" act on it. | `./downloads` next to the compose file |
| 4 | **Delete downloads automatically?** | `RETENTION_DAYS=N` deletes files older than N days, hourly. It applies to **every file in the download folder**, including files that were there before (important when adding the companion to an existing MeTube); hidden folders such as MeTube's own state (`.metube`) are skipped. `0` keeps everything until the user deletes it. **There is no trash yet**: deleted files are gone (trash is planned, [#12](https://github.com/falkloewert/metube-companion/issues/12)). | `0` (off) |
| 5 | **Who may access it?** | Desktop: only this computer (bound to `127.0.0.1`). Server: home network or VPN. Optional `COMPANION_TOKEN` (16-128 characters, A-Z a-z 0-9 . _ -): the web UI asks for it once, the extension has a field; use HTTPS with it, plain HTTP exposes it. **Never expose it to the internet** without an authenticating reverse proxy with HTTPS in front (and set the token too; the extension cannot pass a login page, so the proxy must let `/ext/` and `/files/` through without login, protected by the token). | Local only, no token |
| 6 | **Port** | Any free port. | Desktop `8081`, server `8082` |
| 7 | **File owner** (Linux, NAS) | The companion must run as the owner of the download folder to delete files (`id` shows uid/gid). | `1000:1000` |
| 8 | **YouTube sign-in (cookies)** | YouTube sometimes answers "Sign in to confirm you're not a bot", especially for transcripts. **Extension:** with every send it uploads the cookies of that site only, if it is YouTube, Instagram or TikTok (never other sites, never your Google account cookies). **Manual:** export a `cookies.txt` and upload it under *Cookies* in the web UI. **None:** works until YouTube blocks. Cookies are stored on the instance and used for **all** downloads; anyone with access to the instance acts with that account. | Decide with the user |
| 9 | **Browser extension?** | Recommended for daily use. Installed "unpacked" (not from a store yet), see 4.3. | Yes |
| 10 | **Updates** | yt-dlp must keep up with YouTube. MeTube updates yt-dlp **at start and daily** at `YTDL_NIGHTLY_UPDATE_TIME` in the time zone `TZ` (pick a time the machine is usually on). This only works when MeTube starts as root and drops to `PUID`/`PGID` (as in both compose files); with `user:` on the MeTube service it is ignored. Updating the images themselves: manually (`docker compose pull && docker compose up -d`) or with the optional updater in `compose.desktop.yml`, which only updates MeTube and the companion but needs the Docker socket (equivalent to root on that machine). MeTube restarts briefly for the daily yt-dlp update; a download running at that moment may need a retry. | Desktop daily 12:00, server 04:00; images manual |
| 11 | **HTTPS** (server only) | Over plain `http://<ip>` browsers block copying to the clipboard, the paste button and installing the Android app. A reverse proxy with HTTPS (Caddy, Nginx Proxy Manager, Traefik) fixes that. Desktop (`localhost`) does not need it. | Optional |

## 4. Steps

### 4.1 Desktop (this computer)

```sh
mkdir metube-companion && cd metube-companion
curl -O https://raw.githubusercontent.com/falkloewert/metube-companion/main/compose.desktop.yml
# optional: create .env with METUBE_DOWNLOADS=/path/to/folder, PUID/PGID on Linux
docker compose -f compose.desktop.yml up -d
```

Apply the decisions by editing `compose.desktop.yml`: `RETENTION_DAYS` (4), `COMPANION_TOKEN` (5), the port in `127.0.0.1:8081:8080` (6), `PUID`/`PGID` in `.env` (7), `YTDL_NIGHTLY_UPDATE_TIME` and `TZ` (10), the optional `updater` service (10).

### 4.2 Server or NAS

- **MeTube already runs:** copy the `companion` service from `compose.server.yml` into the compose file that runs MeTube (same file, so `http://metube:8081` resolves). Add the four MeTube settings marked *required* there: `OUTPUT_TEMPLATE`, `YTDL_OPTIONS_PRESETS`, `TEMP_DIR`, `DELETE_FILE_ON_TRASHCAN`, plus the recommended `YTDL_NIGHTLY_UPDATE_TIME` and `TZ` (10). **Merge, do not replace:** if MeTube already has `YTDL_OPTIONS_PRESETS` or a custom `OUTPUT_TEMPLATE`, combine them (keep `[%(id)s]` in the file name, add the `text` preset). The companion expects files directly in the download folder or in subfolders of it; a separate `AUDIO_DOWNLOAD_DIR` outside it is not supported. If the MeTube service is not called `metube` or runs elsewhere, set `METUBE_URL` (e.g. `http://192.168.1.10:8081`). Mount the same download folder into both at `/downloads`. Set `user:` (7), `RETENTION_DAYS` (4, mind that it also deletes older existing files) and optionally `COMPANION_TOKEN` (5).
- **No MeTube yet:** use `compose.desktop.yml`, change the port line from `127.0.0.1:8081:8080` to `8081:8080` so other devices can reach it, and keep decision 5 in mind. For a machine that runs around the clock, also set `TZ` (e.g. `Europe/Berlin`) and move `YTDL_NIGHTLY_UPDATE_TIME` to a quiet hour such as `04:00`.
- **Replacing an existing MeTube setup** with the bundled one (same download folder): the web UI lists what is in MeTube's history, not every file in the folder. With a fresh MeTube state, older files stay in the folder but do not show up (and `RETENTION_DAYS` still deletes them). To keep them visible, stop MeTube once and copy the old `completed.json` from the old state folder (`STATE_DIR`, or `.metube` in the download folder) into the new one. Leave `cookies.txt` behind if the extension should send fresh cookies.
- **Behind a reverse proxy:** point it at the companion, not at MeTube: container port `8080` (for example `metube-companion:8080` on a shared Docker network) or the published host port. `/healthz` answers `ok` and suits uptime monitors.

Existing MeTube files without the video ID in their name still work, but are grouped by title only.

### 4.3 Browser extension

1. Download `metube-companion-chromium.zip` (Chrome, Brave, Edge) or `metube-companion-firefox.xpi` from the [releases](https://github.com/falkloewert/metube-companion/releases).
2. Chromium: unzip into a folder that stays, open `chrome://extensions` (or `brave://extensions`), enable developer mode, "Load unpacked", choose the folder.
   Firefox: `about:debugging#/runtime/this-firefox`, "Load Temporary Add-on" (removed on restart; permanent install needs Mozilla signing until the store listing exists).
3. The settings page opens on first install: enter the address (desktop: keep `http://localhost:8081`), press Save, allow access when the browser asks. It reports "Saved and connected" when it works.

## 5. Verify

- `curl -s http://localhost:8081/healthz` prints `ok` (use your host/port).
- The web UI opens and shows "Connected".
- Paste a public YouTube link, tap **Text** twice: within a minute a card appears with *Text: show*. If it fails with a sign-in message, see decision 8.
- On the card, tap **Image · request** (the thumbnail): the cell turns green, a `.jpg` appears in the download folder.
- Delete the card (tap the trash twice): the files disappear from the folder.

## 6. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| "Sign in to confirm you're not a bot" | YouTube wants a signed-in session: send cookies via the extension or upload `cookies.txt` (decision 8). |
| Text fails with 429 | The `text` preset in `YTDL_OPTIONS_PRESETS` is missing on MeTube. |
| Formats of a video are not grouped | `OUTPUT_TEMPLATE` without `[%(id)s]` on MeTube. |
| Deleting fails | The companion does not run as the owner of the download folder (`user:`). |
| "Clear all" → "Keep files" deletes files anyway | MeTube has `DELETE_FILE_ON_TRASHCAN` set to `true`; set it to `ask`. |
| Extension: "Cannot reach …" | Wrong address, not on the same network/VPN, or access not allowed in the settings page. |
| Web UI asks for an access token, extension says "protected" or "token" | `COMPANION_TOKEN` is set: enter it in the web UI once and in the extension settings. |
| Extension: "looks like MeTube without the companion" | The address points to MeTube itself; use the companion's address and port. |
| Copy and paste buttons do nothing, no "Install app" | Opened over plain HTTP from another device; use HTTPS (decision 11) or localhost. |

## 7. Uninstall

Desktop: `docker compose -f compose.desktop.yml down` (add `-v` to also remove MeTube's state, including cookies). Server: remove the `companion` service from the compose file and run `docker compose up -d --remove-orphans`; MeTube keeps running, its four companion settings can stay or be removed. Downloads stay in the folder in both cases. Remove the extension in the browser's extension page.
