# MeTube Companion browser extension (Chromium and Firefox)

Sends the current link (or a link via right-click) to your own MeTube instance. Optionally ("Send my cookies" in the settings) it also uploads your cookies for YouTube, Instagram and TikTok links, only for that site, so signed-in content can be downloaded. No other site gets cookies, and never your Google account. Installing asks for no cookie access; the settings page does, only if the box is ticked.

The extension only works against an instance served through the Companion nginx sidecar (`/ext/...`). Talking to MeTube directly fails at its cross-origin guard.

## Build

```bash
cd extension
./build.sh        # creates dist/metube-companion-chromium.zip and dist/metube-companion-firefox.xpi
```

`shared.js` and `shared.css` live in `../web/` and are shared with the web UI; `build.sh` packs them into both packages. To test, load the built package, not this folder directly.

## Install

**Chromium (Chrome, Brave, Edge, ...):** install it from the [Chrome Web Store](https://chromewebstore.google.com/detail/jbbofgfomolpmigffpdnmodnelcagelp). To test a build: unzip `metube-companion-chromium.zip` (the folder must contain a `manifest.json`), open the extensions page (`chrome://extensions`, `brave://extensions`), enable developer mode, "Load unpacked", pick the folder.

**Firefox:** install it from [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/metube-companion/). To test a build, temporarily: `about:debugging#/runtime/this-firefox`, "Load Temporary Add-on", pick `manifest.json` or the `.xpi`; it disappears on restart. Needs Firefox 140 (Firefox for Android 142).

Icons: `icon.svg` is the source, the packages contain PNG versions (`icon-48/96/128.png`) because browsers reliably accept PNG there. Regenerate with:

```bash
for s in 48 96 128; do convert -background none -density 400 -resize ${s}x${s} -depth 8 -strip icon.svg icon-$s.png; done
```

## Usage

- **Toolbar button:** opens a small window with the current tab's link prefilled. Three tiles, Video, Audio, Text: one tap sends; the tile then shows "cancel?" for 5 seconds, a second tap cancels the job (MeTube stops the download, nothing is kept).
- **Last video:** below it, the last sent video with the same format bar as the web UI (Video, Audio, Text, Image). Each cell shows a verb ("save", "show", "request", "loading N %", "retry", "waiting"); a tap does what it says. Progress runs inside the cell and only moves forward.
- **Text:** downloads the transcript. "show" opens a preview with word count, plus "Copy all" (running text) and "As .md" (title, source, text). The extension detects the spoken language from the YouTube page, fetched by your instance (`/ext/yt/<id>`, without cookies): the original audio track first (for AI-dubbed videos the default track is often German), then the only automatic caption track, then manual captions. English stays English, everything else becomes German.
- **Right-click** on a link or page: "Send to MeTube" (always video).
- **Notifications:** after sending, the extension polls for 32 seconds every 4 seconds; if that is not enough, an alarm checks every 30 seconds (Chromium; Firefox rounds up to 1 minute). It reports "MeTube: done" or "MeTube: error" as a browser notification, even with the popup closed. The "done" notification has a "Download to this computer" button; clicking the notification opens the source page. The notification icon must be PNG: Chromium rejects SVG and the notification fails silently.
- **Instance address, access token, cookies:** set in the extension settings, which open on first install; saving asks the browser for the site cookies (only if ticked) and tests the connection. The instance itself needs no permission: the companion answers the extension via CORS (`/ext/`, `/files/`, `/ext/yt/`).

## Notes

- **Cookies:** optional permissions (`cookies` and the three sites; in Firefox also the `authenticationInfo` data consent), requested on the settings page. The extension reads only the cookies of the site you send (YouTube, Instagram or TikTok), never all browser cookies. It uploads them before every send, so they are always fresh. On the server they end up in `state/cookies.txt` and apply to all downloads. An upload replaces the whole file: cookies uploaded manually in parallel overwrite the extension's and vice versa.
- **429 / original caption track:** YouTube often blocks the normal caption track ("en") with "Too Many Requests", but not the original one ("en-orig"). The extension therefore requests both (`subtitle_mode: prefer_auto`), and a MeTube preset named `text` (`YTDL_OPTIONS_PRESETS`) turns a failed track into a warning instead of an error.
- **Link form:** YouTube links are sent as `watch?v=<id>` (without `&t=`, playlist, `si=`). MeTube tracks the job under that form; with the original link the extension could not find it again and stayed silent.

## Limits

- Instagram requires login cookies for almost everything; an account with automated access may get blocked.
- YouTube usually needs no cookies but blocks some IPs with "Sign in to confirm you're not a bot".
