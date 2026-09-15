# Release verification

PaperBrain is licensed under GPL-3.0-only (see LICENSE).

Verification is manual and local; there are no GitHub Actions workflows or
automatic pre-push hooks. Before pushing a release, run:

```bash
npm ci
npm audit --audit-level=high
npm test
npm run build
git diff --check
docker build -t paperbrain:release-check .
docker compose config --quiet
```

Compose validation requires a configured private .env. Starting or updating your
installation with `docker compose up -d --build` is a separate smoke-test step.

For database integration checks, run the following with TEST_DATABASE_URL pointing
to a fresh, disposable PostgreSQL database:

```bash
TEST_DATABASE_URL='postgresql://USER:PASSWORD@HOST:PORT/DISPOSABLE_DB' node --test test/integration.test.js
```

`npm test` skips database and S3 integration tests unless their test environment
variables are supplied. The database suite exercises registration, login
sessions, upload, metadata, ownership, byte ranges, progress, admin settings,
account revocation, deletion, and logout. Never point it at your own database.

For S3 verification, run an isolated MinIO with credentials release-test /
release-test-password and run:

    TEST_S3_ENDPOINT=http://localhost:9000 node --test test/s3.integration.test.js

The test creates a unique bucket and verifies upload, byte-range streaming,
and deletion after selecting local storage. Use disposable storage.

## Conversion limitations

- Original PDFs retain their layout.
- EPUB and classic MOBI conversion produces text-first PDFs; images, tables,
  publisher styling, and complex layout may be lost. Non-Latin font coverage
  is limited.
- DRM-protected MOBI and KF8-only files are rejected; convert unprotected KF8
  books to EPUB first.
- Tests include generated classic MOBI conversion, malformed input, and DRM
  rejection. Broad publisher compatibility has not been established.
- ISBN detection checks metadata and the first twelve PDF pages; there is
  no OCR for scanned pages.
- EPUB/MOBI conversion uses a persistent, serial background queue with a timeout.
  PDF/audio metadata processing remains synchronous.

## Publishing

### Local verification (2026-09-15)

- Unit tests: 17 passed; the two opt-in integration suites were skipped.
- Production build and whitespace checks passed; dependency audit reported no vulnerabilities.
- Clone instructions now use the public repository URL.
- Integration, install/upgrade, and browser results below are from September 11;
  physical-device and broader real-book compatibility checks remain outstanding.

### Local verification (2026-09-11)

- A previous Node/Vue installation was populated with a demo account, two PDFs,
  audio, and saved progress, then migrated and started with the current code.
  Login, item counts, PDF/audio access, and progress preservation passed.
- Bare-metal-style `npm ci`, migration, build, and `npm start` were exercised
  locally against disposable PostgreSQL. The optional systemd unit has not been
  installed on a host. Screenshot content is generated, not publisher-provided.
- Fresh Docker image startup, automatic migration, readiness, frontend serving,
  registration, queued EPUB conversion, and PDF access were checked locally.

- Expanded HTTP tests cover metadata ownership/ISBN validation, PDF/audio finish
  and reset, password recovery/session revocation, queued EPUB conversion,
  interrupted-job recovery, forced timeout, and retry. Mobile-width Chromium
  checks cover inline metadata editing and automatic queue completion updates.

- Unit tests, production build, dependency audit, and PostgreSQL HTTP tests passed.
- Deletion failure tests verify that file keys and accounts survive storage errors
  and that successful retries remove the records.
- Chromium checks at desktop and 390px mobile viewport: generated PDF destination
  links, saved page after reload, fit-width selection, long-title overflow, and
  short WAV seeking/playback with saved completion passed.
- A disposable PostgreSQL dump and filesystem archive were restored to a separate
  database/storage directory. Login, PDF/audio byte equality, saved progress, and
  decryption of the saved test SMTP credential passed with the original secret.
- Physical iOS/Android and Firefox/Safari were not tested. Broad real-world
  EPUB/MOBI compatibility remains unverified; fixtures are generated.

Deletion is retryable, not atomic across the database and file storage. A partial
storage failure may already have removed some files; records remain so the user
can retry deletion after restoring storage access.

### Release steps

Review git status, keep .env and backups untracked, and verify the public history
contains only intended source files. Include LICENSE and retain dependency
notices; provide matching source alongside any distributed image.

Tag only a commit you have verified locally. Local verification does not publish a tag,
GitHub release, or container image.
