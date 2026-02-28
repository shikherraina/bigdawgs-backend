import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY!;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Missing Supabase environment variables");
}

// Retry fetch wrapper — handles intermittent Supabase SSL 525 errors
const fetchWithRetry = async (
  url: Request | string | URL,
  options: RequestInit = {},
  retries = 3,
  delayMs = 800,
): Promise<Response> => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { ...options, keepalive: true });

      // Retry on server-side errors
      if ([500, 502, 503, 504, 525].includes(res.status) && attempt < retries) {
        console.warn(
          `Supabase request failed (${res.status}) — retrying attempt ${attempt}/${retries}...`,
        );
        await new Promise((r) => setTimeout(r, delayMs * attempt));
        continue;
      }

      return res;
    } catch (err: any) {
      const isNetworkError =
        err?.message?.includes("SSL") ||
        err?.message?.includes("525") ||
        err?.message?.includes("handshake") ||
        err?.message?.includes("ECONNRESET") ||
        err?.message?.includes("fetch failed");

      if (isNetworkError && attempt < retries) {
        console.warn(
          `Supabase network error — retrying attempt ${attempt}/${retries}:`,
          err?.message,
        );
        await new Promise((r) => setTimeout(r, delayMs * attempt));
        continue;
      }

      throw err;
    }
  }

  throw new Error("Supabase request failed after maximum retries");
};

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
  },
  global: {
    fetch: fetchWithRetry,
  },
});
