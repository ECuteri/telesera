#!/bin/sh
set -eu
ROOT=/media/developer/telesera
PREVIOUS=$(cat "$ROOT/private/previous-release")
case "$PREVIOUS" in "$ROOT"/releases/*) ;; *) echo 'No valid prior release recorded.' >&2; exit 1;; esac
[ -x "$PREVIOUS/engine" ] || exit 1
/var/lib/webosbrew/init.d/25-telesera stop
ln -sfn "$PREVIOUS" "$ROOT/current"
[ ! -f "$ROOT/private/config.previous.json" ] || cp "$ROOT/private/config.previous.json" "$ROOT/private/config.json"
/var/lib/webosbrew/init.d/25-telesera
printf '%s\n' 'Previous release restored; account session retained.'
