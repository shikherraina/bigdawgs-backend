export async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 3,
  delayMs = 800,
): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err: any) {
      const isSSLError =
        err?.message?.includes("525") ||
        err?.message?.includes("SSL") ||
        err?.message?.includes("handshake");

      if (i < retries - 1 && isSSLError) {
        console.warn(`Supabase SSL error — retrying (${i + 1}/${retries})...`);
        await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
        continue;
      }
      throw err;
    }
  }
  throw new Error("Max retries reached");
}
