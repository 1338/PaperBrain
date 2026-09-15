# PaperBrain Functionality Index

PaperBrain is a Node.js and Vue 3 web application for building a personal reading and listening library. It supports EPUB, MOBI, PDF, MP3, and WAV media using a Vue single-page application, Express JSON API, and PostgreSQL persistence.

## User-facing pages

| Path | Access | Functionality |
|---|---|---|
| `/` | Public | Product landing page with links to register or log in. |
| `/register` | Guests | Account creation with display name, email, password, and terms acceptance. |
| `/login` | Guests | Email/password login with an optional seven-day remember-me session. |
| `/library` | Authenticated users | Protected personal-library page and empty state. |
| `/library/:id/read` | Authenticated owner | Renders a converted PDF one page at a time and restores saved progress. |
| `/library/:id/listen` | Authenticated owner | Plays MP3/WAV audio and restores saved playback position. |
| `/admin` | Administrators | Manages instance access policy, SMTP, and users. |
| `/verify-email` | Public token holder | Completes email verification. |
| `/profile` | Authenticated users | Changes display name, email address, and password. |

Vue Router handles client-side navigation. Guest-only pages redirect authenticated users to the library, while the library redirects guests to login and preserves the intended destination.

## Account functionality

### Registration

- Collects display name, email, password, and terms acceptance.
- Normalizes email addresses to lowercase.
- Validates display-name and email lengths, email shape, password length, and terms acceptance on the server.
- Requires passwords between 6 and 4,096 characters.
- Hashes passwords with bcrypt at cost factor 12.
- Enforces unique emails in PostgreSQL.
- Starts an authenticated session immediately after registration.

### Authentication and sessions

- Authenticates with email and password.
- Regenerates the session after login to prevent session fixation.
- Stores sessions in PostgreSQL rather than process memory.
- Uses HTTP-only, same-site cookies.
- Supports browser-session cookies or a seven-day remember-me lifetime.
- Provides a session endpoint so the Vue application can restore the current user after a reload.
- Uses a per-session CSRF token for logout.
- Exposes only safe user properties to the browser; password hashes are omitted.
- Supports logout and removes the session cookie.

Every user receives `ROLE_USER` in the persisted roles array.

The first instance account receives `ROLE_ADMIN`. Administrators can control public signup, require email verification, configure encrypted SMTP credentials, send a test message, and manage user access. They can also select local filesystem or private S3-compatible object storage, configure custom endpoints and path-style URLs, and test bucket access. Existing installations promote the oldest user only when no administrator exists.

## EPUB conversion and reading

- Accepts authenticated EPUB, MOBI, PDF, MP3, and WAV uploads up to 100 MB by default.
- Checks the extension and EPUB-compatible MIME type.
- Rejects archives that expand beyond 200 MB to limit ZIP-bomb memory use.
- Reads EPUB metadata and spine order using Node.js.
- Extracts and check-digit validates ISBN-10/ISBN-13 identifiers from EPUB, PDF, and audiobook metadata.
- Converts readable chapter markup into a paginated A4 PDF.
- Parses MOBI metadata and chapters and converts them into the same PDF reading format.
- Creates a title page, chapter breaks, book metadata, and page-number footers.
- Stores both the original EPUB and generated PDF outside the public web root.
- Exposes PDFs only through an authenticated ownership-checked endpoint.
- Presents the PDF using PDF.js rather than the browser’s EPUB renderer.
- Saves the current PDF page after navigation and when leaving the reader.
- Shows page count and percentage progress in the library.
- Allows failed conversions to be retried from the retained source EPUB.
- Allows owners to delete a library item and all of its stored source/derived files.
- Owners can edit a ready item's title, author, and validated ISBN without changing the original file.
- Owners can mark ready items finished or reset their saved page/audio progress to not started.
- EPUB/MOBI uploads and retries enter a persistent background queue; the library polls for completion.
- Conversion runs in a separate process with a configurable timeout and resumes interrupted jobs after restart.
- Shell administrators can reset passwords and revoke sessions with `npm run account:recover`; see README.

The converter prioritizes consistent pagination and readable text. Embedded EPUB images and publisher-specific visual styling are not currently copied into the generated PDF.

## Direct PDF and audio support

- Accepts standalone PDF files and reads their page count without reconversion.
- Extracts title, author, and ISBN metadata from standalone PDFs when available.
- Opens uploaded PDFs in the same PDF.js reader used by converted EPUBs.
- Accepts MP3 and WAV audio with content-signature validation.
- Streams private audio through an authenticated, ownership-checked endpoint.
- Provides custom audio playback controls and saves playback time and duration.
- Restores audio at the previously saved position.
- Shows page-based progress for documents and time-based progress for audio.

## Library domain

The PostgreSQL schema includes user-owned library items:

