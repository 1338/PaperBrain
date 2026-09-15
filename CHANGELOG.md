# Changelog

## 0.1.0 — Initial release

- Self-hosted Node.js/Vue library with PostgreSQL and Docker or bare-metal setup.
- PDF reading, MP3/WAV playback, and saved page/time progress.
- EPUB and classic MOBI conversion through a persistent background queue,
  with timeouts, restart recovery, and retries.
- Search by title, author, or ISBN; filter by reading status.
- Extract and edit publication metadata; mark items finished or reset progress.
- Profiles, optional email verification, configurable signup, and user administration.
- Local or S3-compatible file storage and SMTP configuration.
- Shell-based account recovery, backup/restore instructions, and manual local tests.

### Known limitations

Conversion is text-first: complex layouts, images, tables, and some non-Latin text
may not be preserved. DRM-protected MOBI and KF8-only books are unsupported.
There is no OCR. Browser checks have used Chromium, not physical mobile devices
or Safari/Firefox. See [RELEASE.md](RELEASE.md) for verification details.
