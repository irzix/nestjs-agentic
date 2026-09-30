/**
 * Runs persistence writes in order without making the caller wait for them.
 *
 * Each write starts only after the previous one has settled, so later state
 * (a newer checkpoint, a longer transcript) can never be overwritten by an
 * older write that finished late. A failing write does not stop the ones queued
 * after it; the first failure is kept and rethrown by `flush()`.
 */
export class DeferredWriteQueue {
  private tail: Promise<void>;
  private failure: { error: unknown } | undefined;

  /**
   * @param after Writes queued here start only once this settles. Pass the
   *   previous queue's `settled` to keep order across turns.
   */
  constructor(after: Promise<void> = Promise.resolve()) {
    this.tail = after.then(
      () => undefined,
      () => undefined,
    );
  }

  /** Queues a write behind every write queued before it. */
  enqueue(write: () => void | Promise<void>): void {
    this.tail = this.tail.then(async () => {
      try {
        await write();
      } catch (error: unknown) {
        this.failure ??= { error };
      }
    });
  }

  /** Resolves once every write queued so far has settled. Never rejects. */
  get settled(): Promise<void> {
    return this.tail;
  }

  /** Waits for every queued write, then rethrows the first failure, if any. */
  async flush(): Promise<void> {
    await this.tail;
    if (this.failure) {
      const { error } = this.failure;
      this.failure = undefined;
      throw error;
    }
  }
}
