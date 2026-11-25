export async function withRequestTimeout<T>(ms: number, request: (signal: AbortSignal) => Promise<T>) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await request(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}
