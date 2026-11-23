# Blackrock Mail

Webmail for `securityblackrock.com`. The browser talks only to this application. The application uses the existing Mailcow Dovecot and Postfix services over TLS. It does not replace Mailcow, Nginx, MariaDB, or the mailbox data.

## Local demo

The demo mailbox never contacts the mail server. `MAIL_MODE=fake` is refused when `NODE_ENV=production`.

```powershell
$env:MAIL_MODE="fake"
$env:SESSION_SECRET="local-dev-session-secret-not-for-production"
$env:WEB_ORIGIN="http://127.0.0.1:3100"
$env:COOKIE_SECURE="false"
$env:API_PORT="4100"
npm --prefix server run dev
```

In a second terminal:

```powershell
npm --prefix web run dev
```

Open `http://127.0.0.1:3100` and sign in as `support@securityblackrock.com` with the password `local-demo-only`.

The API loads environment files from its own location, so the working directory can be the repo or `server` (`npm --prefix server`, or `node dist/index.js`). Variables already set in the process are left as they are. `server/.env` fills anything still unset, then the repo `.env` fills the rest. Both files are gitignored. If `server/.env` is missing locally, create it there with a `SESSION_SECRET` of at least 32 characters and do not commit it.

## Real mailbox

Copy `.env.example` to `.env`, set a long `SESSION_SECRET`, and keep `MAIL_MODE=imap`. The pinned Mailcow certificate is `certs/mail.securityblackrock.com.pem`. Confirm its fingerprint on the server before relying on it:

```
2F:F8:CC:7A:66:1B:59:6E:28:0B:CC:6B:C0:94:63:5C:F7:9F:C1:95:AE:07:D0:21:EF:25:03:84:62:D5:82:86
```

Staging and rollback steps are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Tests

```powershell
npm --prefix server test
```

The automated tests cover session encryption, HTML sanitizing, upload rejection, CSRF, rate limiting, and the demo mailbox. A live sign-in to `support@securityblackrock.com` still needs that mailbox password.
