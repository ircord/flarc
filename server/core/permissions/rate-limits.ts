export class SlidingWindowRateLimiter {
  private buckets = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly windowMs: number,
    private readonly maxCount: number,
  ) {}

  public check(key: string, now: number = Date.now()): boolean {
    if (this.buckets.size >= 1000) {
      for (const [bucketKey, bucket] of this.buckets)
        if (bucket.resetAt <= now) this.buckets.delete(bucketKey);
      if (this.buckets.size >= 10000 && !this.buckets.has(key)) return false;
    }
    const entry = this.buckets.get(key);
    if (!entry || now >= entry.resetAt) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    if (entry.count >= this.maxCount) {
      return false;
    }
    entry.count++;
    return true;
  }

  public reset(key: string): void {
    this.buckets.delete(key);
  }
}
