#!/bin/bash
# Compiles the Node backend into a single-file executable (via Bun's native
# compiler) and drops it in src-tauri/binaries/ as a Tauri sidecar, so the
# packaged app doesn't require Node or Bun to be installed on the user's
# machine. Bun bundles TypeScript/ESM natively, so no separate build step is
# needed first.
set -euo pipefail
cd "$(dirname "$0")/.."

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

echo "==> Compiling backend with Bun"
bun build src/server.ts --compile --outfile "$OUT"

if [ "$(uname)" = "Darwin" ]; then
  codesign --sign - --force "$OUT" 2>/dev/null || true
fi
chmod +x "$OUT"

echo "==> Sidecar built: $OUT ($(du -h "$OUT" | cut -f1))"
