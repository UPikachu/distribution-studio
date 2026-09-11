/** One attempt owns its cancellation and deadline; late promises cannot revive it. */
export class Execution {
  readonly controller = new AbortController();
  readonly deadline = Date.now() + 90000;
  leaseUntil = 0;
  check() {
    this.controller.signal.throwIfAborted();
    if (Date.now() >= this.deadline) {
      this.abort("任务执行超时，请检查平台草稿后继续。");
      this.controller.signal.throwIfAborted();
    }
  }
  abort(message: string) {
    this.controller.abort(new Error(message));
  }
  async wait<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    // Attach a handler even when cancellation happened before this wait.
    void promise.catch(() => {});
    this.check();
    const signal = this.controller.signal;
    let timer: ReturnType<typeof setTimeout>;
    let onAbort: () => void;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          onAbort = () => reject(signal.reason);
          signal.addEventListener("abort", onAbort, { once: true });
          timer = setTimeout(
            () => this.abort(message),
            Math.max(1, Math.min(ms, this.deadline - Date.now())),
          );
        }),
      ]).then((value) => {
        this.check();
        return value;
      });
    } finally {
      clearTimeout(timer!);
      signal.removeEventListener("abort", onAbort!);
    }
  }
}
