#!/bin/bash
# Builds and signs the key edition's .app for Mac App Store submission, then
# wraps it in a signed .pkg — the packaging step ROADMAP.md 1.4 still needed
# after build-key-sandboxed.sh proved the sandbox itself works.
#
# This is a DIFFERENT pipeline from build-key-sandboxed.sh, not a variant of
# it, because MAS distribution uses different certificates and skips
# notarization entirely:
#
#   - The .app is signed with the Mac App Distribution identity (Keychain
#     shows this as "3rd Party Mac Developer Application: ..." or, on
#     accounts issued the newer unified cert, "Apple Distribution: ..."),
#     NOT the Developer ID Application identity build-key-sandboxed.sh uses.
#     Same two-entitlements-files split applies and for the same reason (see
#     that script's header): the sidecar (zhidang-server) must carry ONLY
#     app-sandbox+inherit or it crashes at libsecinit_appsandbox.
#   - MAS builds are never notarized — App Review is the equivalent gate.
#     Running notarytool against an Apple-Distribution-signed app would just
#     fail (notarization requires a Developer ID signature).
#   - A Mac App Store build must carry an embedded provisioning profile at
#     Contents/embedded.provisionprofile, downloaded from the Certificates,
#     Identifiers & Profiles section of the Apple Developer portal for this
#     app's bundle ID (com.zhangyingfeng.zhidang.key). Tauri's build doesn't
#     know to embed this, so this script copies it in before the final
#     re-sign reseals the bundle.
#   - The .app then gets wrapped in a .pkg signed with the Mac Installer
#     Distribution identity ("3rd Party Mac Developer Installer: ..."),
#     since the App Store doesn't accept .dmg at all.
#
# What this script does NOT do: upload the .pkg or touch App Store Connect.
# Apple deprecated altool for this; the supported path is the Transporter
# app (Mac App Store), which needs interactive sign-in — not something to
# script unattended. Do that part by hand once this script hands you a
# signed .pkg.
set -euo pipefail
cd "$(dirname "$0")/.."

APP_NAME="知档"
APP="src-tauri/target/release/bundle/macos/${APP_NAME}.app"
PKG="/tmp/${APP_NAME}-key-mas.pkg"
TMP_CONF="$(mktemp -t tauri-key-mas-conf).json"
trap 'rm -f "$TMP_CONF"' EXIT

# Both identities are looked up by pattern instead of hardcoded, unlike
# build-key-sandboxed.sh's Developer ID identity: MAS cert display names
# vary by when the account issued them ("3rd Party Mac Developer ..." vs
# the newer unified "Apple Distribution" / "Mac Installer Distribution"
# naming), and we'd rather fail loudly on an ambiguous match than build
# with the wrong one. Override with MAS_APP_IDENTITY / MAS_INSTALLER_IDENTITY
# env vars if your Keychain has more than one match.
find_identity() {
  local pattern="$1" env_override="$2" list_flag="$3"
  if [ -n "${!env_override:-}" ]; then
    echo "${!env_override}"
    return
  fi
  local matches
  matches="$(security find-identity -v $list_flag 2>/dev/null | grep -E "$pattern" || true)"
  local count
  count="$(echo "$matches" | grep -c . || true)"
  if [ "$count" -eq 0 ]; then
    echo "No Keychain identity matching /$pattern/ found. Install the certificate from" >&2
    echo "developer.apple.com first, or set \$$env_override to the exact identity name." >&2
    exit 1
  fi
  if [ "$count" -gt 1 ]; then
    echo "Multiple Keychain identities matching /$pattern/ found:" >&2
    echo "$matches" >&2
    echo "Set \$$env_override to the exact identity name to disambiguate." >&2
    exit 1
  fi
  echo "$matches" | sed -E 's/^[[:space:]]*[0-9]+\)[[:space:]]+[0-9A-F]+[[:space:]]+"([^"]+)"/\1/'
}

APP_IDENTITY="$(find_identity '3rd Party Mac Developer Application|Apple Distribution' MAS_APP_IDENTITY '-p codesigning')"
INSTALLER_IDENTITY="$(find_identity '3rd Party Mac Developer Installer|Mac Installer Distribution' MAS_INSTALLER_IDENTITY '')"
echo "==> App identity: $APP_IDENTITY"
echo "==> Installer identity: $INSTALLER_IDENTITY"

PROVISIONING_PROFILE="${MAS_PROVISIONING_PROFILE:-src-tauri/embedded.mas.provisionprofile}"
if [ ! -f "$PROVISIONING_PROFILE" ]; then
  echo "Missing provisioning profile at $PROVISIONING_PROFILE." >&2
  echo "Create a Mac App Store provisioning profile for com.zhangyingfeng.zhidang.key" >&2
  echo "in the Apple Developer portal, download it, and save it to that path (or set" >&2
  echo "\$MAS_PROVISIONING_PROFILE to point elsewhere)." >&2
  exit 1
fi

echo "==> Patching a temp Tauri config with the MAS signing identity"
jq --arg id "$APP_IDENTITY" '.bundle.macOS.signingIdentity = $id' src-tauri/tauri.key.conf.json > "$TMP_CONF"

echo "==> Building sidecar + .app (first-pass sidecar signing is wrong — fixed below)"
# --bundles app: MAS doesn't use .dmg, only .pkg (built separately below).
# Notarization env vars are unset on purpose — MAS builds are never
# notarized, and Tauri would otherwise try if it finds them set.
env -u APPLE_ID -u APPLE_PASSWORD -u APPLE_TEAM_ID \
  npx tauri build --config "$TMP_CONF" -f key --bundles app

echo "==> Embedding the Mac App Store provisioning profile"
cp "$PROVISIONING_PROFILE" "$APP/Contents/embedded.provisionprofile"

echo "==> Re-signing the sidecar with its own minimal (app-sandbox + inherit) entitlements"
codesign --force --sign "$APP_IDENTITY" \
  --entitlements src-tauri/entitlements.key.child.plist \
  --options runtime \
  "$APP/Contents/MacOS/zhidang-server"

echo "==> Re-sealing the .app bundle (now includes the provisioning profile and the sidecar's new signature)"
codesign --force --sign "$APP_IDENTITY" \
  --entitlements src-tauri/entitlements.key.plist \
  --options runtime \
  "$APP"

echo "==> Verifying before packaging"
codesign --verify --deep --strict "$APP"
codesign -d --entitlements :- "$APP/Contents/MacOS/zhidang-server" | grep -q "com.apple.security.inherit" \
  || { echo "sidecar entitlements missing com.apple.security.inherit — aborting" >&2; exit 1; }
codesign -d --entitlements :- "$APP/Contents/MacOS/app" | grep -q "com.apple.security.network.server" \
  || { echo "main app entitlements missing com.apple.security.network.server — aborting" >&2; exit 1; }
[ -f "$APP/Contents/embedded.provisionprofile" ] \
  || { echo "embedded.provisionprofile missing from the final bundle — aborting" >&2; exit 1; }

echo "==> Packaging as a signed .pkg"
rm -f "$PKG"
productbuild --sign "$INSTALLER_IDENTITY" --component "$APP" /Applications "$PKG"

echo "==> Done: $PKG is signed and ready to upload."
echo "    Remaining steps are manual (see docs/DEVELOPMENT.md): create the App Store"
echo "    Connect app record if you haven't, then upload $PKG with Transporter and"
echo "    submit the build for review."
