/**
 * fetch() that follows redirects MANUALLY, re-validating every hop's host
 * against the SSRF guard — a public URL can otherwise 30x into a private /
 * loopback / cloud-metadata address. This is the single audited network path
 * the http tools share (fetchPage uses it too). Only http/https is allowed.
 */
import { fetchWithTimeout, DEFAULT_UA, type HttpControl } from "./http";
import { isPrivateHost, parseHttpUrl } from "./url";

export interface GuardedFetchOptions extends HttpControl {
  /**
   * Allow loopback / private-network / link-local hosts. Default false blocks
   * SSRF against localhost, internal services, and cloud-metadata endpoints —
   * including across redirects.
   */
  allowPrivateHosts?: boolean;
  /** Maximum redirect hops to follow (default 5). */
  maxRedirects?: number;
  /** User-Agent header (default DEFAULT_UA). */
  userAgent?: string;
}

export interface GuardedResponse {
  response: Response;
  /** The final URL after redirects. */
  finalUrl: string;
}

export async function guardedFetch(
  url: string,
  init: RequestInit = {},
  options: GuardedFetchOptions = {},
): Promise<GuardedResponse> {
  const {
    allowPrivateHosts = false,
    maxRedirects = 5,
    timeoutMs,
    signal,
    userAgent = DEFAULT_UA,
  } = options;

  const guardHost = (u: URL) => {
    if (!allowPrivateHosts && isPrivateHost(u.hostname)) {
      throw new Error(
        `Refusing to reach a private/loopback host (${u.hostname}). ` +
          `Set allowPrivateHosts to override.`,
      );
    }
  };

  let current = url;
  let currentInit = init;
  let hops = 0;
  for (;;) {
    guardHost(parseHttpUrl(current));
    const res = await fetchWithTimeout(
      current,
      {
        ...currentInit,
        redirect: "manual",
        headers: { "user-agent": userAgent, ...currentInit.headers },
      },
      { timeoutMs, signal },
    );
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      if (++hops > maxRedirects)
        throw new Error(`Too many redirects for ${url}`);
      current = new URL(location, current).toString();
      // 301/302/303 → the follow-up is a GET without the original body
      // (RFC 9110); 307/308 preserve method + body.
      if (res.status === 301 || res.status === 302 || res.status === 303) {
        currentInit = { ...currentInit, method: "GET", body: undefined };
      }
      await res.body?.cancel().catch(() => {}); // free the socket
      continue;
    }
    return { response: res, finalUrl: current };
  }
}
