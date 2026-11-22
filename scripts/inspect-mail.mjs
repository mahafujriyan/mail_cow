/**
 * Read-only probe of the existing mail server.
 * Sends no AUTH command and does not change server configuration.
 */
import net from "node:net";
import tls from "node:tls";

const host = process.env.IMAP_HOST || "mail.securityblackrock.com";
const imapPort = Number(process.env.IMAP_PORT || 993);
const smtpPort = Number(process.env.SMTP_PORT || 587);

function summarizeCert(socket) {
  const cert = socket.getPeerCertificate();
  return {
    protocol: socket.getProtocol(),
    authorized: socket.authorized,
    authorizationError: socket.authorizationError || null,
    subject: cert.subject,
    issuer: cert.issuer,
    validFrom: cert.valid_from,
    validTo: cert.valid_to,
    san: cert.subjectaltname,
    fingerprint: cert.fingerprint256,
  };
}

function inspectImap() {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host,
      port: imapPort,
      servername: host,
      minVersion: "TLSv1.2",
    });
    let buffer = "";
    let stage = 0;
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("IMAP timeout"));
    }, 12000);

    socket.on("secureConnect", () => {
      buffer = "";
    });
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      if (stage === 0 && buffer.includes("\r\n")) {
        stage = 1;
        socket.write("A1 CAPABILITY\r\n");
        return;
      }
      if (stage === 1 && /^A1 (OK|NO|BAD)/m.test(buffer)) {
        stage = 2;
        const tlsInfo = summarizeCert(socket);
        socket.write("A2 LOGOUT\r\n");
        clearTimeout(timer);
        resolve({
          tls: tlsInfo,
          transcript: buffer.split(/\r?\n/).filter(Boolean).slice(0, 12),
        });
        socket.end();
      }
    });
    socket.on("error", (error) => {
      clearTimeout(timer);
      let tls = null;
      try {
        tls = summarizeCert(socket);
      } catch {
        tls = null;
      }
      const wrapped = new Error(error instanceof Error ? error.message : String(error));
      wrapped.tls = tls;
      reject(wrapped);
    });
  });
}

function readLine(socket, bufferRef) {
  return new Promise((resolve, reject) => {
    const tryTake = () => {
      const index = bufferRef.value.indexOf("\n");
      if (index === -1) return false;
      const line = bufferRef.value.slice(0, index + 1);
      bufferRef.value = bufferRef.value.slice(index + 1);
      resolve(line);
      return true;
    };
    if (tryTake()) return;
    const onData = (chunk) => {
      bufferRef.value += chunk.toString("utf8");
      if (tryTake()) cleanup();
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

function writeLine(socket, line) {
  socket.write(`${line}\r\n`);
}

function inspectSmtp() {
  return new Promise((resolve, reject) => {
    const plain = net.connect({ host, port: smtpPort });
    const bufferRef = { value: "" };
    const timer = setTimeout(() => {
      plain.destroy();
      reject(new Error("SMTP timeout"));
    }, 15000);

    plain.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    plain.on("connect", async () => {
      try {
        const banner = await readLine(plain, bufferRef);
        writeLine(plain, "EHLO webmail-inspect.securityblackrock.com");
        const ehlo = [];
        for (;;) {
          const line = await readLine(plain, bufferRef);
          ehlo.push(line.trim());
          if (/^250 /.test(line)) break;
          if (!line.startsWith("250")) throw new Error(`Unexpected SMTP line: ${line.trim()}`);
        }
        writeLine(plain, "STARTTLS");
        const starttls = await readLine(plain, bufferRef);
        if (!starttls.startsWith("220")) {
          throw new Error(`STARTTLS refused: ${starttls.trim()}`);
        }
        const secure = tls.connect({
          socket: plain,
          servername: host,
          minVersion: "TLSv1.2",
        });
        const secureBuffer = { value: "" };
        await new Promise((done, fail) => {
          secure.once("secureConnect", done);
          secure.once("error", fail);
        });
        const tlsInfo = summarizeCert(secure);
        writeLine(secure, "EHLO webmail-inspect.securityblackrock.com");
        const ehloTls = [];
        for (;;) {
          const line = await readLine(secure, secureBuffer);
          ehloTls.push(line.trim());
          if (/^250 /.test(line)) break;
        }
        writeLine(secure, "QUIT");
        clearTimeout(timer);
        resolve({
          banner: banner.trim(),
          ehloBeforeTls: ehlo,
          starttls: starttls.trim(),
          tls: tlsInfo,
          ehloAfterTls: ehloTls,
        });
        secure.end();
      } catch (error) {
        clearTimeout(timer);
        plain.destroy();
        reject(error);
      }
    });
  });
}

function peerCertificate({ port, starttls }) {
  return new Promise((resolve) => {
    const finish = (socket) => {
      let info = null;
      try {
        info = summarizeCert(socket);
      } catch (error) {
        info = { error: error instanceof Error ? error.message : String(error) };
      }
      socket.destroy();
      resolve(info);
    };

    if (!starttls) {
      const socket = tls.connect({
        host,
        port,
        servername: host,
        minVersion: "TLSv1.2",
        rejectUnauthorized: false,
      });
      socket.once("secureConnect", () => finish(socket));
      socket.once("error", (error) => resolve({ error: error.message }));
      return;
    }

    const plain = net.connect({ host, port });
    const bufferRef = { value: "" };
    plain.once("error", (error) => resolve({ error: error.message }));
    plain.once("connect", async () => {
      try {
        await readLine(plain, bufferRef);
        writeLine(plain, "EHLO webmail-inspect.securityblackrock.com");
        for (;;) {
          const line = await readLine(plain, bufferRef);
          if (/^250 /.test(line)) break;
        }
        writeLine(plain, "STARTTLS");
        const ready = await readLine(plain, bufferRef);
        if (!ready.startsWith("220")) {
          resolve({ error: ready.trim() });
          plain.destroy();
          return;
        }
        const secure = tls.connect({
          socket: plain,
          servername: host,
          minVersion: "TLSv1.2",
          rejectUnauthorized: false,
        });
        secure.once("secureConnect", () => finish(secure));
        secure.once("error", (error) => resolve({ error: error.message }));
      } catch (error) {
        resolve({ error: error instanceof Error ? error.message : String(error) });
        plain.destroy();
      }
    });
  });
}

const report = { host, imapPort, smtpPort, checkedAt: new Date().toISOString() };
try {
  report.imap = await inspectImap();
} catch (error) {
  report.imapError = error instanceof Error ? error.message : String(error);
  report.imapUntrustedCertificate = await peerCertificate({ port: imapPort, starttls: false });
}
try {
  report.smtp = await inspectSmtp();
} catch (error) {
  report.smtpError = error instanceof Error ? error.message : String(error);
  report.smtpUntrustedCertificate = await peerCertificate({ port: smtpPort, starttls: true });
}

console.log(JSON.stringify(report, null, 2));
if (report.imapError || report.smtpError) process.exitCode = 1;
