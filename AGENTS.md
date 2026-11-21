# Notes for AI agents working on this repository

Installing for a user? Read [INSTALL.md](INSTALL.md) instead. This file is for changing the code.

## Layout

- `web/`: the web UI (plain HTML/CSS/JS, no build step). `shared.js` and `shared.css` are shared with the extension: formats, payloads, language detection, progress, icons, colors, format cells, text panel. Change shared behavior there, not twice.
- `web/i18n/`: one strings file per UI language (`de.js`), loaded before `shared.js`, active only when the browser's first language matches.
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

- Code, comments and docs in English. UI text is English by default; translations live in `web/i18n/<lang>.js` (English text -> translation, picked from the browser language, web UI only). New UI strings go through `t()` (or `data-i18n` in `index.html`) and need a German entry; `tests/i18n.test.mjs` fails otherwise. The extension stays English (no dictionary loaded).
- No login exists. Never add anything that makes exposing the instance look safe; keep the warnings.
- Every UI action must stay understandable for a first-time user: a verb in each format cell, only destructive actions ask for confirmation.
- Keep `COMPANION_VERSION` in `web/shared.js` and both extension manifests in sync on release.

## Factory sandbox (offline, no YouTube)

`docker-compose.factory.yml` runs the companion built from this checkout next to a mock MeTube (`factory/mocks/metube/server.mjs`, plain Node, no dependencies). The mock speaks MeTube's HTTP API (recorded from a real instance), simulates the noisy status sequence and writes small fixture files into a sandbox volume. nginx's `/yt/<id>` goes to the mock's watch page via `YOUTUBE_WATCH_URL` (production default unchanged). Only loopback ports, no secrets.

```sh
docker compose -f docker-compose.factory.yml up -d --build --wait
factory/smoke.sh                                   # endpoints, file rules, language, download, failures
docker compose -f docker-compose.factory.yml down -v
```

- UI: http://127.0.0.1:18480, mock inspector (requests the companion sent): http://127.0.0.1:18481.
- Test hooks on the mock: `POST /_mock/reset` (history, cookies and downloads back to the seed), `GET|DELETE /_mock/events`.
- Fixture videos (`CATALOG` in the mock): seeded Big Buck Bunny (video + image) and Me at the zoo (text); `eRsGyueVLvQ` Sintel; `deMockVid01` German; `flaky403Vid` fails once with 403 (auto-retry); any other ID fails as unavailable.
- Parallel runs: `COMPOSE_PROJECT_NAME`, `FACTORY_WEB_PORT`, `FACTORY_MOCK_PORT`. Slower or faster simulated downloads: `FACTORY_MOCK_TICK_MS` (default 250).
- Not mocked: card thumbnails load from `i.ytimg.com` in the browser; browser tests should route them to `factory/mocks/metube/fixtures/thumbnail.jpg`.
- `tests/smoke.sh` stays the end-to-end check against a real MeTube and YouTube.

## Check before committing

```sh
for f in web/*.js web/i18n/*.js extension/*.js; do node --check "$f"; done
node --test   # unit tests in tests/ (i18n coverage)
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

