// Per-site lists (▶ buttons off, pop-up blocker): hostnames like "javtiful.com".

/** "javtiful.com" from a URL or hostname ("www." dropped, lowercase); null if it isn't one. */
export function siteKey(input: string): string | null {
  const raw = input.trim().toLowerCase();
  if (!raw) return null;
  try {
    const { hostname, protocol } = new URL(/^[a-z][a-z\d+.-]*:\/\//.test(raw) ? raw : `https://${raw}`);
    if (protocol !== 'http:' && protocol !== 'https:') return null;
    if (!hostname.includes('.') && hostname !== 'localhost') return null;
    return hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** True if `hostname` is one of `sites` or a subdomain of one (m.javtiful.com matches javtiful.com). */
export function isSiteOff(hostname: string, sites: string[]): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, '');
  return sites.some((s) => host === s || host.endsWith(`.${s}`));
}

/** "javtiful.com" for "m.javtiful.com" — the last two labels, good enough to tell a site from an ad network. */
export function baseDomain(hostname: string): string {
  const host = hostname.toLowerCase().replace(/^www\./, '');
  return /^[\d.]+$/.test(host) ? host : host.split('.').slice(-2).join('.');
}

/** True if both URLs are on the same site (subdomains count as the same site). */
export function sameSite(a: string, b: string): boolean {
  try {
    return baseDomain(new URL(a).hostname) === baseDomain(new URL(b).hostname);
  } catch {
    return false;
  }
}

/** Match patterns covering each site and its subdomains, for chrome.scripting. */
export function sitePatterns(sites: string[]): string[] {
  return sites.map((s) => (s === 'localhost' || /^[\d.]+$/.test(s) ? `*://${s}/*` : `*://*.${s}/*`));
}
