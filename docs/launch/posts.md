# Launch posts (drafts)

Plan and status: issue #31. Post only after both store listings are live. One honest post per place, answer every comment.

Assets: `docs/demo.gif`, `docs/demo.mp4`, `docs/screenshots/*.png`, `docs/launch/social-preview.png` (GitHub link preview).

Links:
- Repo: https://github.com/falkloewert/metube-companion
- Chrome: https://chromewebstore.google.com/detail/jbbofgfomolpmigffpdnmodnelcagelp
- Firefox: https://addons.mozilla.org/firefox/addon/metube-companion/

## Core text

**One line:** MeTube Companion: a friendlier web UI and browser extension for MeTube (self-hosted yt-dlp). Video, audio or transcript in one tap.

**One paragraph:** MeTube Companion runs next to a stock MeTube instance and gives it one card per video with all formats side by side (video, audio, transcript, thumbnail), progress inside the cell, clean transcripts (preview, copy, save as Markdown) and a browser extension for Chrome and Firefox that sends the current tab, optionally with that site's cookies for signed-in content. Installable on Android with a share target. One Docker container, MIT, no tracking, no account.

## Reddit r/selfhosted

Rule 6 (checked 2026-11-22): projects younger than 3 months (first public commit 2026-11-21) only as a comment in the current "New Project Megathread". Use the megathread's template if it has one; the text below fits. A standalone post is possible from 2027-02-21. Reply to the AI-disclosure bot if it asks.

**Title (standalone, later):** MeTube Companion: one-tap video, audio and transcript downloads for MeTube (web UI + browser extension)

**Body:**

I use MeTube (the self-hosted web UI for yt-dlp) a lot, mostly to grab transcripts and audio. What kept bugging me: one row per download instead of one per video, no clean way to get a transcript as text, and copying links from the browser by hand. So I built a companion that sits next to an unchanged MeTube:

- **One card per video**, all formats side by side: video, audio, transcript, thumbnail. Save what is there, request what is missing, progress runs inside the cell.
- **Transcripts as text**: preview with word count, copy, or save as Markdown. Detects English vs. German (incl. AI-dubbed videos) and uses the original caption track, which avoids most of YouTube's 429 errors.
- **Browser extension** (Chrome Web Store, Firefox Add-ons): sends the open tab in one tap, notifies when done. Optionally sends that site's cookies (YouTube, Instagram, TikTok only) for "Sign in to confirm you're not a bot".
- **Android**: installable as an app with a share target.
- **Housekeeping**: optional auto-delete after N days, trash with restore.

Setup is one extra container (nginx) next to MeTube; the compose files (desktop and server) bring both. No login of its own, so keep it on your LAN or behind your auth proxy (optional access token for the API).

Demo (76 s): https://github.com/falkloewert/metube-companion/blob/main/docs/demo.mp4
Repo: https://github.com/falkloewert/metube-companion

Disclosure: built with heavy help from AI coding agents; I reviewed and tested every change, and it has a test suite plus an offline end-to-end sandbox.

Feedback welcome, especially which sites or formats you would want next.

### Megathread comment (launch, template of the thread)

**Project Name:** MeTube Companion

**Repo/Website Link:** https://github.com/falkloewert/metube-companion

**Description:** A friendlier web UI and browser extension for MeTube (the self-hosted web UI for yt-dlp). It sits next to an unchanged MeTube and adds:

- One card per video with all formats side by side (video, audio, transcript, thumbnail): save what is there, request what is missing, progress inside the cell.
- Transcripts as clean text: preview, copy, or save as Markdown. Detects English vs. German (incl. AI-dubbed videos) and uses the original caption track, which avoids most of YouTube's 429 errors.
- Browser extension for Chrome (Chrome Web Store) and Firefox (Firefox Add-ons): sends the open tab in one tap, notifies when done, optionally passes that site's cookies (YouTube, Instagram, TikTok only) for "Sign in to confirm you're not a bot".
- Installable on Android with a share target; optional auto-delete with a restorable trash.

