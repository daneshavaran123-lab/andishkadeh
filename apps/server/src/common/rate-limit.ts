/** Per-IP sliding window of attempts. */
export class IpRateLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  private recent(ip: string): number[] {
    const now = Date.now();
    const list = (this.hits.get(ip) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length) this.hits.set(ip, list);
    else this.hits.delete(ip);
    return list;
  }

  /** Counts an attempt; true while the address stays within `max` per window. */
  hit(ip: string): boolean {
    this.record(ip);
    return this.recent(ip).length <= this.max;
  }

  /** Whether the address already used up its attempts (counts nothing). */
  exceeded(ip: string): boolean {
    return this.recent(ip).length >= this.max;
  }

  /** Counts an attempt without checking (e.g. only failed ones). */
  record(ip: string) {
    this.hits.set(ip, [...this.recent(ip), Date.now()]);
  }
}
