#!/bin/sh
# Builds both packages from the same files into dist/:
#   metube-companion-firefox.xpi     Firefox (manifest.json)
#   metube-companion-chromium.zip    Chromium (Manifest V3 from manifest.chromium.json)
# shared.js and shared.css come from ../web (shared with the web UI).
# TODO(#4): the manifests fix the instance host permission to
# http://localhost:8081/*; make it configurable at runtime.
set -eu
cd "$(dirname "$0")"
mkdir -p dist
python3 - <<'PY'
import zipfile

common = ['compat.js', 'background.js', 'popup.html', 'popup.js',
          'options.html', 'options.js', 'icon-48.png', 'icon-96.png', 'icon-128.png']
# Shared with the web UI: live in ../web and go into the package.
shared = ['shared.js', 'shared.css']

with zipfile.ZipFile('dist/metube-companion-firefox.xpi', 'w', zipfile.ZIP_DEFLATED) as z:
    z.write('manifest.json', 'manifest.json')
    for f in common:
        z.write(f, f)
    for f in shared:
        z.write('../web/' + f, f)

with zipfile.ZipFile('dist/metube-companion-chromium.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    for f in common:
        z.write(f, f)
    for f in shared:
        z.write('../web/' + f, f)
    z.write('manifest.chromium.json', 'manifest.json')
PY
echo "done: dist/metube-companion-firefox.xpi, dist/metube-companion-chromium.zip"
