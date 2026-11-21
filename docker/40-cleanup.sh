#!/bin/sh
# Deletes downloads older than RETENTION_DAYS once per hour (0 = keep forever).
# Runs in the background next to nginx; the web UI shows the days left.
# Hidden files and folders are skipped: MeTube keeps its state (history,
# cookies, subscriptions) in /downloads/.metube by default, and .tmp holds
# running downloads.
set -eu
days="${RETENTION_DAYS:-0}"
case "$days" in ''|*[!0-9]*) echo "cleanup: RETENTION_DAYS must be a number, got '$days'"; exit 1 ;; esac
[ "$days" -gt 0 ] || { echo "cleanup: off (RETENTION_DAYS=0)"; exit 0; }
[ -w /downloads ] || { echo "cleanup: /downloads is not writable, skipping"; exit 0; }
echo "cleanup: deleting files older than $days days in /downloads, hourly"
(
  while true; do
    find /downloads -mindepth 1 -name '.*' -prune -o -type f -mtime +"$days" -print0 2>/dev/null \
      | xargs -0 -r rm -f 2>/dev/null || true
    find /downloads -mindepth 1 -name '.*' -prune -o -type d -empty -mtime +"$days" -print0 2>/dev/null \
      | xargs -0 -r rmdir 2>/dev/null || true
    sleep 3600
  done
) &
