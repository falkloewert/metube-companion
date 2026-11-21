# Notes for AI agents working on this repository

Installing for a user? Read [INSTALL.md](INSTALL.md) instead. This file is for changing the code.

## Layout

- `web/`: the web UI (plain HTML/CSS/JS, no build step). `shared.js` and `shared.css` are shared with the extension: formats, payloads, language detection, progress, icons, colors, format cells, text panel. Change shared behavior there, not twice.
- `extension/`: Chromium (MV3, `manifest.chromium.json`) and Firefox (MV2, `manifest.json`) from one source. `build.sh` copies `../web/shared.*` into the packages.
- `nginx/default.conf.template`: rendered at container start (envsubst): `/api/` (UI), `/ext/` (extension, CORS + MeTube's Sec-Fetch-Site guard), `/yt/<id>` (watch page for language detection), `/files/` (listing, DELETE of files), `/config.js`, `/healthz`.
- `docker/`, `Dockerfile`: image runs nginx as any user; `40-cleanup.sh` does `RETENTION_DAYS`.
- `compose.desktop.yml`, `compose.server.yml`: the two supported install paths.
- `docs/demo/`: `record.sh` rebuilds `docs/demo.mp4` end to end (own stack, real downloads, Playwright, ffmpeg). Re-run it after UI changes that show in the video.

## MeTube behavior the code depends on

Not a stable API; re-check after MeTube updates.

- One history entry per URL (`PersistentQueue` key = URL). A new format for the same URL replaces the entry, so formats are found via the file listing: same name stem, or `[<YouTube id>]` in the name (`OUTPUT_TEMPLATE`).
- Status sequence is noisy: `postprocessing` before the download, two 0-100 % runs for video (separate video and audio streams), `finished` while still in the queue. `progress()` in `shared.js` turns this into a forward-only value.
- `delete_files` on `/delete` only works with `DELETE_FILE_ON_TRASHCAN=ask`.
- `/retry` re-queues a failed entry with its stored options; remove the old done entry afterwards.
- One job per URL at a time ("Already in queue").

## Rules

- English everywhere (UI, comments, docs).
- No login exists. Never add anything that makes exposing the instance look safe; keep the warnings.
- Every UI action must stay understandable for a first-time user: a verb in each format cell, only destructive actions ask for confirmation.
- Keep `COMPANION_VERSION` in `web/shared.js` and both extension manifests in sync on release.

## Check before committing

```sh
for f in web/*.js extension/*.js; do node --check "$f"; done
./extension/build.sh
docker build -t metube-companion:test .
tests/smoke.sh   # MeTube + companion end to end, incl. token and file rules
```

For UI changes, also run `compose.desktop.yml` with the test image and try the flow from INSTALL.md section 5.

## Releasing

1. Update `COMPANION_VERSION` in `web/shared.js`, both extension manifests and `CHANGELOG.md`.
2. Run the checks above, commit, then tag: `git tag vX.Y.Z && git push --tags`.
3. CI builds the image (`X.Y.Z`, `X.Y`, `latest` on GHCR) and a draft GitHub release with the extension files. Review the draft, paste the changelog entry, publish.
4. First release only: make the repository and the GHCR package public, enable private vulnerability reporting.

GitHub disables scheduled workflows after 60 days without repository activity; re-enable the weekly smoke test in the Actions tab if that happens.

