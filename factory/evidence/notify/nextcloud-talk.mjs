// managed by glass-factory kit v1.2.0 (8b5ada6), do not edit; change factory/evidence.config.sh or factory/evidence/tests/
// Notify a reviewer in Nextcloud Talk: upload the proof video into the bot
// account's files and share it into a Talk room with a caption, so the video
// plays in the Talk app (also for private repos). Without a video, the caption
// is posted as a plain chat message. Old uploads are removed after
// NC_RETENTION_DAYS (their messages then show the file as gone).
//
//   NC_URL, NC_USER, NC_APP_PASSWORD, NC_TALK_ROOM   (required)
//   NC_FOLDER (default "Evidence"), NC_RETENTION_DAYS (default 30)
//   node nextcloud-talk.mjs --caption "<text>" [--video <file.mp4>] [--name <upload name>]
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: { caption: { type: 'string' }, video: { type: 'string' }, name: { type: 'string' } },
});
const env = process.env;
for (const key of ['NC_URL', 'NC_USER', 'NC_APP_PASSWORD', 'NC_TALK_ROOM']) {
  if (!env[key]) {
    console.log(`[notify] ${key} not set, skipping Nextcloud Talk notification`);
    process.exit(0);
  }
}
if (!args.caption) throw new Error('--caption is required');

const base = env.NC_URL.replace(/\/+$/, '');
const folder = env.NC_FOLDER || 'Evidence';
const retentionDays = Number(env.NC_RETENTION_DAYS || 30);
const auth = 'Basic ' + Buffer.from(`${env.NC_USER}:${env.NC_APP_PASSWORD}`).toString('base64');
const dav = `${base}/remote.php/dav/files/${encodeURIComponent(env.NC_USER)}/${encodeURIComponent(folder)}`;
const ocs = { Authorization: auth, 'OCS-APIRequest': 'true', Accept: 'application/json' };

async function call(method, url, { headers = {}, body, ok = [] } = {}) {
  const res = await fetch(url, { method, headers: { Authorization: auth, ...headers }, body });
  if (!res.ok && !ok.includes(res.status)) {
    throw new Error(`${method} ${url.replace(base, '')} -> HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return res;
}

async function postMessage(message) {
  await call('POST', `${base}/ocs/v2.php/apps/spreed/api/v1/chat/${env.NC_TALK_ROOM}`, {
    headers: { ...ocs, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
}

async function shareVideo(file, name) {
  await call('MKCOL', dav, { ok: [405] }); // 405: folder exists
  const safeName = path.basename(name).replace(/[^A-Za-z0-9._-]/g, '_');
  await call('PUT', `${dav}/${encodeURIComponent(safeName)}`, {
    headers: { 'Content-Type': 'video/mp4' },
    body: fs.readFileSync(file),
  });
  const form = new URLSearchParams({
    path: `/${folder}/${safeName}`,
    shareType: '10', // Talk room
    shareWith: env.NC_TALK_ROOM,
    talkMetaData: JSON.stringify({ caption: args.caption }),
  });
  await call('POST', `${base}/ocs/v2.php/apps/files_sharing/api/v1/shares`, {
    headers: { ...ocs, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  });
}

async function cleanup() {
  const res = await call('PROPFIND', dav, {
    headers: { Depth: '1', 'Content-Type': 'application/xml' },
    body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getlastmodified/></d:prop></d:propfind>',
    ok: [404],
  });
  if (res.status === 404) return;
  const xml = await res.text();
  const cutoff = Date.now() - retentionDays * 86400_000;
  for (const [, href, modified] of xml.matchAll(/<d:href>([^<]+)<\/d:href>[\s\S]*?<d:getlastmodified>([^<]+)<\/d:getlastmodified>/g)) {
    if (href.endsWith('/') || Date.parse(modified) >= cutoff) continue;
    await call('DELETE', new URL(href, base).href, { ok: [404] });
    console.log(`[notify] removed old upload ${decodeURIComponent(href.split('/').pop())}`);
  }
}

if (args.video && fs.existsSync(args.video)) {
  await shareVideo(args.video, args.name || path.basename(args.video));
  console.log(`[notify] video shared into Talk room ${env.NC_TALK_ROOM}`);
} else {
  await postMessage(args.caption);
  console.log(`[notify] message posted to Talk room ${env.NC_TALK_ROOM} (no video)`);
}
await cleanup().catch((err) => console.log(`[notify] cleanup skipped: ${err.message}`));
