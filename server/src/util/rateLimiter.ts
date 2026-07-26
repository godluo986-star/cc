/** Simple token-bucket rate limiter (no timers; refills lazily on check). */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly ratePerSec: number,
    private readonly burst: number,
    now = Date.now()
  ) {
    this.tokens = burst;
    this.last = now;
  }

  /** Returns true if the action is allowed and consumes a token. */
  take(now = Date.now(), cost = 1): boolean {
    const elapsed = (now - this.last) / 1000;
    this.last = now;
    this.tokens = Math.min(this.burst, this.tokens + elapsed * this.ratePerSec);
    if (this.tokens >= cost) {
      this.tokens -= cost;
      return true;
    }
    return false;
  }
}

/** Keyed bucket map with idle expiry (for per-IP HTTP limiting). */
export class KeyedLimiter {
  private buckets = new Map<string, { b: TokenBucket; touched: number }>();

  constructor(private ratePerSec: number, private burst: number, private maxKeys = 10000) {}

  take(key: string, now = Date.now()): boolean {
    let e = this.buckets.get(key);
    if (!e) {
      if (this.buckets.size >= this.maxKeys) this.sweep(now);
      e = { b: new TokenBucket(this.ratePerSec, this.burst, now), touched: now };
      this.buckets.set(key, e);
    }
    e.touched = now;
    return e.b.take(now);
  }

  private sweep(now: number) {
    for (const [k, e] of this.buckets) {
      if (now - e.touched > 10 * 60 * 1000) this.buckets.delete(k);
    }
    if (this.buckets.size >= this.maxKeys) this.buckets.clear();
  }
}
