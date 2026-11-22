import type { MailboxClient } from "./types.js";

type Auth = { email: string; password: string };

export class MailboxPool {
  private readonly entries = new Map<string, { client: MailboxClient; lastUsed: number }>();

  constructor(private readonly open: (auth: Auth) => MailboxClient) {}

  async acquire(sessionId: string, auth: Auth): Promise<MailboxClient> {
    const existing = this.entries.get(sessionId);
    if (existing) {
      existing.lastUsed = Date.now();
      return existing.client;
    }
    const client = this.open(auth);
    this.entries.set(sessionId, { client, lastUsed: Date.now() });
    return client;
  }

  async drop(sessionId: string) {
    const entry = this.entries.get(sessionId);
    if (!entry) return;
    this.entries.delete(sessionId);
    await entry.client.close().catch(() => undefined);
  }

  async sweep(idleMs = 2 * 60 * 1000) {
    const cutoff = Date.now() - idleMs;
    for (const [id, entry] of this.entries) {
      if (entry.lastUsed < cutoff) await this.drop(id);
    }
  }

  async closeAll() {
    for (const id of [...this.entries.keys()]) await this.drop(id);
  }
}
