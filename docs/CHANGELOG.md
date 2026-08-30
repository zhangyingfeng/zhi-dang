# Changelog

## 1.1.1

Fixes a regression shipped in 1.1.0: logging out threw partway through cleanup (two leftover references to the `#reveal` element removed when the export/reveal buttons were merged into one) and silently aborted the rest of the handler — the task list and status card stayed visible, and "开始导出" would incorrectly claim "登录状态已丢失" on the next click before finally resetting. No other behavior changes.

## 1.1.0

Stable release of the 1.1 export-UX rework: list-first task view, per-item/subtask status, exact-content duplicate flags, pause/skip, and resume into an existing output directory. Everything below through preview.1 is the changelog of how this release was built — see those entries for the individual fixes and design decisions. Feature set is frozen as the baseline for 1.2's Apple Developer ID signing work.

On top of preview.3, this release also folds in:

- Fixed logging out leaving the previous export's task list (and its "在访达中显示" button) visible: the logout handler never cleared the frontend's task list, and even after clearing it the polling loop would repopulate it within ~1.2s from the backend's still-live progress state (logout only clears the Tauri-side login session, it doesn't touch the Node server). Added `POST /api/reset` and gated the polling loop on login state.
- Merged "开始导出"/"在访达中显示" into a single button that swaps label and behavior instead of disabling one and showing a second one next to it: it becomes "在访达中显示" only while "保存位置" still points at the directory that just finished, and flips back to "开始导出" the moment that changes.
- Added a completion notification (via the plain Web Notification API — WKWebView routes it to the real macOS notification center) so a long export doesn't require watching the window. Sound follows the system's own notification settings; the app doesn't play one itself.

## 1.1.0-preview.3

Third and final slice of the 1.1 export-UX rework — the "完善" (stabilization) stage. Feature set is now frozen as the baseline for 1.2's signing work.

- Resume into an existing output directory: pointing a new export at a directory this tool already wrote to (whether it finished cleanly last time or was interrupted) reuses whatever already succeeded instead of redoing it, and keeps previously-skipped items skipped. Only genuinely new or previously-failed items get (re)processed. This is a same-app-restart resume, not a background/always-on download — see docs/DEVELOPMENT.md.
- `index.json`/`export-report.json`/`README.md` are now written after every item, not just once at the end, with atomic (temp-file + rename) writes — the mechanism that makes the above possible: an interrupted run leaves a real manifest behind instead of nothing.
- The output-directory safety check now allows a non-empty directory if it's recognizably this tool's own (`export-report.json` present), instead of requiring empty.
- UI polish from real-machine testing: the row expand toggle was a 10px glyph with almost no padding, now a proper ~24×23px tap target; the About panel's website link points at yingfeng.ca/zhi-dang instead of the bare domain; logging out resets the save-location field back to `exports` instead of leaving the previous account's username in it.

## 1.1.0-preview.2

Second slice of the 1.1 export-UX rework — the "管理" (control) stage: adds control over an already-running export, on top of preview.1's read-only task list.

