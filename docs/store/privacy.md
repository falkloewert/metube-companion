# Privacy policy: MeTube Companion browser extension

Last updated: 2026-11-21

MeTube Companion is a browser extension for people who run their own [MeTube](https://github.com/alexta69/metube) server together with the [MeTube Companion](https://github.com/falkloewert/metube-companion) container. It has no server of its own, no account, no analytics and no advertising. The developer receives no data at all.

## What the extension handles, and where it goes

| Data | When | Sent to |
|---|---|---|
| The link of the current tab (or a link you right-click) | Only when you press send | Your own MeTube Companion instance, at the address you entered |
| Your cookies for that site, only for YouTube, Instagram and TikTok links | Only when you press send, so the server can download content you are signed in for | Your own instance only (as a `cookies.txt` for yt-dlp) |
| A request to the YouTube watch page of the video | When you request a transcript, to find the spoken language | YouTube, the same as opening the video |
| Instance address, optional access token, download settings, the last link and running jobs | Stored locally in the browser (`storage`) | Nowhere |

Cookies of other sites, including your Google account, are never read or sent. Nothing is sold, shared with third parties or used for anything other than sending your downloads to your own server.

## Permissions

- **cookies:** read the cookies of YouTube, Instagram or TikTok when you send a link from there.
- **host permissions** (YouTube, Instagram, TikTok, `localhost:8081`, and the instance address you enter, which the browser asks you to allow): read those cookies and talk to your instance.
- **storage:** keep your settings and the jobs in progress.
- **activeTab, contextMenus:** take the current tab's link or a right-clicked link.
- **notifications, alarms:** tell you when a download is done; check its progress meanwhile.
- **downloads:** save a finished file from your server to this computer when you press save.

## Removing data

Removing the extension deletes everything it stored. Files and cookies sent to your instance are under your control there (the web UI can delete the stored cookies).

## Contact

Questions: [GitHub issues](https://github.com/falkloewert/metube-companion/issues).
