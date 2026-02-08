import type { CronServiceState } from "./state.js";

const storeLocks = new Map<string, Promise<void>>();

export async function locked<T>(state: CronServiceState, fn: () => Promise<T>): Promise<T> {
  const storePath = state.deps.storePath;

  let releaseLock!: () => void;
  const myLock = new Promise<void>(fn2 => { releaseLock = fn2; });

  const prevOp = state.op;
  const prevStore = storeLocks.get(storePath) ?? Promise.resolve();

  state.op = myLock.then(() => undefined);
  storeLocks.set(storePath, myLock.then(() => undefined));

  await Promise.all([prevOp.catch(() => undefined), prevStore.catch(() => undefined)]);

  try {
    return await fn();
  } finally {
    releaseLock();
    if (storeLocks.get(storePath) === state.op) {
      storeLocks.delete(storePath);
    }
  }
}
