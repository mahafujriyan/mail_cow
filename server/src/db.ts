import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export type Settings = {
  displayName: string;
  signatureHtml: string;
  language: "en" | "es";
  timeZone: string;
  theme: "light" | "dark";
  notifyDesktop: boolean;
  notifySound: boolean;
  initialized: boolean;
};

export type ContactRecord = {
  id: string;
  name: string;
  email: string;
  company: string;
  phone: string;
  notes: string;
};

export type UploadRecord = {
  id: string;
  storedName: string;
  originalName: string;
  mime: string;
  size: number;
  createdAt: number;
};

type SettingsRow = {
  email: string;
  display_name: string;
  signature_html: string;
  language: string;
  time_zone: string;
  theme: string;
  notify_desktop: number;
  notify_sound: number;
  initialized: number;
};

type ContactRow = {
  id: string;
  name: string;
  email: string;
  company: string;
  phone: string;
  notes: string;
};

type UploadRow = {
  id: string;
  stored_name: string;
  original_name: string;
  mime: string;
  size: number;
  created_at: number;
};

type SessionRow = {
  id: string;
  email: string;
  password_enc: string;
  created_at: number;
  expires_at: number;
  absolute_expires_at: number;
  last_seen_at: number;
};

export type SessionRowRecord = SessionRow;

export class AppDatabase {
  readonly db: DatabaseSync;

