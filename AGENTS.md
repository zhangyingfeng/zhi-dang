# Repository instructions for coding agents

## Scope

This is a local-only personal content exporter. Preserve that boundary.

## Required checks

Before completing a code change, run:

```bash
npm test
npm run build
```

For a user-visible bug fix, update `CHANGELOG.md`, `docs/BUGFIXES.md`, and the relevant section of `docs/TROUBLESHOOTING.md`.

## Privacy and safety invariants

- Never add real account data, exported content, cookies, tokens, browser profiles, personal names, websites, email addresses, or local absolute paths.
- Never commit `.data/`, export directories, logs, screenshots from real accounts, or captured API responses containing user data.
- Use synthetic fixtures only.
- Do not add telemetry, analytics, remote logging, or upload services.
- Do not implement CAPTCHA bypasses, access-control circumvention, proxy pools, account pools, or rate-limit evasion (see `ACCEPTABLE_USE.md`).
- Keep the server bound to `127.0.0.1`.
- Never make `/api/status` call the third-party service on every UI poll.
- Never overwrite a non-empty output directory without a separately reviewed migration design.

## Data format

- Treat `index.json` as a public schema consumed by other tools.
- Bump `schemaVersion` for breaking changes.
- Preserve numeric metrics as numbers and unavailable values as `null`.
- Record partial failures in `export-report.json`; do not silently ignore them.

## Dependencies

- Prefer the standard library and existing dependencies.
- Explain any new runtime dependency in the PR.
- Do not change the license or legal documents unless explicitly requested.
