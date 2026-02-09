function enhanceBrowserFetchError(url: string, err: unknown, timeoutMs: number): Error {
  const msg = String(err);
  const msgLower = msg.toLowerCase();
  const looksLikeTimeout =
    msgLower.includes("timed out") ||
    msgLower.includes("timeout") ||
    msgLower.includes("aborted") ||
    msgLower.includes("abort") ||
    msgLower.includes("aborterror");
  if (looksLikeTimeout) {
    return new Error(
      `Can't reach the EClaw browser control service (timed out after ${timeoutMs}ms). Ensure the browser server is running.`,
    );
  }
  return new Error(`Can't reach the EClaw browser control service. (${msg})`);
}

async function fetchHttpJson<T>(
  url: string,
  init: RequestInit & { timeoutMs?: number },
): Promise<T> {
  const timeoutMs = init.timeoutMs ?? 5000;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || `HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

let browserControlBaseUrl = "http://127.0.0.1:12200";

export function setBrowserControlBaseUrl(url: string): void {
  browserControlBaseUrl = url.replace(/\/$/, "");
}

export async function fetchBrowserJson<T>(
  url: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<T> {
  const timeoutMs = init?.timeoutMs ?? 5000;
  try {
    const fullUrl = /^https?:\/\//i.test(url.trim())
      ? url
      : `${browserControlBaseUrl}${url.startsWith("/") ? "" : "/"}${url}`;
    return await fetchHttpJson<T>(fullUrl, { ...init, timeoutMs });
  } catch (err) {
    throw enhanceBrowserFetchError(url, err, timeoutMs);
  }
}
