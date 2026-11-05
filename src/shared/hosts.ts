// Per-site off switch: hostnames where the ▶ buttons and chip don't run.

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
