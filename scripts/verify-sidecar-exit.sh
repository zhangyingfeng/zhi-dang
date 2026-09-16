#!/bin/bash
# Launches a built 知档.app, confirms its zhidang-server sidecar is running,
# quits the app normally (AppleScript "quit", same as Dock -> Quit or Cmd+Q),
# and confirms the sidecar process is actually gone afterward.
#
# Guards against the sidecar outliving the app: tauri_plugin_shell does NOT
# tie a spawned sidecar's lifetime to the parent app, so without an explicit
# kill on exit the process gets reparented to launchd and stays bound to its
# port. A later launch of the same (or the other) edition can then silently
# end up talking to that stale process instead of its own fresh one. See
# docs/BUGFIXES.md's "退出应用后，后端 sidecar 进程没有一起退出" entry.
#
# Usage: scripts/verify-sidecar-exit.sh <path-to-app> [app-display-name]
set -euo pipefail

APP_PATH="${1:?Usage: $0 <path-to-.app> [app-display-name]}"
APP_NAME="${2:-$(basename "$APP_PATH" .app)}"

if [ ! -d "$APP_PATH" ]; then
  echo "App bundle not found: $APP_PATH" >&2
  exit 1
fi

echo "==> Launching $APP_PATH"
open "$APP_PATH"

echo "==> Waiting for the sidecar to start..."
SIDECAR_PID=""
for _ in $(seq 1 20); do
  SIDECAR_PID="$(pgrep -f 'zhidang-server' || true)"
  [ -n "$SIDECAR_PID" ] && break
  sleep 0.5
done

if [ -z "$SIDECAR_PID" ]; then
  echo "FAIL: sidecar never started within 10s" >&2
  exit 1
fi
echo "    sidecar running as pid(s): $SIDECAR_PID"

echo "==> Quitting $APP_NAME..."
osascript -e "tell application \"$APP_NAME\" to quit"

echo "==> Waiting for the app and its sidecar to exit..."
sleep 3

STILL_RUNNING="$(pgrep -f 'zhidang-server' || true)"
if [ -n "$STILL_RUNNING" ]; then
  echo "FAIL: sidecar still running after quit (pid(s): $STILL_RUNNING)" >&2
  echo "      kill it manually: kill $STILL_RUNNING" >&2
  exit 1
fi

echo "PASS: sidecar exited along with the app"
