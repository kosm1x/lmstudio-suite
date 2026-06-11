/**
 * Small fetch helpers with a hard timeout + caller-abort support.
 * Every outbound request in the suite goes through these so timeouts and
 * cancellation behave consistently across tools.
 */

export const DEFAULT_UA =
  "Mozilla/5.0 (compatible; LMStudioSuite/0.1; +https://lmstudio.ai)";

export interface HttpControl {
  /** Abort the request after this many ms (default 15000). */
  timeoutMs?: number;
  /** Caller's abort signal; composes with the internal timeout. */
  signal?: AbortSignal;
}

/** fetch() wrapper that enforces a timeout and forwards a caller AbortSignal. */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  ctl: HttpControl = {},
): Promise<Response> {
  const { timeoutMs = 15_000, signal } = ctl;
  const controller = new AbortController();
  const onAbort = () => controller.abort((signal as AbortSignal).reason);
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  const timer = setTimeout(
    () =>
      controller.abort(
        new Error(`Request timed out after ${timeoutMs}ms: ${url}`),
      ),
    timeoutMs,
  );
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onAbort);
  }
}

/** GET/POST returning parsed JSON; throws on non-2xx with a truncated body. */
export async function fetchJson<T = unknown>(
  url: string,
  init: RequestInit = {},
  ctl: HttpControl = {},
): Promise<T> {
  const res = await fetchWithTimeout(
    url,
    {
      ...init,
      headers: {
        accept: "application/json",
        "user-agent": DEFAULT_UA,
        ...init.headers,
      },
    },
    ctl,
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `HTTP ${res.status} ${res.statusText} for ${url}: ${body.slice(0, 200)}`,
    );
  }
  return (await res.json()) as T;
}

/** POST an x-www-form-urlencoded body and return the response text. */
export async function postForm(
  url: string,
  form: URLSearchParams,
  ctl: HttpControl = {},
): Promise<string> {
  const res = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": DEFAULT_UA,
      },
      body: form.toString(),
    },
    ctl,
  );
  if (!res.ok)
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  return res.text();
}
