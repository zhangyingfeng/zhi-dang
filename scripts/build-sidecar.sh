#!/bin/bash
# Builds the Node backend into a single-file executable (Node's SEA feature)
# and drops it in src-tauri/binaries/ as a Tauri sidecar, so the packaged app
# doesn't require Node to be installed on the user's machine.
set -euo pipefail
cd "$(dirname "$0")/.."

TARGET_TRIPLE=$(rustc -vV | awk '/^host:/ { print $2 }')
if [ -z "$TARGET_TRIPLE" ]; then
  echo "Could not determine target triple (is rustc on PATH?)" >&2
  exit 1
fi

WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"' EXIT

echo "==> Building Node backend"
npm run build

echo "==> Bundling into a single CommonJS file"
npx esbuild dist/src/server.js --bundle --platform=node --format=cjs \
  --outfile="$WORK_DIR/bundle.cjs"

echo "==> Generating SEA blob"
cat > "$WORK_DIR/sea-config.json" <<EOF
{
  "main": "$WORK_DIR/bundle.cjs",
  "output": "$WORK_DIR/sea-prep.blob",
  "disableExperimentalSEAWarning": true
}
EOF
node --experimental-sea-config "$WORK_DIR/sea-config.json"

mkdir -p src-tauri/binaries
OUT="src-tauri/binaries/zhidang-server-$TARGET_TRIPLE"
if [ "$(uname)" = "Windows_NT" ] || [[ "$TARGET_TRIPLE" == *windows* ]]; then
  OUT="$OUT.exe"
fi

echo "==> Injecting blob into a copy of the node binary"
cp "$(command -v node)" "$OUT"
if [ "$(uname)" = "Darwin" ]; then
  codesign --remove-signature "$OUT" 2>/dev/null || true
fi
npx --yes postject "$OUT" NODE_SEA_BLOB "$WORK_DIR/sea-prep.blob" \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 \
  --macho-segment-name NODE_SEA
if [ "$(uname)" = "Darwin" ]; then
  codesign --sign - "$OUT" 2>/dev/null || true
fi
chmod +x "$OUT"

echo "==> Sidecar built: $OUT ($(du -h "$OUT" | cut -f1))"
