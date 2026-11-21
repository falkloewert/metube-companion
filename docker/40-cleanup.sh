#!/bin/sh
# Housekeeping once per hour, in the background next to nginx; the web UI
# shows the days left.
# - RETENTION_DAYS: deletes downloads older than this (0 = keep forever).
# - TRASH_DAYS: empties /downloads/.trash/<unix time>/ folders (the UI moves
#   deleted videos there) once they are older than this. The folder name is
#   the time of the move, because a move keeps the file's own age. 0 = no
#   trash: the UI deletes files right away, and numeric folders still in
#   .trash (from an earlier TRASH_DAYS) are emptied, so no invisible files
#   stay behind.
# CLEANUP_INTERVAL (seconds, default 3600) exists for the smoke test.
# Hidden files and folders are skipped by the RETENTION_DAYS pass: MeTube
# keeps its state (history, cookies, subscriptions) in /downloads/.metube by
# default, .tmp holds running downloads, .trash is handled by the second pass.
set -eu
days="${RETENTION_DAYS:-0}"
trash="${TRASH_DAYS:-0}"
case "$days" in ''|*[!0-9]*) echo "cleanup: RETENTION_DAYS must be a number, got '$days'"; exit 1 ;; esac
case "$trash" in ''|*[!0-9]*) echo "cleanup: TRASH_DAYS must be a number, got '$trash'"; exit 1 ;; esac
[ "$days" -gt 0 ] || [ "$trash" -gt 0 ] || [ -d /downloads/.trash ] || { echo "cleanup: off (RETENTION_DAYS=0, TRASH_DAYS=0)"; exit 0; }
[ -w /downloads ] || { echo "cleanup: /downloads is not writable, skipping"; exit 0; }
[ "$days" -eq 0 ] || echo "cleanup: deleting files older than $days days in /downloads, hourly"
[ "$trash" -eq 0 ] || echo "cleanup: emptying the trash after $trash days, hourly"
[ "$trash" -gt 0 ] || [ ! -d /downloads/.trash ] || echo "cleanup: TRASH_DAYS=0, emptying the old trash"
(
  while true; do
    if [ "$days" -gt 0 ]; then
      # Change time too: a file restored from the trash keeps its mtime, but
      # the move updates ctime, so it gets a fresh start. A chown (MeTube at
      # start) also resets ctime; that only delays the deletion, the safe side.
      # BusyBox find has a broken -ctime (it compares mtime), hence stat %Z.
      cut=$(( $(date +%s) - days * 86400 ))
      find /downloads -mindepth 1 -name '.*' -prune -o -type f -mtime +"$days" \
        -exec sh -c 'cut=$1; shift; for f; do [ "$(stat -c %Z "$f")" -le "$cut" ] && rm -f "$f"; done; true' sh "$cut" {} + 2>/dev/null || true
      find /downloads -mindepth 1 -name '.*' -prune -o -type d -empty -mtime +"$days" -print0 2>/dev/null \
        | xargs -0 -r rmdir 2>/dev/null || true
    fi
    if [ -d /downloads/.trash ]; then
      # TRASH_DAYS=0: limit is "now", every numeric folder goes.
      limit=$(( $(date +%s) - trash * 86400 ))
      for d in /downloads/.trash/*; do
        # Only <unix time> folders; anything else in there is not ours.
        case "${d##*/}" in ''|*[!0-9]*) continue ;; esac
        [ -d "$d" ] && [ ! -L "$d" ] && [ "${d##*/}" -le "$limit" ] && rm -rf "$d" 2>/dev/null || true
      done
      # Folders left empty by "Restore" (not the one a move is just filling).
      find /downloads/.trash -mindepth 1 -type d -empty -mmin +60 -print0 2>/dev/null \
        | xargs -0 -r rmdir 2>/dev/null || true
    fi
    sleep "${CLEANUP_INTERVAL:-3600}"
  done
) &
