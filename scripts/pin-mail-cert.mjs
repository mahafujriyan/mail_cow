/**
 * Saves the current mail server certificate so the app can verify TLS
 * without disabling certificate checks.
 *
 * This does not log in and does not change the server.
 * Reconnects with the saved certificate and prints public IMAP/SMTP capabilities.
 */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import tls from "node:tls";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const host = process.env.MAIL_HOST || "mail.securityblackrock.com";
const imapPort = Number(process.env.IMAP_PORT || 993);
const smtpPort = Number(process.env.SMTP_PORT || 587);
const outFile = path.join(root, "certs", "mail.securityblackrock.com.pem");

function pemFromDer(raw) {
  const body = raw.toString("base64").replace(/(.{64})/g, "$1\n");
  return `-----BEGIN CERTIFICATE-----\n${body}\n-----END CERTIFICATE-----\n`;
}

function connectTls(port) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host,
      port,
      servername: host,
      minVersion: "TLSv1.2",
      rejectUnauthorized: false,
    });
    socket.once("secureConnect", () => resolve(socket));
    socket.once("error", reject);
  });
}

function readLine(socket, bufferRef) {
  return new Promise((resolve, reject) => {
    const take = () => {
      const index = bufferRef.value.indexOf("\n");
      if (index === -1) return false;
      const line = bufferRef.value.slice(0, index + 1);
      bufferRef.value = bufferRef.value.slice(index + 1);
      resolve(line);
      return true;
    };
    if (take()) return;
    const onData = (chunk) => {
      bufferRef.value += chunk.toString("utf8");
      if (take()) cleanup();
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
    };
    socket.on("data", onData);
    socket.on("error", onError);
  });
}

const untrusted = await connectTls(imapPort);
const cert = untrusted.getPeerCertificate();
untrusted.end();

if (!cert.raw) {
  throw new Error("Mail server did not present a certificate");
}

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, pemFromDer(cert.raw));

const ca = fs.readFileSync(outFile);
const verified = tls.connect({
  host,
  port: imapPort,
  servername: host,
  minVersion: "TLSv1.2",
  ca,
  rejectUnauthorized: true,
});

const banner = await new Promise((resolve, reject) => {
  let buffer = "";
  verified.once("error", reject);
  verified.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    if (buffer.includes("\r\n") && !buffer.includes("A1 ")) {
      verified.write("A1 CAPABILITY\r\n");
    }
    if (/^A1 (OK|NO|BAD)/m.test(buffer)) {
      verified.write("A2 LOGOUT\r\n");
      resolve(buffer);
    }
  });
});

const smtpPlain = net.connect({ host, port: smtpPort });
const smtpBuffer = { value: "" };
const smtp = await new Promise((resolve, reject) => {
  smtpPlain.once("error", reject);
  smtpPlain.once("connect", async () => {
    try {
      const greet = await readLine(smtpPlain, smtpBuffer);
      smtpPlain.write("EHLO webmail-pin.securityblackrock.com\r\n");
      const lines = [greet.trim()];
      for (;;) {
        const line = await readLine(smtpPlain, smtpBuffer);
        lines.push(line.trim());
        if (/^250 /.test(line)) break;
      }
      smtpPlain.write("STARTTLS\r\n");
      const ready = await readLine(smtpPlain, smtpBuffer);
      lines.push(ready.trim());
      const secure = tls.connect({
        socket: smtpPlain,
        servername: host,
        minVersion: "TLSv1.2",
        ca,
        rejectUnauthorized: true,
      });
      await new Promise((done, fail) => {
        secure.once("secureConnect", done);
        secure.once("error", fail);
      });
      secure.write("EHLO webmail-pin.securityblackrock.com\r\n");
      const secureBuffer = { value: "" };
      const after = [];
      for (;;) {
        const line = await readLine(secure, secureBuffer);
        after.push(line.trim());
        if (/^250 /.test(line)) break;
      }
      secure.write("QUIT\r\n");
      secure.end();
      resolve({ lines, after, authorized: secure.authorized, protocol: secure.getProtocol() });
    } catch (error) {
      reject(error);
    }
  });
});

console.log(JSON.stringify({
  host,
  wrote: outFile,
  fingerprint: cert.fingerprint256,
  subject: cert.subject,
  validTo: cert.valid_to,
  verifiedTls: true,
  imap: String(banner).split(/\r?\n/).filter(Boolean),
  smtp,
}, null, 2));
