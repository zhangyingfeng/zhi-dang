#!/bin/bash
# Compiles the Node backend into a single-file executable (via Bun's native
# compiler) and drops it in src-tauri/binaries/ as a Tauri sidecar, so the
# packaged app doesn't require Node or Bun to be installed on the user's
# machine. Bun bundles TypeScript/ESM natively, so no separate build step is
# needed first.
#
# Takes one optional argument, the edition to build — "login" (default,
# GitHub / Developer ID build) or "key" (App-Store-safe build). Each
# compiles a different entry file (see src/index.login.ts /
# src/index.key.ts) but produces the same "zhidang-server" sidecar name
# either way, since tauri.conf.json / tauri.key.conf.json each only
# ever bundle one edition at a time.
set -euo pipefail
cd "$(dirname "$0")/.."

EDITION="${1:-login}"
case "$EDITION" in
  login) ENTRY="src/index.login.ts" ;;
  key) ENTRY="src/index.key.ts" ;;
  *) echo "Unknown edition '$EDITION' (expected 'login' or 'key')" >&2; exit 1 ;;
esac

if ! command -v bun >/dev/null 2>&1; then
  echo "bun is required to build the sidecar (https://bun.sh) but was not found on PATH" >&2
  exit 1
fi

TARGET_TRIPLE=$(rustc -vV | awk '/^host:/ { print $2 }')
if [ -z "$TARGET_TRIPLE" ]; then
  echo "Could not determine target triple (is rustc on PATH?)" >&2
  exit 1
fi

mkdir -p src-tauri/binaries
OUT="src-tauri/binaries/zhidang-server-$TARGET_TRIPLE"
if [ "$(uname)" = "Windows_NT" ] || [[ "$TARGET_TRIPLE" == *windows* ]]; then
  OUT="$OUT.exe"
fi

echo "==> Compiling backend with Bun ($EDITION edition, $ENTRY)"
bun build "$ENTRY" --compile --outfile "$OUT"

if [ "$(uname)" = "Darwin" ]; then
  codesign --sign - --force "$OUT" 2>/dev/null || true
fi
chmod +x "$OUT"

echo "==> Sidecar built: $OUT ($(du -h "$OUT" | cut -f1))"
