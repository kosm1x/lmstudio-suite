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
 * Is this host a loopback / private-network / link-local address?
 * Used to block SSRF against the host's internal network and cloud metadata
 * endpoints when fetching model-supplied URLs. Accepts hostnames as produced by
 * `URL.hostname` (IPv6 addresses arrive bracketed, e.g. "[::1]").
 */
export function isPrivateHost(hostname: string): boolean {
  let h = hostname.toLowerCase().trim();
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1); // unwrap IPv6 literal

  if (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".internal") ||
    h.endsWith(".local")
  ) {
    return true;
  }

  // IPv6
  if (h.includes(":")) {
    if (h === "::1" || h === "::") return true; // loopback / unspecified
    if (h.startsWith("fe80:")) return true; // link-local
    if (h.startsWith("fc") || h.startsWith("fd")) return true; // unique-local fc00::/7
    if (h.startsWith("::ffff:"))
      h = h.slice(7); // IPv4-mapped → fall through if dotted
    else return false;
  }

  // IPv4 (dotted quad)
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 0 || a === 10 || a === 127) return true; // 0.0.0.0/8, 10/8, loopback
  if (a === 169 && b === 254) return true; // link-local (incl. cloud metadata)
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  return false;
}
