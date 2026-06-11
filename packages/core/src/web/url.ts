/** URL parsing/validation guards shared by the web tools. */

/** Parse a URL and assert it is http(s). Throws a clear error otherwise. */
export function parseHttpUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`Invalid URL: ${raw}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(
      `Only http/https URLs are allowed, got "${u.protocol}" in ${raw}`,
    );
  }
  return u;
}

/**
 * Heuristic: is this host a loopback / private-network address?
 * Tools that fetch arbitrary model-supplied URLs can use this to block SSRF
 * against the host's internal network. Off by default (local models often
 * legitimately call localhost services), opt-in per tool.
 */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h === "::1" || h.endsWith(".localhost")) return true;
  if (h.endsWith(".internal") || h.endsWith(".local")) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 10 || a === 127) return true; // 10.0.0.0/8, loopback
  if (a === 169 && b === 254) return true; // link-local
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  return false;
}
