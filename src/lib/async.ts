export async function withSoftTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<
  | { timedOut: false; value: T }
  | { timedOut: true; value: null }
> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    const result = await Promise.race([
      promise.then((value) => ({ timedOut: false as const, value })),
      new Promise<{ timedOut: true; value: null }>((resolve) => {
        timeoutId = setTimeout(() => resolve({ timedOut: true as const, value: null }), timeoutMs);
      }),
    ]);

    return result;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
