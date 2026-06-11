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
  if (h.endsWith(".") && !h.includes(":")) h = h.slice(0, -1); // drop FQDN root dot (localhost. -> localhost)

  if (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".internal") ||
    h.endsWith(".local")
  ) {
    return true;
  }

  // Normalize IPv4-mapped / IPv4-compatible / NAT64 IPv6 to dotted IPv4 so the
  // v4 private-range checks apply. URL.hostname compresses the embedded IPv4 to
  // hex hextets (e.g. http://[::ffff:127.0.0.1]/ → "::ffff:7f00:1"), which the
  // dotted-quad regex below would otherwise miss — a real SSRF bypass.
  if (h.includes(":")) {
    const dotted = /^(?:::ffff:|::)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(
      h,
    );
    const hex =
      /^(?:::ffff:|::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(h) ??
      /^64:ff9b::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(h);
    if (dotted) {
      h = dotted[1] ?? h;
    } else if (hex) {
      const hi = parseInt(hex[1] ?? "0", 16);
      const lo = parseInt(hex[2] ?? "0", 16);
      h = `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
    }
  }

  // IPv6 (non IPv4-embedded)
  if (h.includes(":")) {
    if (h === "::1" || h === "::") return true; // loopback / unspecified
    if (h.startsWith("fe80:")) return true; // link-local
    if (h.startsWith("fc") || h.startsWith("fd")) return true; // unique-local fc00::/7
    return false;
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
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking 198.18/15
  if (a === 192 && b === 0 && Number(m[3]) === 0) return true; // IETF protocol 192.0.0/24
  return false;
}
