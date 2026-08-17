# Changelog

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
