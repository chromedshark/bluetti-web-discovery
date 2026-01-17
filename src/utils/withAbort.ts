/**
 * Races a promise against an AbortSignal.
 * Rejects with signal.reason if aborted.
 */
export const withAbort = <T>(promise: Promise<T>, signal: AbortSignal): Promise<T> => {
  if (signal.aborted) {
    return Promise.reject(signal.reason);
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise
      .then(resolve)
      .catch(reject)
      .finally(() => {
        signal.removeEventListener("abort", onAbort);
      });
  });
};