Demo (76 s): https://github.com/falkloewert/metube-companion/blob/main/docs/demo.mp4

**Deployment:** One extra container (nginx) next to MeTube, image on GHCR. Docker Compose files for desktop and server bring both; README quick start and INSTALL.md walk through every option. No login of its own: keep it on your LAN/VPN or behind your auth proxy (optional access token).

**AI Involvement:** Built with heavy help from AI coding agents. I reviewed and tested every change; there is a test suite, an end-to-end smoke test against a real MeTube, and an offline sandbox with a mock MeTube.

## Reddit r/DataHoarder

Rules (checked 2026-11-22): no ads, "No AI slop", posts need context. A free tool by its author is fine; keep the AI disclosure and lead with the engineering, not marketing.

Same body, title: **Made a companion for MeTube: one card per video, transcripts as text, browser extension with cookie handoff**. Lead with the archiving angle (all formats of a video in one place, transcripts as Markdown next to the file).

## Reddit r/homelab (later)

Rule 7: flair "Project: Software" with AI disclosure in flair and text, answers to the posting prompt, minimum subreddit karma. Falk's account has 45 karma total; check the requirement before posting.

## Lemmy (selfhosted@lemmy.world)

Promotion needs an account that has been active there for a while (unverified: 30 days) and an AI tag in the title. Only if Falk has such an account.

Same body as r/selfhosted, shortened by the housekeeping bullet.

## Hacker News

**Title:** Show HN: MeTube Companion – one-tap video, audio and transcripts for self-hosted yt-dlp

**URL:** the repo. **First comment (by us):**

I built this because I mostly use MeTube (a web UI for yt-dlp) to get transcripts, and that was clumsy: one row per download, captions as .vtt, links copied by hand. The companion is a static web UI plus an nginx sidecar in front of an unchanged MeTube, and a browser extension (MV3 and MV2 from one source). Things that took the most work: MeTube's status stream is noisy (two 0-100 % runs per video, "finished" while still queued), so progress is turned into a forward-only value; YouTube rate-limits the normal caption track but not the original one, so it asks for both. Built largely with AI coding agents, with an offline sandbox (mock MeTube) that records a proof video for every change. Happy to answer questions.

## selfh.st (newsletter)

Submission form, one paragraph (core text) plus repo link and the social preview image.

## AlternativeTo

List as an alternative to MeTube / yt-dlp GUIs. Description: core paragraph. Tags: self-hosted, youtube-downloader, transcripts, browser-extension. Platforms: Self-Hosted, Chrome, Firefox, Android (PWA).

## GitHub repo settings (as `falkloewert`)

Topics and description (on Falk's PC):

```sh
gh repo edit falkloewert/metube-companion \
  --description "A friendlier web UI and browser extension for MeTube (self-hosted yt-dlp): video, audio or transcript in one tap" \
  --add-topic metube --add-topic yt-dlp --add-topic youtube-downloader --add-topic self-hosted \
  --add-topic homelab --add-topic browser-extension --add-topic transcripts --add-topic docker
```

Social preview: Settings > General > Social preview > Edit > upload `docs/launch/social-preview.png`.

## Order

1. Now: GitHub topics and preview image; AlternativeTo (its free review queue takes weeks).
2. Launch day, after the Firefox listing is live: r/selfhosted megathread comment, stay around for replies.
3. Same week, Mon to Wed: selfh.st submission (newsletter goes out Fridays; there is a "companions" category).
4. A few days later: r/DataHoarder (Tue to Thu), Show HN (Sat or Sun around 12:00 UTC).
5. Later: r/homelab and Lemmy if the account requirements are met; r/selfhosted standalone post from 2027-02-21.
6. awesome-selfhosted: PR to awesome-selfhosted-data after 2027-03-21 (first release v0.1.0 must be over 4 months old).
