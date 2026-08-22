# Changelog

## Unreleased

- Rewrote README, PRIVACY, SECURITY, ROADMAP and AGENTS to describe the `v1-tauri` architecture (embedded login window, OS-managed WebView session, sidecar packaging) instead of the retired 0.3.x Playwright/Chrome setup, closing the documentation gap noted in preview.1.

## 1.0.0-preview.3

- Switched the sidecar build from Node's SEA (a full copy of the Node runtime) to Bun's native `bun build --compile`, cutting the packaged app from 116MB to 75MB (DMG: 41MB to 29MB). Bun bundles TypeScript/ESM directly, so `scripts/build-sidecar.sh` no longer needs a separate esbuild/SEA pipeline. Building the sidecar now requires Bun instead of Node's experimental SEA feature; verified with a full login + 168-item export, identical results to the Node SEA build.

## 1.0.0-preview.2

- Stripped debug symbols from the bundled Node sidecar, cutting the packaged app from 151MB to 116MB (DMG: 46MB to 41MB). The sidecar is a full copy of the Node runtime (SEA), which remains the bulk of the app's size.

## 1.0.0-preview.1

Preview build of the Tauri-based desktop rewrite (`v1-tauri` branch), not yet merged to `main`. Packaged as a standalone macOS app: no Node.js, npm, or Chrome install required.

- Replaced the standalone Chrome window (Playwright) with an embedded login window; the app now detects login completion automatically and prompts when it's safe to close the window.
- Replaced Playwright entirely. Zhihu API calls run as `fetch()` inside the login window's own page context; image downloads use a plain HTTP request. No browser automation dependency remains.
- Packaged the Node backend as a self-contained sidecar executable (no Node install required on the target machine) and wired it into a real `tauri build`, producing an installable `.app`/`.dmg`.
- Known gaps before this becomes 1.0: documentation (README, ROADMAP, TROUBLESHOOTING, etc.) still describes the 0.3.x Playwright architecture and needs a full rewrite; only tested on macOS so far.

## 0.3.3

- Closed the login browser on `SIGINT`/`SIGTERM` instead of leaving an orphaned Chrome process holding the profile lock, which had been causing `launchPersistentContext` to fail on the next login attempt.
- Re-enabled Chromium's OS sandbox for the login browser instead of relying on Playwright's insecure `--no-sandbox` default.

## 0.3.2

- Stopped pagination from grinding through the full safety cap when Zhihu returned a repeating `next` cursor, failing fast with a clear error instead.
- Extracted pagination, deduplication and item normalization into standalone functions and covered them with automated tests.

## 0.3.1

- Compared reported totals with raw pagination records before deduplication, and recorded discrepancies instead of aborting a usable export.
- Recreated the browser context automatically when the login window had been closed.

## 0.3.0

- Prevented status polling from repeatedly calling the third-party account endpoint.
- Refused protected or non-empty output directories to prevent accidental overwrites.
- Added pagination completeness checks and duplicate item filtering.
- Added question IDs, optional favorite counts and cover fields.
- Added image retry, failure reporting and lazy-image cleanup.
- Added export completeness reports and schema versioning.
- Removed account name, profile text and account identifier from exported metadata.
- Added repository privacy, security, contribution and maintenance documentation.
- Dedicated the project to the public domain under the Unlicense.

## 0.2.0

- Improved image localization and export metadata.

## 0.1.0

- Initial local archive tool.
