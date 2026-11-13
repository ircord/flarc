export class SlidingWindowRateLimiter {
  private buckets = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly windowMs: number,
    private readonly maxCount: number,
  ) {}

  public check(key: string, now: number = Date.now()): boolean {
    return this.charge(key, 1, now);
  }

  public charge(key: string, cost: number, now: number = Date.now()): boolean {
    if (!Number.isSafeInteger(cost) || cost < 1 || cost > this.maxCount) return false;
    if (this.buckets.size >= 1000) {
      for (const [bucketKey, bucket] of this.buckets)
        if (bucket.resetAt <= now) this.buckets.delete(bucketKey);
      if (this.buckets.size >= 10000 && !this.buckets.has(key)) return false;
    }
    const entry = this.buckets.get(key);
    if (!entry || now >= entry.resetAt) {
      this.buckets.set(key, { count: cost, resetAt: now + this.windowMs });
      return true;
    }
    if (entry.count + cost > this.maxCount) {
      return false;
    }
    entry.count += cost;
    return true;
  }

  public reset(key: string): void {
    this.buckets.delete(key);
  }
}
