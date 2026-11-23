# Deployment, backup, and rollback

This stack is a separate Docker Compose project named `securityblackrock-webmail`. It uses its own network, `securityblackrock_webmail`, and its own volume, `webmail_data`. It does not join the Mailcow network and it does not bind ports 80, 443, 993, or 587.

Mail stays in Dovecot. The volume stores only webmail sessions, contacts, settings, and pending uploads. Session rows hold the mailbox password encrypted with `SESSION_SECRET`, never in plaintext.

## What was inspected

From this workspace the Mailcow host filesystem was not available, so Postfix, Dovecot, MariaDB, and Nginx were not changed. The public mail ports were checked read-only:

- IMAP `mail.securityblackrock.com:993` speaks TLS 1.3 and answers as Dovecot. Authentication advertised before login is `PLAIN` and `LOGIN`.
- SMTP `mail.securityblackrock.com:587` is Postfix (`ESMTP Postcow`). `STARTTLS` succeeds, then `AUTH PLAIN LOGIN` is offered. The advertised message limit is 100 MB.
- Both services present the same Mailcow self-signed certificate, valid until 22 Nov 2027, fingerprint `2F:F8:CC:7A:66:1B:59:6E:28:0B:CC:6B:C0:94:63:5C:F7:9F:C1:95:AE:07:D0:21:EF:25:03:84:62:D5:82:86`.

The app verifies that certificate. It does not disable TLS checks. If the certificate changes, replace `certs/mail.securityblackrock.com.pem` and restart the API.

## Staging

On the mail VPS, from this project directory:

```bash
cp .env.example .env
openssl rand -hex 32
```

Put that value in `SESSION_SECRET`. Leave `COOKIE_SECURE=false` while the staging site is plain HTTP on localhost.

```bash
docker compose up -d --build
```

Open `http://127.0.0.1:8088` on the server, or tunnel it:

```bash
ssh -L 8088:127.0.0.1:8088 user@mail-server
```

Sign in as `support@securityblackrock.com` with the real mailbox password. Confirm Inbox, sending, and an attachment. Mailcow's own webmail and admin UI stay where they are.

## Backup

Back up this app's data before any cutover:

```bash
docker compose stop api
docker run --rm -v securityblackrock-webmail_webmail_data:/data -v "$PWD":/backup alpine \
  tar czf /backup/webmail-data.tgz -C /data .
docker compose start api
```

Keep a copy of `.env` somewhere private. It is not in git. Mailbox contents are still backed up by Mailcow's own backup, not by this archive.

## Rollback

Staging rollback does not touch Mailcow:

```bash
docker compose down
```

The volume remains until you delete it. To restore the webmail data:

```bash
docker compose up -d
docker compose stop api
docker run --rm -v securityblackrock-webmail_webmail_data:/data -v "$PWD":/backup alpine \
  sh -c "rm -rf /data/* && tar xzf /backup/webmail-data.tgz -C /data"
docker compose start api
```

Changing `SESSION_SECRET` invalidates saved sessions. People sign in again. Mail is unaffected.

## Later cutover

Do this only after staging works. Do not edit files inside `/opt/mailcow-dockerized` or Mailcow's generated Nginx config. Those files are replaced by Mailcow updates.

Preferred path: add `webmail.securityblackrock.com` on a proxy that is not Mailcow's Nginx, and proxy that name to `127.0.0.1:8088`. Set `WEB_ORIGIN` to the HTTPS origin and `COOKIE_SECURE=true`.

If `mail.securityblackrock.com` itself must show this app, put an external proxy in front using Mailcow's reverse-proxy guide, and route only the webmail paths here. Keep a copy of the previous proxy config. Rollback is restoring that copy and reloading the proxy. Postfix, Dovecot, and MariaDB stay in place either way.
