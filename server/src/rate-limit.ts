export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  tooMany(key: string): boolean {
    return this.recent(key).length >= this.limit;
  }

  hit(key: string) {
    const recent = this.recent(key);
    recent.push(Date.now());
    this.hits.set(key, recent);
  }

  clear(key: string) {
    this.hits.delete(key);
  }

  private recent(key: string): number[] {
    const now = Date.now();
    return (this.hits.get(key) || []).filter((time) => now - time < this.windowMs);
  }
}
