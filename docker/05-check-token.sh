#!/bin/sh
# COMPANION_TOKEN goes into the nginx config verbatim, so only allow safe
# characters, and a length that is hard to guess.
set -eu
t="${COMPANION_TOKEN:-}"
[ -z "$t" ] && { echo "token: off (COMPANION_TOKEN empty, no access check)"; exit 0; }
if ! printf '%s' "$t" | grep -Eq '^[A-Za-z0-9._~-]{16,128}$'; then
  echo "token: COMPANION_TOKEN must be 16-128 characters of A-Z a-z 0-9 . _ ~ -" >&2
  exit 1
fi
echo "token: on"
