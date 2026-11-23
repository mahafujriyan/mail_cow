import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { loadRuntimeEnv } from "../src/config.js";
import { AppDatabase } from "../src/db.js";

describe("environment loading", () => {
  it("reads server/.env first, then the repo file for unset keys, from either working directory", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sbr-env-"));
    const serverSecret = "s".repeat(40);
    const repoSecret = "r".repeat(40);
    fs.mkdirSync(path.join(root, "server"));
    fs.writeFileSync(path.join(root, "server", "package.json"), JSON.stringify({ name: "securityblackrock-webmail-api" }));
    fs.writeFileSync(path.join(root, "server", ".env"), `SESSION_SECRET=${serverSecret}\nFROM_SERVER=server\n`);
    fs.writeFileSync(path.join(root, ".env"), `SESSION_SECRET=${repoSecret}\nFROM_REPO=repo\n`);
    try {
      const fromRepo = {} as NodeJS.ProcessEnv;
      loadRuntimeEnv({ moduleDir: path.join(root, "server", "dist"), cwd: root, env: fromRepo });
      assert.equal(fromRepo.SESSION_SECRET, serverSecret);
      assert.equal(fromRepo.FROM_SERVER, "server");
      assert.equal(fromRepo.FROM_REPO, "repo");

      const fromServer = {} as NodeJS.ProcessEnv;
      loadRuntimeEnv({ moduleDir: path.join(root, "server", "src"), cwd: path.join(root, "server"), env: fromServer });
      assert.equal(fromServer.SESSION_SECRET, serverSecret);
      assert.equal(fromServer.FROM_REPO, "repo");

      const onlyRepo = {} as NodeJS.ProcessEnv;
      fs.rmSync(path.join(root, "server", ".env"));
      loadRuntimeEnv({ moduleDir: path.join(root, "server", "dist"), cwd: path.join(root, "server"), env: onlyRepo });
      assert.equal(onlyRepo.SESSION_SECRET, repoSecret);

      const preset = { SESSION_SECRET: "already-set-secret-value-32-chars!!" } as NodeJS.ProcessEnv;
      loadRuntimeEnv({ moduleDir: path.join(root, "server", "src"), cwd: root, env: preset });
      assert.equal(preset.SESSION_SECRET, "already-set-secret-value-32-chars!!");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("settings migration", () => {
  it("adds avatar storage without deleting an existing settings row", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sbr-db-"));
    const file = path.join(dir, "webmail.db");
    const raw = new DatabaseSync(file);
    raw.exec(`
      CREATE TABLE settings (
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
    `);
    raw
      .prepare(
        `INSERT INTO settings (email, display_name, signature_html, language, time_zone, theme, notify_desktop, notify_sound, initialized, updated_at)
         VALUES (?, ?, ?, 'es', 'Asia/Dhaka', 'dark', 1, 0, 1, 1)`,
      )
      .run("kept@example.com", "Kept Name", "<p>Sig</p>");
    raw.close();

    const db = new AppDatabase(file);
    try {
      const settings = db.getSettings("kept@example.com");
      assert.equal(settings.displayName, "Kept Name");
      assert.equal(settings.signatureHtml, "<p>Sig</p>");
      assert.equal(settings.language, "es");
      assert.equal(settings.theme, "dark");
      assert.equal(settings.notifyDesktop, true);
      assert.equal(settings.avatarData, "");
      const rows = db.db.prepare("SELECT COUNT(*) AS count FROM settings").get() as { count: number };
      assert.equal(Number(rows.count), 1);
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
