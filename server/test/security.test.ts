import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decryptString, deriveKey, encryptString } from "../src/crypto.js";
import { assertFileContent, sanitizeFilename } from "../src/mail/files.js";
import { decodeMailbox, encodeMailbox } from "../src/mail/ids.js";
import { cleanHeaderText, prepareOutgoingHtml } from "../src/mail/outgoing.js";
import { buildReplyTemplate, presentMessage } from "../src/mail/present.js";
import { cleanStyle, sanitizeEmailHtml } from "../src/mail/sanitize.js";
import { compileMessage } from "../src/mail/smtp.js";
import type { RawMessage } from "../src/mail/types.js";
import { HttpError } from "../src/errors.js";

describe("session encryption", () => {
  it("round-trips a mailbox password and rejects tampering", () => {
    const key = deriveKey("test-session-secret-should-be-long-enough");
    const password = "correct horse battery";
    const encrypted = encryptString(password, key);
    assert.equal(decryptString(encrypted, key), password);
    assert.equal(encrypted.includes(password), false);
    assert.throws(() => decryptString(`${encrypted}aa`, key));
  });
});

describe("html sanitizer", () => {
  it("removes scripts, event handlers, and javascript urls", () => {
    const clean = sanitizeEmailHtml(`
      <p>Hello</p>
      <script>alert(1)</script>
      <img src="x" onerror="alert(1)">
      <a href="javascript:alert(1)">click</a>
      <a href="https://securityblackrock.com">site</a>
      <div style="position:fixed;background:url(https://evil.test/a);color:red">x</div>
    `);
    assert.equal(clean.includes("<script"), false);
    assert.equal(clean.includes("onerror"), false);
    assert.equal(clean.includes("javascript:"), false);
    assert.equal(clean.includes("https://securityblackrock.com"), true);
    assert.equal(clean.includes("position"), false);
    assert.equal(clean.includes("url("), false);
    assert.equal(clean.includes("color:red") || clean.includes("color: red"), true);
  });

  it("drops non-image data urls", () => {
    const clean = sanitizeEmailHtml(`<img src="data:text/html;base64,PHNjcmlwdD4="><img src="data:image/png;base64,aaaa" alt="ok">`);
    assert.equal(clean.includes("text/html"), false);
    assert.equal(clean.includes("data:image/png"), true);
  });
});

describe("style cleaner", () => {
  it("keeps ordinary declarations", () => {
    assert.equal(cleanStyle("color: #123; font-weight: 600"), "color: #123; font-weight: 600");
  });
});

describe("uploads", () => {
  it("strips path segments from filenames and rejects executables", () => {
    assert.equal(sanitizeFilename("..\\\\..\\\\windows\\\\system32\\\\cmd.exe"), "cmd.exe");
    assert.throws(
      () => assertFileContent("notes.txt", Buffer.from([0x4d, 0x5a, 0x90, 0x00])),
      (error: unknown) => error instanceof HttpError && error.code === "unsupported_file",
    );
    assert.doesNotThrow(() => assertFileContent("notes.txt", Buffer.from("hello\n")));
  });
});

describe("mailbox ids", () => {
  it("round-trips folder paths", () => {
    assert.equal(decodeMailbox(encodeMailbox("INBOX")), "INBOX");
    assert.equal(decodeMailbox(encodeMailbox("Receipts")), "Receipts");
    assert.throws(() => decodeMailbox("../INBOX"));
  });
});

describe("outgoing mail", () => {
  it("strips header injection from the subject", async () => {
    const subject = cleanHeaderText("Hello\r\nBcc: evil@example.com", 500);
    const prepared = prepareOutgoingHtml('<p>Hi</p><img data-upload-id="11111111-1111-4111-8111-111111111111" src="blob:local">');
    assert.equal(subject.includes("\n"), false);
    assert.equal(prepared.html.includes("data-upload-id"), false);
    assert.equal(prepared.html.includes("cid:cid-11111111-1111-4111-8111-111111111111@securityblackrock.com"), true);
    const raw = await compileMessage({
      from: { name: "Support\r\nBcc: x", address: "support@securityblackrock.com" },
      to: [{ name: "", address: "person@example.com" }],
      cc: [],
      bcc: [],
      subject,
      html: prepared.html,
      text: prepared.text,
      attachments: [],
    });
    const source = raw.toString("utf8");
    assert.equal(source.includes("\r\nBcc:"), false);
    assert.match(source, /^Subject: /m);
  });
});

describe("reply template", () => {
  it("addresses the sender and skips the mailbox owner on reply all", () => {
    const presented = presentMessage(sample(), { remoteImages: false });
    const reply = buildReplyTemplate(presented, "replyAll", "support@securityblackrock.com", "<p>Thanks,<br>Support</p>", "inbox");
    assert.equal(reply.to.some((item) => item.address === "support@securityblackrock.com"), false);
    assert.equal(reply.to.some((item) => item.address === "aria.rahman@securityblackrock.com"), true);
    assert.equal(reply.cc.some((item) => item.address === "audit@securityblackrock.com"), true);
    assert.match(reply.subject, /^Re: /);
    assert.equal(reply.html.includes("<script"), false);
  });
});

function sample(): RawMessage {
  return {
    uid: 1,
    subject: "Access",
    from: [{ name: "Aria Rahman", address: "aria.rahman@securityblackrock.com" }],
    to: [
      { name: "", address: "support@securityblackrock.com" },
      { name: "Audit", address: "audit@securityblackrock.com" },
    ],
    cc: [],
    bcc: [],
    replyTo: [],
    date: new Date().toISOString(),
    seen: true,
    flagged: false,
    answered: false,
    draft: false,
    hasAttachments: false,
    preview: "hello",
    size: 10,
    messageId: "<m1@securityblackrock.com>",
    references: [],
    html: "<p>hello</p><script>alert(1)</script>",
    text: "hello",
    attachments: [],
  };
}
