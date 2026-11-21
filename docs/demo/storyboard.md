# Demo video storyboard

Every feature appears exactly once, in the place where people use it. Target 60 to 80 s, 1080p, captions in English (the video must work muted), quiet music and soft UI sounds.

## Part 1: browser extension (desktop, on YouTube), about 25 s

| # | On screen | Caption |
|---|---|---|
| 1 | A YouTube watch page (public-domain video). Cursor clicks the MeTube Companion icon in the toolbar; the popup opens with the link already filled in. | Watching something? Click the icon. The link is already there. |
| 2 | Tap Video once (selected), tap again (sent). Status: sent with the YouTube cookies. | Two taps. Your cookies go along, so sign-in-only videos work. |
| 3 | The Video cell shows progress, then turns green. Sped-up part carries a "4x" badge. | It downloads on your own server. |
| 4 | Done notification with "Download to this computer"; the file lands in the browser's downloads. | Done. Save it to this computer with one click. |
| 5 | Right-click a link on the page: "Send to MeTube". | Or right-click any link. |

## Part 2: web UI (desktop), about 35 s

| # | On screen | Caption |
|---|---|---|
| 6 | The web UI: the video from part 1 is already a card, one cell per format. | Everything you sent, one card per video. |
| 7 | Tap Text: transcript appears, preview opens, "Copy all", "As .md". | Transcripts as plain text. Copy or save as Markdown. |
| 8 | Download settings: Audio format MP3. Request Audio and Image on the same card; cells turn green. | Need MP3 or 720p? Set it once. |
| 9 | A longer history: type in search, tap a filter chip. | Search and filter. |
| 10 | Delete a card: it goes to the Trash; Restore brings it back. | Deleted by mistake? It waits in the trash. |

## Part 3: phone, about 8 s

| # | On screen | Caption |
|---|---|---|
| 11 | Phone frame with the installed web app; a short share-menu moment if it can be shown truthfully, otherwise the app with a fresh card. | On Android it installs as an app and shows up in the share menu. |

## End card, about 4 s

Name, one-line pitch ("A friendlier front end for MeTube: video, audio, transcript, one tap."), github.com/falkloewert/metube-companion.

## Rules

- Real UI, real downloads. Overlays only for captions, the speed badge and the end card. A system notification that cannot be recorded may be redrawn as an overlay with exactly the real text.
- Sped-up or cut waiting time is always marked (badge "4x" or a short "... ready").
- Not shown on purpose: access token, cookies upload by file, "Clear all", files without history, automatic retry (no visible step).
- Sounds: synthesized in this folder (no third-party samples), soft and short. Music: free license (CC0 preferred), quiet, credited in `CREDITS.md`.
