import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { DEMO_PASSWORD, login, withApi } from "./helpers.js";

describe("api", () => {
  it("requires a session and a csrf token", async () => {
    await withApi(async (base) => {
      const hidden = await fetch(`${base}/api/mailboxes`);
      assert.equal(hidden.status, 401);
      const posted = await fetch(`${base}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "support@securityblackrock.com", password: DEMO_PASSWORD }),
      });
      assert.equal(posted.status, 403);
      const rejected = await login(base, "wrong-password");
      assert.equal(rejected.status, 401);
    });
  });

  it("signs in, reads sanitized mail, stars a message, and sends without storing the password", async () => {
    await withApi(async (base, dbPath) => {
      const auth = await login(base);
      assert.equal(auth.status, 200);
      assert.equal(fs.readFileSync(dbPath).includes(DEMO_PASSWORD), false);

      const boxes = await api(base, auth, "/api/mailboxes");
      const inbox = boxes.mailboxes.find((box: { role: string }) => box.role === "inbox");
      const junk = boxes.mailboxes.find((box: { role: string }) => box.role === "junk");
      const page = await api(base, auth, `/api/mailboxes/${inbox.id}/messages`);
      assert.equal(page.messages.length, 4);
      assert.equal(page.messages[0].subject, "VPN access for the audit team");

      const starred = page.messages.find((item: { uid: number }) => item.uid === 102);
      await api(base, auth, `/api/mailboxes/${inbox.id}/flags`, {
        method: "POST",
        body: JSON.stringify({ uids: [starred.uid], flagged: false }),
      });

      const suspicious = await api(base, auth, `/api/mailboxes/${junk.id}/messages/301`);
      assert.equal(suspicious.html.includes("<script"), false);
      assert.equal(suspicious.html.includes("onerror"), false);
      assert.equal(suspicious.html.includes("javascript:"), false);
      assert.equal(suspicious.remoteImagesBlocked, true);

      const shown = await api(base, auth, `/api/mailboxes/${junk.id}/messages/301?remoteImages=1`);
      assert.equal(shown.remoteImagesBlocked, false);
      assert.equal(shown.html.includes("https://example.com/pixel.png"), true);

      const attachment = await fetch(`${base}/api/mailboxes/${inbox.id}/messages/103/attachments/2`, {
        headers: { cookie: auth.cookie },
      });
      assert.equal(attachment.status, 200);
      assert.match(attachment.headers.get("content-disposition") || "", /attachment/);
      assert.equal(await attachment.text(), "Countersigned DPA notes for the support desk.\n");

      const sent = await api(base, auth, "/api/messages/send", {
        method: "POST",
        body: JSON.stringify({
          to: [{ name: "Aria\r\nBcc: evil@example.com", address: "aria.rahman@securityblackrock.com" }],
          subject: "Hello\r\nBcc: evil@example.com",
          html: "<p>Confirmed.</p><script>alert(1)</script>",
        }),
      });
      assert.equal(sent.sent, true);
      const sentBox = boxes.mailboxes.find((box: { role: string }) => box.role === "sent");
      const sentPage = await api(base, auth, `/api/mailboxes/${sentBox.id}/messages`);
      assert.equal(sentPage.messages.length, 1);
      assert.equal(sentPage.messages[0].subject.includes("\n"), false);
      assert.equal(sentPage.messages[0].to[0].address, "aria.rahman@securityblackrock.com");
    });
  });

  it("rejects a disguised executable and stores only a safe filename", async () => {
    await withApi(async (base) => {
      const auth = await login(base);
      const bad = new FormData();
      bad.set("file", new File([Uint8Array.from([0x4d, 0x5a, 0x00])], "../../evil.txt", { type: "text/plain" }));
      const rejected = await fetch(`${base}/api/uploads`, {
        method: "POST",
        headers: { cookie: auth.cookie, "x-csrf-token": auth.token },
        body: bad,
      });
      assert.equal(rejected.status, 400);

      const good = new FormData();
      good.set("file", new File([new TextEncoder().encode("invoice line\n")], "..\\..\\invoice.txt", { type: "text/plain" }));
      const accepted = await fetch(`${base}/api/uploads`, {
        method: "POST",
        headers: { cookie: auth.cookie, "x-csrf-token": auth.token },
        body: good,
      });
      const upload = (await accepted.json()) as { name?: string; error?: { message: string } };
      assert.equal(accepted.status, 201, upload.error?.message);
      assert.equal(upload.name, "invoice.txt");
    });
  });

  it("saves contacts and settings for the signed-in mailbox only", async () => {
    await withApi(async (base) => {
      const auth = await login(base);
      const created = await api(base, auth, "/api/contacts", {
        method: "POST",
        body: JSON.stringify({ name: "Aria Rahman", email: "aria.rahman@securityblackrock.com", company: "Security Blackrock" }),
      });
      const suggestions = await api(base, auth, "/api/contacts/suggest?q=aria");
      assert.equal(suggestions.suggestions[0].address, "aria.rahman@securityblackrock.com");
      const removed = await fetch(`${base}/api/contacts/${created.id}`, {
        method: "DELETE",
        headers: { cookie: auth.cookie, "x-csrf-token": auth.token },
      });
      assert.equal(removed.status, 204);
      const settings = await api(base, auth, "/api/settings", {
        method: "PUT",
        body: JSON.stringify({
          displayName: "Support Desk",
          signatureHtml: "<p>Support</p><script>alert(1)</script>",
          language: "en",
          timeZone: "Asia/Dhaka",
          theme: "dark",
          notifyDesktop: false,
          notifySound: true,
        }),
      });
      assert.equal(settings.signatureHtml.includes("<script"), false);
      assert.equal(settings.timeZone, "Asia/Dhaka");
      assert.equal(settings.theme, "dark");
    });
  });

  it("rate limits repeated bad passwords", async () => {
    await withApi(async (base) => {
      const statuses: number[] = [];
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const result = await login(base, "wrong-password");
        statuses.push(result.status);
      }
      assert.deepEqual(statuses.slice(0, 4), [401, 401, 401, 401]);
      assert.equal(statuses[4], 429);
    });
  });
});

async function api(base: string, auth: { cookie: string; token: string }, path: string, init: RequestInit = {}) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      cookie: auth.cookie,
      "x-csrf-token": auth.token,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  if (response.status === 204) return {};
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`${response.status} ${path} ${JSON.stringify(body)}`);
  }
  return body;
}
