# Changelog

## 1.0.0-preview.5

- Made the export-settings screen the app's primary view instead of a separate login step: on launch the app now silently checks for an existing session (the login window is created hidden at startup rather than only on click), so a returning user who hasn't logged out skips straight to a usable screen. When not logged in, export controls are disabled and a single title-bar button ("开始登录") is the primary action; after signing in it becomes a secondary "退出登录" button and the heading reads "欢迎 {name}，可以下载".
- Fixed the main window's height calculation: it's now measured from the actual rendered content (last element's `getBoundingClientRect`, not `body.scrollHeight` — the latter silently drops `<main>`'s `margin-top` to CSS margin collapse) and re-checked/topped-up after resizing if still short, instead of guessed constants.
- Made the main window non-resizable, since its height is fully content-driven — manual resizing just reintroduced clipped content / scrollbars.
- Fixed unreadable button text: `AccentColorText` wasn't resolving to a usable color in this WKWebView, so button text switched to a literal white.
- Fixed the app icon rendering with sharp corners in the Dock: it was full-bleed with no self-drawn radius on the assumption that macOS applies its own squircle mask uniformly, but real-world testing showed that isn't reliable. Baked the corner radius into the source image directly instead.
- Synced README and the troubleshooting guide with the login-as-gate restructure above.

## 1.0.0-preview.4

UI/UX pass on top of the preview.3 rewrite, plus account switching and the documentation rewrite that preview.1 flagged as a known gap.

- Reworked the UI to follow macOS system appearance instead of a fixed light/blue theme: CSS system color keywords (`Canvas`/`Field`/`AccentColor`) with `color-scheme: light dark`, so the app tracks light/dark mode and the user's accent color.
- Dropped the header/logo block from the main window — redundant with the window titlebar, which already shows the app name.
- Main window now grows/shrinks to fit the current step (small for sign-in, larger once export settings are shown) instead of a fixed oversized size.
- Fixed a bug where the status bar showed on the sign-in screen: `.status{display:flex}` outranked the `[hidden]` attribute's default `display:none`.
- Added account switching: a "退出登录" control clears the login window's session and returns to the sign-in step.
- The export directory now defaults to the signed-in account's `url_token`, so switching accounts no longer risks exporting into the same folder.
- Export controls (export button, directory picker, image checkbox, logout) are now disabled while an export is running, with the export button relabeled "导出中…".
- Rewrote README, PRIVACY, SECURITY, ROADMAP, AGENTS, and the troubleshooting guide to describe the `v1-tauri` architecture (embedded login window, OS-managed WebView session, sidecar packaging) instead of the retired 0.3.x Playwright/Chrome setup, closing the documentation gap noted in preview.1.
- Replaced create-tauri-app's default placeholder icon (unrelated yellow/cyan rings) with a real app icon: the "档" character in Hiragino Sans GB W6 on the existing brand blue, regenerated as the full icon set via `tauri icon`.

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
