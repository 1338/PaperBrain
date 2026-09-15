# Security

Report vulnerabilities privately through GitHub Security Advisories when
available. Do not attach credentials, cookies, database dumps, or private books
to public issues.

Use HTTPS and COOKIE_SECURE=true outside a trusted network. Instance
administrators are trusted: they control SMTP/S3 endpoints and user accounts.
Keep .env out of version control. Back up SESSION_SECRET securely with your
database; it encrypts SMTP/S3 credentials. Changing it invalidates sessions
and requires re-entering those credentials.

Use private registration for personal instances. Document conversion consumes
CPU and memory; configure upload limits appropriate to your server.
