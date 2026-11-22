# Privacy policy: MeTube Companion browser extension

Last updated: 2026-11-22

MeTube Companion is a browser extension for people who run their own [MeTube](https://github.com/alexta69/metube) server together with the [MeTube Companion](https://github.com/falkloewert/metube-companion) container. It has no server of its own, no account, no analytics and no advertising. The developer receives no data, unless you press "Report this problem" on a failed download: that opens a prefilled GitHub issue with the link in your browser, which you can edit or discard before sending.

## What the extension handles, and where it goes

| Data | When | Sent to |
|---|---|---|
| The link of the current tab (or a link you right-click) | Only when you press send | Your own MeTube Companion instance, at the address you entered |
| Your cookies for that site, only for YouTube, Instagram and TikTok links, and only if you ticked "Send my cookies" in the settings (off by default), and only to an `https://` address or this computer | When you press send, so the server can download content you are signed in for | Your own instance only (as a `cookies.txt` for yt-dlp) |
| The video ID | When you request a transcript, to find the spoken language | Your own instance, which fetches the public YouTube page without cookies |
| The video ID, as part of an image address | When the popup shows the last video | YouTube's image server `i.ytimg.com`, an ordinary image request for the thumbnail |
| Instance address, optional access token, download settings, the last link and running jobs | Stored locally in the browser (`storage`) | Nowhere |

Cookies of other sites, including your Google account, are never read or sent. Nothing is sold, shared with third parties or used for anything other than sending your downloads to your own server.

## Permissions

- **cookies** (optional, only if you tick "Send my cookies"; the browser asks you): read the cookies of YouTube, Instagram or TikTok when you send a link from there.
- **host permissions:** `localhost:8081` and the instance address you enter (the browser asks you to allow it) to talk to your instance; YouTube, Instagram and TikTok only together with the optional cookies permission.
- **storage:** keep your settings and the jobs in progress.
- **activeTab, contextMenus:** take the current tab's link or a right-clicked link.
- **notifications, alarms:** tell you when a download is done; check its progress meanwhile.
- **downloads:** save a finished file from your server to this computer when you press save.

## Removing data

Removing the extension deletes everything it stored. Files and cookies sent to your instance are under your control there (the web UI can delete the stored cookies).

## Contact

Questions: [GitHub issues](https://github.com/falkloewert/metube-companion/issues).
