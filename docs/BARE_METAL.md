# Bare-metal installation (without Docker)

PaperBrain needs Node.js 22.13 or newer, npm, PostgreSQL 16, Git, and OpenSSL.
Install these using your operating system's package manager or their official
installers. Verify `node --version`, `npm --version`, and `psql --version`.
No PHP, Python, Calibre, or separate conversion service is required.

The commands below assume Linux and a local PostgreSQL server that is already
running. Run application commands as a normal user, not root.

## Database

Create a dedicated database role and database. The password prompt keeps the
password out of shell history:

```bash
sudo -u postgres createuser --pwprompt paperbrain
sudo -u postgres createdb --owner=paperbrain paperbrain
```

For an existing/remote PostgreSQL server, ask its administrator to provision a
database and a role that can create and alter tables in it. Restrict database
network access to the application host.

## Application

Clone the PaperBrain repository:

```bash
git clone https://github.com/1338/PaperBrain.git PaperBrain
cd PaperBrain
cp .env.example .env
chmod 600 .env
openssl rand -hex 32
```

Edit `.env`; use the generated value for `SESSION_SECRET` and your database
password in `DATABASE_URL`:

```dotenv
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://paperbrain:URL_ENCODED_PASSWORD@127.0.0.1:5432/paperbrain
DATABASE_SSL=false
SESSION_SECRET=YOUR_GENERATED_SECRET
STORAGE_PATH=./storage
COOKIE_SECURE=false
MAX_UPLOAD_SIZE_MB=100
CONVERSION_TIMEOUT_SECONDS=300
```

URL-encode reserved characters in the database password (or use a random hex
password). `APP_PORT` and `POSTGRES_*` in `.env.example` are Docker-only settings;
they do not configure a bare-metal database or server port. Keep `.env` private.

```bash
npm ci
npm run db:migrate
npm run build
npm start
```

Open `http://localhost:3000`, or the configured `PORT`. Create your own account
first: the first account becomes administrator. Do this before exposing the
server publicly. The server listens on network interfaces; use a firewall or
reverse proxy to restrict access. Background conversion starts with the server.

Keep `SESSION_SECRET` and the storage directory across upgrades. Relative
`STORAGE_PATH` values resolve from the application's working directory.

## Run continuously with systemd (optional)

Use a dedicated non-root service account and put the project in `/opt/paperbrain`.
For a fresh installation, an administrator can prepare it with:

```bash
sudo useradd --system --no-create-home --home-dir /opt/paperbrain --shell /usr/sbin/nologin paperbrain
sudo install -d -o paperbrain -g paperbrain /opt/paperbrain
sudo -u paperbrain git clone https://github.com/1338/PaperBrain.git /opt/paperbrain
```

Configure `/opt/paperbrain/.env` as above, owned by `paperbrain` with mode `600`.
From `/opt/paperbrain`, run `sudo -u paperbrain npm ci` and
`sudo -u paperbrain npm run build`. The service runs migrations automatically.
Ensure Node is installed system-wide: the example assumes `/usr/bin/node`;
adjust both executable paths if `command -v node` shows another location.

Create `/etc/systemd/system/paperbrain.service` with:

```ini
[Unit]
Description=PaperBrain reading library
After=network.target postgresql.service

[Service]
Type=simple
User=paperbrain
Group=paperbrain
WorkingDirectory=/opt/paperbrain
Environment=NODE_ENV=production
ExecStartPre=/usr/bin/node /opt/paperbrain/server/migrate.js
ExecStart=/usr/bin/node /opt/paperbrain/server/index.js
Restart=on-failure
RestartSec=5
KillMode=control-group
UMask=0077
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now paperbrain
sudo systemctl status paperbrain
sudo journalctl -u paperbrain -f
```

The service reads `.env` from its working directory. Health endpoints are
`/api/health/live` and `/api/health/ready`. For HTTPS/reverse-proxy and SMTP/S3
configuration, see the [README](../README.md#https-and-reverse-proxies).

## Backup and restore

Stop the application (Ctrl+C or `sudo systemctl stop paperbrain`) before taking
both backups so files, queued conversions, and database records stay consistent.
Run from the application directory as a user who can read its storage:

```bash
mkdir -p backups
chmod 700 backups
pg_dump -h 127.0.0.1 -U paperbrain -W paperbrain > backups/paperbrain.sql
tar czf backups/paperbrain-storage.tgz -C storage .
```

The database command prompts for its password. Use your actual host, role,
database, and `STORAGE_PATH`. Securely back up `.env` separately: it contains
the secret needed to decrypt saved SMTP/S3 credentials. For S3, also back up
the bucket objects. Restart the application after completing the backups.

Restore to a **fresh empty database and storage directory**, not over a running
installation. Configure its `.env` with the original `SESSION_SECRET`:

```bash
psql -h 127.0.0.1 -U paperbrain -W -d paperbrain -v ON_ERROR_STOP=1 < backups/paperbrain.sql
mkdir -p storage
tar xzf backups/paperbrain-storage.tgz -C storage
npm ci
npm run db:migrate
npm run build
npm start
```

Ensure the service account owns the restored storage. Verify login, a PDF, audio,
saved progress, and configured SMTP/S3 access before relying on the restored copy.

## Upgrade

Back up first, then stop the application. As the application owner:

```bash
git pull --ff-only
npm ci
npm run db:migrate
npm run build
```

Restart with `npm start` or `sudo systemctl start paperbrain`. If an upgrade fails,
restore the previous application version **and matching database/storage backup**.
Avoid `npm ci --omit=dev` before building: Vite is a development dependency needed
to create the production frontend.

## Password recovery

In Bash, from the project directory as the application owner:

```bash
read -r -s -p 'New password: ' recovery_password
printf '\n'
printf '%s' "$recovery_password" | npm run account:recover -- user@example.com
unset recovery_password
```

Use at least 12 characters. This resets an existing account's password and revokes
its login sessions; roles, activation, and email-verification status are unchanged.
