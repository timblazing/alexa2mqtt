const MINIMUM_BACKOFF_MS = 10_000;
const MAXIMUM_BACKOFF_MS = 5 * 60_000;

export const backoffDelayMs = (
  consecutiveFailures: number,
  random: () => number = Math.random,
): number => {
  const exponent = Math.max(0, consecutiveFailures - 1);
  const base = Math.min(
    MINIMUM_BACKOFF_MS * 2 ** exponent,
    MAXIMUM_BACKOFF_MS,
  );
  const jitter = 0.8 + Math.min(1, Math.max(0, random())) * 0.4;
  return Math.round(base * jitter);
};

export const waitForDelay = async (
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }

    const finish = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener('abort', finish, { once: true });
  });
