/** Coalesces deadlines before serialized storage access; a stale get cannot
 * overwrite an earlier poll/reader deadline. Retains one promise and one number. */
export class EarliestAlarm {
  private requested: number | null = null;
  private running: Promise<void> | null = null;
  private consumedThrough = 0;
  constructor(
    private readonly storage: DurableObjectStorage,
    private readonly waitUntil: (task: Promise<void>) => void,
  ) {}

  /** An executing alarm is consumed even when native getAlarm still reports it. */
  fired(): void {
    this.consumedThrough = Date.now();
  }

  schedule(deadline: number): Promise<void> {
    this.requested = Math.min(this.requested ?? Infinity, deadline);
    if (this.running) return this.running;
    this.running = this.drain().finally(() => {
      this.running = null;
      if (this.requested !== null) this.waitUntil(this.schedule(this.requested));
    });
    return this.running;
  }

  private async drain() {
    while (this.requested !== null) {
      const deadline = this.requested;
      this.requested = null;
      const current = await this.storage.getAlarm();
      if (current === null || current <= this.consumedThrough || deadline < current)
        await this.storage.setAlarm(Math.max(deadline, Date.now() + 1));
    }
  }
}
