#!/bin/sh
# Deletes downloads older than RETENTION_DAYS once per hour (0 = keep forever).
# Runs in the background next to nginx; the web UI shows the days left.
set -eu
days="${RETENTION_DAYS:-0}"
case "$days" in ''|*[!0-9]*) echo "cleanup: RETENTION_DAYS must be a number, got '$days'"; exit 1 ;; esac
[ "$days" -gt 0 ] || { echo "cleanup: off (RETENTION_DAYS=0)"; exit 0; }
[ -w /downloads ] || { echo "cleanup: /downloads is not writable, skipping"; exit 0; }
echo "cleanup: deleting files older than $days days in /downloads, hourly"
(
  while true; do
    find /downloads -mindepth 1 -type f -mtime +"$days" -delete 2>/dev/null || true
    find /downloads -mindepth 1 -type d -empty -mtime +"$days" -delete 2>/dev/null || true
    sleep 3600
  done
) &
