#!/bin/sh
set -eu
ROOT=/media/developer/telesera
PREVIOUS=$(cat "$ROOT/private/previous-release")
case "$PREVIOUS" in "$ROOT"/releases/*) ;; *) echo 'No valid prior release recorded.' >&2; exit 1;; esac
[ -x "$PREVIOUS/engine" ] || exit 1
if [ -r "$ROOT/private/engine.pid" ]; then
 PID=$(cat "$ROOT/private/engine.pid")
 case "$PID" in *[!0-9]*|'') ;; *)
  if [ -r "/proc/$PID/cmdline" ] && tr '\000' ' ' < "/proc/$PID/cmdline" | grep -q "$ROOT/current/engine"; then kill "$PID"; fi;;
 esac
fi
ln -sfn "$PREVIOUS" "$ROOT/current"
[ ! -f "$ROOT/private/config.previous.json" ] || cp "$ROOT/private/config.previous.json" "$ROOT/private/config.json"
/var/lib/webosbrew/init.d/25-telesera
printf '%s\n' 'Previous release restored; account session retained.'
