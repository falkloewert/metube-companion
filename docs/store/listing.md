# Store listings (Chrome Web Store, Firefox Add-ons)

Copy from here when submitting (#10). Package: the release assets `metube-companion-chromium.zip` and `metube-companion-firefox.xpi`.

## Shared

- **Name:** MeTube Companion
- **Summary (max. 132 characters):** Send the current video to your own MeTube server: video, audio or transcript in one tap, optionally with your sign-in.
- **Category:** Chrome: Productivity (Tools). Firefox: Download Management.
- **Homepage / support:** https://github.com/falkloewert/metube-companion
- **Privacy policy URL:** https://github.com/falkloewert/metube-companion/blob/main/docs/store/privacy.md
- **Screenshots:** docs/screenshots/extension.png, desktop.png, mobile.png (Chrome wants 1280x800 or 640x400; pad if needed). Video: docs/demo.mp4 (Chrome takes a YouTube link only).

**Description:**

MeTube Companion sends the page you are on to your own MeTube server (a self-hosted web UI for yt-dlp). It needs the free MeTube Companion container next to MeTube; it does not download anything by itself. It talks only to your server (the language of a transcript is looked up there too) and loads video thumbnails for the popup from YouTube's image server, i.ytimg.com.

- Video, Audio or Text: one tap sends; tap again within 5 seconds to cancel.
- Transcripts as plain text, ready to copy or save as Markdown; the spoken language is detected for YouTube.
- Optional, off until you allow it on the settings page: sends your YouTube, Instagram or TikTok cookies with the link, for downloads that need your own sign-in. Other sites never get cookies.
- Shows progress and notifies you when the download is done; save the file to this computer with one click.
- Optional video quality (Best, 1080p, 720p, 480p) and audio format (M4A, MP3, Opus).
- Open source (MIT), no tracking, no account.

Setup: the extension does nothing on its own. First install the free MeTube Companion container on your computer or server (Quick start on the homepage), then enter its address on the settings page that opens after installing.

## Chrome Web Store: privacy tab

- **Single purpose:** Send the current page's link (optionally with the matching site cookies) to the user's own self-hosted MeTube server for download.
- **Permission justifications:**
  - cookies (optional, requested on the settings page only if the user ticks "Send my cookies"): Reads YouTube, Instagram or TikTok cookies only when the user sends a link from that site, and uploads them to the user's own server so yt-dlp can download signed-in content.
  - storage: Stores the server address, optional access token, download settings and running jobs locally.
  - downloads: Saves a finished file from the user's server when the user clicks save.
  - alarms: Polls the user's server for progress of a running job until it finishes.
  - activeTab: Reads the current tab's URL when the user opens the popup.
  - contextMenus: Adds "Send to MeTube" to the right-click menu for links and pages.
  - notifications: Tells the user when a download is done or failed.
  - Host permissions: none required. The user's server answers the extension itself (CORS), so its address needs no permission. Optional, only after the user ticks "Send my cookies" and approves the browser prompt: YouTube, Instagram, TikTok together with the cookies permission.
  - Remote code: No, all code is in the package.
- **Data usage:** collects "Web history" (the link the user sends) and, only if the user allows cookies, "Authentication information" (site cookies); both go only to the user's own server. Not sold, not used for unrelated purposes, not used for creditworthiness. Certify all three statements.

## Firefox Add-ons

- Data collection is declared in `manifest.json`: `browsingActivity` required, `authenticationInfo` optional (asked together with the cookies permission).
- **Notes to reviewer:** "Requires a self-hosted MeTube + MeTube Companion server to do anything. Quick test setup: `docker compose -f compose.desktop.yml up -d` from the repository, then keep the default address http://localhost:8081. Source is the unminified code in the package; build script: extension/build.sh."
- Source code upload: not needed (no minification or bundling).