| Field | Purpose |
|---|---|
| `id` | Generated library-item identifier |
| `user_id` | Owning user; cascades on user deletion |
| `title`, `author`, `isbn` | Extracted publication metadata |
| `original_filename` | Name of the uploaded file |
| `epub_path`, `pdf_path` | Private storage locations |
| `status`, `error_message` | Conversion outcome |
| `total_pages`, `current_page` | PDF length and reading progress |
| `media_type`, `media_path` | Document/audio classification and private playback path |
| `progress_seconds`, `duration_seconds` | Audio playback progress |
| `last_read_at`, `created_at` | Reading and upload timestamps |

## API

| Method | Endpoint | Functionality |
|---|---|---|
| `GET` | `/api/session` | Returns the current public user and a session CSRF token. |
| `POST` | `/api/register` | Validates and creates a user, then authenticates the new account. |
| `POST` | `/api/login` | Verifies credentials and starts a regenerated session. |
| `POST` | `/api/logout` | Validates the CSRF token and destroys the session. |
| `GET` | `/api/library` | Lists the authenticated user’s books and progress. |
| `POST` | `/api/library` | Uploads supported media; EPUB/MOBI returns 202 with a queued item. |
| `GET` | `/api/library/:id/pdf` | Streams an owned, converted PDF inline. |
| `GET` | `/api/library/:id/audio` | Streams an owned MP3 or WAV file. |
| `PATCH` | `/api/library/:id/progress` | Saves PDF/audio position, or accepts finish/reset actions. |
| `PATCH` | `/api/library/:id/metadata` | Updates the owner's ready-item title, author, and ISBN. |
| `POST` | `/api/library/:id/retry` | Queues failed EPUB/MOBI conversion or retries PDF processing. |
| `DELETE` | `/api/library/:id` | Deletes an owned book and its private files. |
| `GET` | `/api/health/live` | Reports whether the Node process is serving requests. |
| `GET` | `/api/health/ready` | Reports whether PostgreSQL is reachable. |

API errors use JSON responses with an `error` message. Duplicate email addresses return `409`, invalid input returns `400`, invalid credentials return `401`, and invalid CSRF tokens return `403`.

## Frontend

- Vue 3 Composition API and single-file components.
- Vue Router with authentication-aware navigation guards.
- A small reactive authentication store shared across components.
- Vite development server and production bundling.
- Responsive, custom CSS without a component framework.
- Accessible labels, error announcements, focus states, and semantic navigation.
- Loading states and API error feedback on authentication forms.
- PDF zoom, fit-width, first/last page, and direct page controls.
- Arrow, Page Up/Down, Space, Home, and End keyboard navigation.
- Automatic PDF re-rendering after window resizing or device rotation.

## Backend and security

- Node.js 22.13 or newer.
- Express 5 JSON API.
- PostgreSQL connection pooling through `pg`.
- PostgreSQL-backed `express-session` storage.
- Password hashing through `bcryptjs`.
- Security headers through Helmet, including a same-origin content security policy.
- Request-body limit of 20 KB.
- Parameterized SQL queries.
- Secure cookies in production and a required production session secret.

In production, Express serves the compiled Vue application and falls back to `index.html` for client-side routes.

## Persistence and migration

`npm run db:migrate` creates the following idempotently:

- `users`;
- `library_items`;
- the library-item ownership index;
- the session table, created automatically by the session store when the server starts.

The local Docker Compose configuration runs PostgreSQL 16 with a health check and persistent named volume.

The production Docker setup also provides:

- a multi-stage Node.js image containing only production dependencies and the compiled Vue application;
- automatic database migration before application startup;
- a non-root application process;
- PostgreSQL readiness-based startup ordering;
- application and database health checks;
- persistent named volumes for PostgreSQL and private book storage;
- restart policies and `no-new-privileges` container hardening;
- configurable HTTP/HTTPS cookie behavior for direct or reverse-proxied deployments.

## Testing and tooling

- `npm test` runs Node's built-in test runner.
- Unit coverage includes metadata, ISBN validation, media signatures, and EPUB/MOBI conversion. Opt-in integration suites exercise HTTP account/library workflows and S3 range streaming/deletion; see RELEASE.md.
- `npm run build` creates the production Vue bundle.
- `npm run dev` runs the API and Vite development server together.
- `npm start` serves the production API and built frontend.
- Release checks run manually before pushing, including the production Docker build and Compose validation; see RELEASE.md. No GitHub Actions workflow is configured.

## Source map

| Area | Location |
|---|---|
| Vue entry point and shell | `client/main.js`, `client/App.vue` |
| Pages | `client/views/` |
| Routing | `client/router.js` |
| Authentication state and API client | `client/auth.js`, `client/api.js` |
| Styling | `client/styles.css` |
| Express API | `server/app.js`, `server/index.js` |
| PostgreSQL connection and schema | `server/db.js`, `server/migrate.js` |
| EPUB conversion | `server/epub-to-pdf.js` |
| Validation and serialization | `server/validation.js` |
| Tests | `test/` |
| Build configuration | `vite.config.js`, `package.json` |
| Local database | `compose.yaml` |
