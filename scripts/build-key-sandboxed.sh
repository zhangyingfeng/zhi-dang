#!/bin/bash
# Builds, signs, and notarizes the key edition's .app with real App Sandbox
# entitlements — the pipeline `npm run tauri:key` alone can't produce, since
# Tauri applies ONE entitlements file uniformly to every binary in the
# bundle, but the sidecar (zhidang-server) and the main app need DIFFERENT
# entitlements to work under sandbox at all:
#
#   - Main app (src-tauri/entitlements.key.plist): the real capabilities —
#     app-sandbox, network.client (Zhihu API), network.server (the sidecar's
#     own 127.0.0.1:4318 HTTP server — yes, loopback-only listening still
#     needs this), files.user-selected.read-write (save-location writes).
#   - Sidecar (src-tauri/entitlements.key.child.plist): ONLY app-sandbox +
#     inherit. Per Apple's docs, a child process meant to inherit its
#     parent's sandbox must have EXACTLY those two keys — any other App
#     Sandbox entitlement on the child makes the OS try to start an
#     independent sandbox container for it instead of inheriting, which a
#     bare compiled binary (not a proper .app bundle) can't do. Verified
#     empirically: without this fix, zhidang-server crashed immediately at
#     process startup (EXC_BREAKPOINT in libsecinit_appsandbox); with it,
#     the sidecar starts, binds its port, and serves requests normally.
#
# This is why `npm run tauri:key` alone isn't enough: it signs+notarizes+
# staples the .app as one atomic step with the wrong (uniform) entitlements
# baked in, and re-signing the sidecar afterward invalidates that
# notarization ticket. This script instead: lets Tauri build and do its
# first-pass (wrong) signing, immediately re-signs the two binaries with the
# entitlements they actually need, reseals the bundle, and *then* submits
# for notarization — so the final .app's ticket actually matches what's
# on disk.
#
# Produces only the .app (no .dmg) — this build's purpose is to be wrapped
# into a Mac App Store .pkg later (once Mac App Distribution / Mac Installer
# Distribution certs exist), and MAS doesn't use .dmg at all. For the
# Developer-ID .dmg builds regular users download, use `npm run tauri:key`
# unmodified — those aren't sandboxed and don't need any of this.
#
# Requires the same APPLE_ID / APPLE_PASSWORD / APPLE_TEAM_ID environment
# variables as any other notarized build (see docs/MAINTENANCE.md).
set -euo pipefail
cd "$(dirname "$0")/.."

: "${APPLE_ID:?Set APPLE_ID (see docs/MAINTENANCE.md)}"
: "${APPLE_PASSWORD:?Set APPLE_PASSWORD (an app-specific password, not your Apple ID password)}"
: "${APPLE_TEAM_ID:?Set APPLE_TEAM_ID}"

IDENTITY="Developer ID Application: YingFeng Zhang (P38K63763C)"
APP="src-tauri/target/release/bundle/macos/知档.app"

echo "==> Building sidecar + .app (first-pass signing will be wrong for the sidecar — expected, fixed below)"
# tauri.key.conf.json's beforeBuildCommand already runs `npm run
# build:sidecar:key` for us. Skip Tauri's own notarization for this first
# pass: it would notarize the .app with the sidecar's wrong entitlements,
# wasting a submission on an artifact we're about to modify. Unset the
# notarization credentials locally for just this invocation; Tauri still
# signs with $IDENTITY. --bundles app: skip .dmg creation entirely, see
# the header comment for why.
env -u APPLE_ID -u APPLE_PASSWORD -u APPLE_TEAM_ID \
  npx tauri build --config src-tauri/tauri.key.conf.json -f key --bundles app

echo "==> Re-signing the sidecar with its own minimal (app-sandbox + inherit) entitlements"
codesign --force --sign "$IDENTITY" \
  --entitlements src-tauri/entitlements.key.child.plist \
  --options runtime \
  "$APP/Contents/MacOS/zhidang-server"

echo "==> Re-sealing the .app bundle (main executable's entitlements are unchanged, but the bundle's contents hash needs to reflect the sidecar's new signature)"
codesign --force --sign "$IDENTITY" \
  --entitlements src-tauri/entitlements.key.plist \
  --options runtime \
  "$APP"

echo "==> Verifying before spending a real notarization submission on it"
codesign --verify --deep --strict "$APP"
codesign -d --entitlements :- "$APP/Contents/MacOS/zhidang-server" | grep -q "com.apple.security.inherit" \
  || { echo "sidecar entitlements missing com.apple.security.inherit — aborting" >&2; exit 1; }
codesign -d --entitlements :- "$APP/Contents/MacOS/app" | grep -q "com.apple.security.network.server" \
  || { echo "main app entitlements missing com.apple.security.network.server — aborting" >&2; exit 1; }

echo "==> Submitting for notarization (this is the real thing now — entitlements are correct)"
ZIP="/tmp/知档-key-sandboxed.zip"
rm -f "$ZIP"
ditto -c -k --keepParent "$APP" "$ZIP"
xcrun notarytool submit "$ZIP" \
  --apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID" \
  --wait
rm -f "$ZIP"

echo "==> Stapling"
xcrun stapler staple "$APP"

echo "==> Final verification"
codesign --verify --deep --strict "$APP" && echo "codesign OK"
spctl -a -vvv "$APP"
xcrun stapler validate "$APP"

echo "==> Done: $APP is signed, sandboxed, and notarized. No .dmg produced — see this script's header comment for why."
