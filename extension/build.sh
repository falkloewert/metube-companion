#!/bin/sh
# Builds both packages from the same files into dist/:
#   metube-companion-firefox.xpi     Firefox (manifest.json)
#   metube-companion-chromium.zip    Chromium (Manifest V3 from manifest.chromium.json)
# shared.js and shared.css come from ../web (shared with the web UI).
set -eu
cd "$(dirname "$0")"
mkdir -p dist
python3 - <<'PY'
import zipfile

common = ['compat.js', 'background.js', 'popup.html', 'popup.js',
          'options.html', 'options.js', 'icon-48.png', 'icon-96.png', 'icon-128.png']
# Shared with the web UI: live in ../web and go into the package.
shared = ['shared.js', 'shared.css']

for pkg, manifest in [
    ('dist/metube-companion-firefox.xpi', 'manifest.json'),
    ('dist/metube-companion-chromium.zip', 'manifest.chromium.json'),
]:
    with zipfile.ZipFile(pkg, 'w', zipfile.ZIP_DEFLATED) as z:
        z.write(manifest, 'manifest.json')
        for f in common:
            z.write(f, f)
        for f in shared:
            z.write('../web/' + f, f)
PY
echo "done: dist/metube-companion-firefox.xpi, dist/metube-companion-chromium.zip"
