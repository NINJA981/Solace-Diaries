/** In-process wake-up signal between `enqueue` and idle worker loops. */
const sleepers = new Set<() => void>();

/** Wake idle worker loops now instead of at their next poll. */
export function notifyWorker(): void {
  for (const wake of sleepers) wake();
  sleepers.clear();
}

/** Sleep up to `ms`, returning early on `notifyWorker()`. Returns true if woken. */
export function idleWait(ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const wake = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      sleepers.delete(wake);
      resolve(false);
    }, ms);
    sleepers.add(wake);
  });
}