- Pause/resume for a running export, via a button on the status card. This is a same-process pause only — it stops the loop between items (and again between an item's image/write subtasks) so it takes effect promptly, but it does not survive quitting the app; resume-after-restart is a separate, later "完善" stage.
- Per-item skip: a "跳过" button appears in each row's reserved actions slot while the item is still "未开始". Skipping excludes it from the download entirely — it's recorded in `export-report.json`'s new `skippedItems` list, not counted as a failure. This is also the mechanism for resolving a "疑似重复" flag from preview.1: skip whichever copy you don't want.
- Per-item image skip: a "跳过图片" button next to the "图片" subtask in the expanded detail panel, while that subtask is still pending — keeps the text content but doesn't localize images for that one item.
- Both skip actions are restricted to items/subtasks that haven't started yet — an in-flight or already-finished item can't be retroactively un-done through this UI, since that would mean touching a file already written.
- Skipped rows are dimmed with a strikethrough title instead of the red error color, since it's a deliberate choice rather than a failure.
- Backend: `POST /api/export/{pause,resume,skip}`; added `test/exporter.test.ts` with integration tests against `Exporter.export` directly (no network) covering skip, pause, and images-only skip.

## 1.1.0-preview.1

First slice of the 1.1 export-UX rework (see ROADMAP.md's 阶段3) — the "展示" (visibility) stage: replaces the single opaque progress bar with a per-item task list, still fully automatic (no pause/skip/merge actions yet — those are the next "管理" stage).

- Export now shows a list of every discovered answer/article as soon as listing finishes — before any content is downloaded — with a per-row status (未开始/进行中/完成/失败). Rows patch in place across polls rather than re-rendering, so scroll position and expanded rows survive.
- Each row expands to show subtask detail: image download and file-write status, plus a per-image breakdown (URL, status, error) instead of one opaque "images" badge.
- Exact-content duplicate detection: items are grouped by a hash of their normalized (tag-stripped) body text — e.g. catches the same essay posted as both an answer and an article. Flagged rows get a read-only "疑似重复" badge naming the matching titles; this is hash-equality only, no fuzzy/similarity matching, and doesn't do anything with the result yet — that's the next stage.
- Row layout is dot → kind badge (回答/文章) → title → an actions slot that today only holds the expand toggle, reserved so the next stage's pause/skip/merge controls don't require redoing the layout.
- Condensed the settings panel from 7 rows to 3 (save-location label/input/browse on one row; checkbox + action buttons on one row; the "won't overwrite existing content" hint moved to a tooltip) so more window height goes to the task list.
- Removed the post-login status line, which duplicated the footer's identical sentence.
- Status card and progress bar switched from a hardcoded near-black panel to the same adaptive system colors as the rest of the app; the progress bar's native browser chrome (which added visible height beyond its declared 4px) is now stripped in favor of styled pseudo-elements.
- Added a custom "关于" panel showing version, author, website, license, and source repo links. It's reachable both from a footer button and from the macOS menu bar's "About 知档" item — the two are unified: the menu bar's default `PredefinedMenuItem::about` is swapped out in `lib.rs` for a custom item that emits an event the frontend listens for, instead of leaving the app with two disconnected "about" surfaces.
- Fixed the About panel's website link failing with "Not allowed to open url": `opener:allow-open-url` only permits calling the `open_url` command itself, not any particular URL — added the companion `opener:allow-default-urls` permission, which is the one that actually grants the `https://*` scope.
- Fixed the About panel's website/source links rendering invisible: `color:AccentColor` doesn't reliably resolve to a visible color as *text* color in this WKWebView (the same class of bug as `AccentColorText` on buttons, see preview.5) — switched `.link-inline` to the app's own brand blue instead.
- Relicensed from the Unlicense to the MIT License.

## 1.0.0

First stable release of the Tauri-based desktop rewrite (`v1-tauri`), merged into `main`. Packaged as a standalone macOS app (Apple Silicon): no Node.js, npm, or Chrome install required. Everything below through preview.1 is the changelog of how this release was built — see those entries for the individual fixes and design decisions. Known limits at this release: macOS-only (Windows/Linux/Intel Mac untested), no Apple Developer notarization (Gatekeeper shows a dismissable "unidentified developer" prompt on first launch), and export runs to completion in one pass — pause/resume is planned for a later 1.x release.

## 1.0.0-preview.6

- Fixed the packaged `.app` failing to open at all when downloaded normally (via a browser): it had no code signature covering the bundle as a whole (Rust's linker only signs the executable, leaving `Sealed Resources=none`), and on current macOS an unsigned, quarantined app is rejected outright ("已损坏，无法打开", no bypass) rather than showing the dismissable "unidentified developer" prompt. Set `bundle.macOS.signingIdentity: "-"` in `tauri.conf.json` so `tauri build` ad-hoc-signs the full bundle (including the sidecar) automatically; verified end to end with a real quarantine flag — now shows the expected two-step Gatekeeper prompt ("系统设置 → 隐私与安全性 → 仍要打开") instead of failing outright. **preview.5's published `.app`/`.dmg` are affected by this bug and should not be used — see its release notes.**

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