  constructor(filename: string) {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        password_enc TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        absolute_expires_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_email ON sessions(email);

      CREATE TABLE IF NOT EXISTS settings (
        email TEXT PRIMARY KEY,
        display_name TEXT NOT NULL DEFAULT '',
        signature_html TEXT NOT NULL DEFAULT '',
        language TEXT NOT NULL DEFAULT 'en',
        time_zone TEXT NOT NULL DEFAULT 'UTC',
        theme TEXT NOT NULL DEFAULT 'light',
        notify_desktop INTEGER NOT NULL DEFAULT 0,
        notify_sound INTEGER NOT NULL DEFAULT 0,
        initialized INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS contacts (
        id TEXT PRIMARY KEY,
        owner_email TEXT NOT NULL,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        company TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS contacts_owner ON contacts(owner_email, name);

      CREATE TABLE IF NOT EXISTS recent_recipients (
        owner_email TEXT NOT NULL,
        address TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        last_used INTEGER NOT NULL,
        PRIMARY KEY (owner_email, address)
      );

      CREATE TABLE IF NOT EXISTS uploads (
        id TEXT PRIMARY KEY,
        owner_email TEXT NOT NULL,
        stored_name TEXT NOT NULL,
        original_name TEXT NOT NULL,
        mime TEXT NOT NULL,
        size INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS uploads_owner ON uploads(owner_email, created_at);
    `);
  }

  createSession(input: {
    id: string;
    email: string;
    passwordEnc: string;
    createdAt: number;
    expiresAt: number;
    absoluteExpiresAt: number;
  }) {
    this.db
      .prepare(
        `INSERT INTO sessions (id, email, password_enc, created_at, expires_at, absolute_expires_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.email,
        input.passwordEnc,
        input.createdAt,
        input.expiresAt,
        input.absoluteExpiresAt,
        input.createdAt,
      );
    this.trimSessions(input.email);
  }

  getSession(id: string): SessionRowRecord | undefined {
    return this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRowRecord | undefined;
  }

  touchSession(id: string, expiresAt: number, lastSeenAt: number) {
    this.db
      .prepare("UPDATE sessions SET expires_at = ?, last_seen_at = ? WHERE id = ?")
      .run(expiresAt, lastSeenAt, id);
  }

  deleteSession(id: string) {
    this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  }

  private trimSessions(email: string) {
    const rows = this.db
      .prepare("SELECT id FROM sessions WHERE email = ? ORDER BY created_at DESC")
      .all(email) as Array<{ id: string }>;
    for (const row of rows.slice(10)) {
      this.deleteSession(row.id);
    }
  }

  deleteExpiredSessions(now: number) {
    this.db
      .prepare("DELETE FROM sessions WHERE expires_at <= ? OR absolute_expires_at <= ?")
      .run(now, now);
  }

  getSettings(email: string): Settings {
    const row = this.db.prepare("SELECT * FROM settings WHERE email = ?").get(email) as SettingsRow | undefined;
    if (!row) {
      this.db
        .prepare(
          `INSERT INTO settings (email, display_name, signature_html, language, time_zone, theme, notify_desktop, notify_sound, initialized, updated_at)
           VALUES (?, '', '', 'en', 'UTC', 'light', 0, 0, 0, ?)`,
        )
        .run(email, Date.now());
      return this.getSettings(email);
    }
    return {
      displayName: row.display_name,
      signatureHtml: row.signature_html,
      language: row.language === "es" ? "es" : "en",
      timeZone: row.time_zone,
      theme: row.theme === "dark" ? "dark" : "light",
      notifyDesktop: row.notify_desktop === 1,
      notifySound: row.notify_sound === 1,
      initialized: row.initialized === 1,
    };
  }

  saveSettings(email: string, settings: Settings) {
    this.db
      .prepare(
        `INSERT INTO settings (email, display_name, signature_html, language, time_zone, theme, notify_desktop, notify_sound, initialized, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(email) DO UPDATE SET
           display_name = excluded.display_name,
           signature_html = excluded.signature_html,
           language = excluded.language,
           time_zone = excluded.time_zone,
           theme = excluded.theme,
           notify_desktop = excluded.notify_desktop,
           notify_sound = excluded.notify_sound,
           initialized = excluded.initialized,
           updated_at = excluded.updated_at`,
      )
      .run(
        email,
        settings.displayName,
        settings.signatureHtml,
        settings.language,
        settings.timeZone,
        settings.theme,
        settings.notifyDesktop ? 1 : 0,
        settings.notifySound ? 1 : 0,
        settings.initialized ? 1 : 0,
        Date.now(),
      );
  }

  listContacts(email: string, query: string): ContactRecord[] {
    const like = `%${query.replace(/[\\%_]/g, "")}%`;
    const rows = this.db
      .prepare(
        `SELECT id, name, email, company, phone, notes
         FROM contacts
         WHERE owner_email = ?
           AND (? = '' OR name LIKE ? OR email LIKE ? OR company LIKE ?)
         ORDER BY name COLLATE NOCASE
         LIMIT 200`,
      )
      .all(email, query, like, like, like) as ContactRow[];
    return rows.map(mapContact);
  }

  createContact(email: string, contact: ContactRecord) {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO contacts (id, owner_email, name, email, company, phone, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(contact.id, email, contact.name, contact.email, contact.company, contact.phone, contact.notes, now, now);
  }

  updateContact(email: string, contact: ContactRecord): boolean {
    const result = this.db
      .prepare(
        `UPDATE contacts
         SET name = ?, email = ?, company = ?, phone = ?, notes = ?, updated_at = ?
         WHERE id = ? AND owner_email = ?`,
      )
      .run(contact.name, contact.email, contact.company, contact.phone, contact.notes, Date.now(), contact.id, email);
    return Number(result.changes) > 0;
  }

  deleteContact(email: string, id: string): boolean {
    const result = this.db.prepare("DELETE FROM contacts WHERE id = ? AND owner_email = ?").run(id, email);
    return Number(result.changes) > 0;
  }

  suggestRecipients(email: string, query: string): Array<{ name: string; address: string }> {
    const like = `%${query.replace(/[\\%_]/g, "")}%`;
    const contacts = this.db
      .prepare(
        `SELECT name, email AS address FROM contacts
         WHERE owner_email = ? AND (? = '' OR name LIKE ? OR email LIKE ?)
         ORDER BY name COLLATE NOCASE LIMIT 8`,
      )
      .all(email, query, like, like) as Array<{ name: string; address: string }>;
    const recent = this.db
      .prepare(
        `SELECT name, address FROM recent_recipients
         WHERE owner_email = ? AND (? = '' OR name LIKE ? OR address LIKE ?)
         ORDER BY last_used DESC LIMIT 8`,
      )
      .all(email, query, like, like) as Array<{ name: string; address: string }>;
    const seen = new Set<string>();
    const combined: Array<{ name: string; address: string }> = [];
    for (const item of [...contacts, ...recent]) {
      const key = item.address.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      combined.push(item);
      if (combined.length >= 8) break;
    }
    return combined;
  }

  rememberRecipients(email: string, recipients: Array<{ name: string; address: string }>) {
    const statement = this.db.prepare(
      `INSERT INTO recent_recipients (owner_email, address, name, last_used)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(owner_email, address) DO UPDATE SET name = excluded.name, last_used = excluded.last_used`,
    );
    const now = Date.now();
    for (const recipient of recipients) {
      statement.run(email, recipient.address, recipient.name, now);
    }
  }

  createUpload(email: string, upload: UploadRecord) {
    this.db
      .prepare(
        `INSERT INTO uploads (id, owner_email, stored_name, original_name, mime, size, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(upload.id, email, upload.storedName, upload.originalName, upload.mime, upload.size, upload.createdAt);
  }

  getUpload(email: string, id: string): UploadRecord | undefined {
    const row = this.db
      .prepare(
        "SELECT id, stored_name, original_name, mime, size, created_at FROM uploads WHERE id = ? AND owner_email = ?",
      )
      .get(id, email) as UploadRow | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      storedName: row.stored_name,
      originalName: row.original_name,
      mime: row.mime,
      size: row.size,
      createdAt: row.created_at,
    };
  }

  uploadBytes(email: string): number {
    const row = this.db
      .prepare("SELECT COALESCE(SUM(size), 0) AS total FROM uploads WHERE owner_email = ?")
      .get(email) as { total: number };
    return Number(row.total) || 0;
  }

  deleteUpload(email: string, id: string): UploadRecord | undefined {
    const existing = this.getUpload(email, id);
    if (!existing) return undefined;
    this.db.prepare("DELETE FROM uploads WHERE id = ? AND owner_email = ?").run(id, email);
    return existing;
  }

  expiredUploads(olderThan: number): Array<{ id: string; ownerEmail: string; storedName: string }> {
    return this.db
      .prepare("SELECT id, owner_email AS ownerEmail, stored_name AS storedName FROM uploads WHERE created_at < ?")
      .all(olderThan) as Array<{ id: string; ownerEmail: string; storedName: string }>;
  }

  deleteUploadById(id: string) {
    this.db.prepare("DELETE FROM uploads WHERE id = ?").run(id);
  }

  close() {
    this.db.close();
  }
}

function mapContact(row: ContactRow): ContactRecord {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    company: row.company,
    phone: row.phone,
    notes: row.notes,
  };
}
