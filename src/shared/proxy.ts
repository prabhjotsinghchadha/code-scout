// Proxy ("VPN") for chosen sites: the browser's connections to the sites listed go through a proxy server
// the user has; everything else connects directly. An extension can't run a VPN tunnel, only tell Chrome
// which proxy to use (chrome.proxy), which is what this does, with a PAC script made from the list.
//
// Kept in local storage, on this computer only: the servers carry passwords, so they are neither synced
// nor written to the backup file (data-file.ts exports known keys only, and this isn't one).
import { siteKey } from './hosts.ts';

export const PROXY_KEY = 'proxy';
export const MAX_SERVERS = 20;
export const MAX_PROXY_SITES = 200;
const MAX_NAME = 40;
const MAX_CREDENTIAL = 200;

export const SCHEMES = ['http', 'https', 'socks5', 'socks4'] as const;
export type ProxyScheme = (typeof SCHEMES)[number];
export const SCHEME_LABELS: Record<ProxyScheme, string> = { http: 'HTTP', https: 'HTTPS', socks5: 'SOCKS5', socks4: 'SOCKS4' };

export interface ProxyServer {
  id: string;
  name: string;
  scheme: ProxyScheme;
  /** A hostname, an IPv4 address, or an IPv6 address in brackets. Lower case. */
  host: string;
  port: number;
  /** HTTP and HTTPS proxies only: Chrome doesn't sign in to SOCKS proxies. */
  username?: string;
  password?: string;
}

export interface ProxyState {
  /** The master switch. Off, every site connects directly. */
  on: boolean;
  servers: ProxyServer[];
  /** The server in use (its id); null with no servers. */
  active: string | null;
  /** Sites (hostnames, see hosts.ts) that go through the proxy, with their subdomains. */
  sites: string[];
}

export const emptyProxy: ProxyState = { on: false, servers: [], active: null, sites: [] };

const isScheme = (v: unknown): v is ProxyScheme => SCHEMES.includes(v as ProxyScheme);
const HOST = /^(?:\[[0-9a-f:.]+\]|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)$/;
const validPort = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 65535;

export type ParsedServer = Omit<ProxyServer, 'id' | 'name'>;

/**
 * A server from what was typed: "host:port", or an address with its type and sign-in
 * ("socks5://10.0.0.2:1080", "http://user:pass@proxy.example.com:8080"). `fallback` is the type when the
 * text names none. An error message when it isn't one.
 */
export function parseServer(input: string, fallback: ProxyScheme = 'http'): ParsedServer | { error: string } {
  const m = /^(?:([a-z][a-z\d]*):\/\/)?(?:([^:@/\s]*)(?::([^@/\s]*))?@)?(\[[0-9a-f:.]+\]|[^:/@\s[\]]+)(?::(\d{1,5}))?\/?$/i.exec(input.trim());
  if (!m) return { error: 'Enter the server as host:port, like proxy.example.com:8080.' };
  const [, rawScheme, user, pass, rawHost, rawPort] = m;
  const named = rawScheme?.toLowerCase();
  const scheme = named === 'socks' || named === 'socks5h' ? 'socks5' : (named ?? fallback);
  if (!isScheme(scheme)) return { error: `“${rawScheme}” isn’t a kind of proxy Chrome can use (HTTP, HTTPS, SOCKS5 or SOCKS4).` };
  const host = rawHost.toLowerCase();
  if (!HOST.test(host)) return { error: 'That doesn’t look like a server’s address.' };
  if (!rawPort) return { error: 'Add the port after the address, like :8080 or :1080.' };
  const port = Number(rawPort);
  if (!validPort(port)) return { error: 'The port is a number from 1 to 65535.' };
  const server: ParsedServer = { scheme, host, port };
  if (user) {
    server.username = decode(user);
    if (pass) server.password = decode(pass);
  }
  return server;
}

function decode(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

/** "socks5://10.0.0.2:1080": the server without its sign-in, for showing. */
export function serverAddress(server: Pick<ProxyServer, 'scheme' | 'host' | 'port'>): string {
  return `${server.scheme}://${server.host}:${server.port}`;
}

/** Why this server can't sign in, if it can't: Chrome has no way to give a SOCKS proxy a name and password. */
export function signInProblem(server: Pick<ProxyServer, 'scheme' | 'username'>): string | null {
  return server.username && server.scheme.startsWith('socks')
    ? 'Chrome can’t sign in to a SOCKS proxy. Use one that needs no sign-in (or allows your IP address), or its HTTP/HTTPS address.'
    : null;
}

export function newServerId(): string {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** What's stored, checked piece by piece: anything that isn't a server or a site is left out. */
export function proxyFrom(value: unknown): ProxyState {
  if (!value || typeof value !== 'object') return { ...emptyProxy };
  const v = value as Record<string, unknown>;
  const ids = new Set<string>();
  const servers = (Array.isArray(v.servers) ? v.servers : []).flatMap((s: unknown): ProxyServer[] => {
    if (!s || typeof s !== 'object') return [];
    const { id, name, scheme, host, port, username, password } = s as Record<string, unknown>;
    if (typeof id !== 'string' || !id || ids.has(id) || !isScheme(scheme)) return [];
    if (typeof host !== 'string' || !HOST.test(host) || !validPort(port)) return [];
    ids.add(id);
    const server: ProxyServer = { id, name: (typeof name === 'string' ? name.trim().slice(0, MAX_NAME) : '') || host, scheme, host, port };
    if (typeof username === 'string' && username) {
      server.username = username.slice(0, MAX_CREDENTIAL);
      if (typeof password === 'string' && password) server.password = password.slice(0, MAX_CREDENTIAL);
    }
    return [server];
  });
  const sites = [
    ...new Set((Array.isArray(v.sites) ? v.sites : []).flatMap((s: unknown) => (typeof s === 'string' ? (siteKey(s) ?? []) : []))),
  ];
  const kept = servers.slice(0, MAX_SERVERS);
  const active = typeof v.active === 'string' && kept.some((s) => s.id === v.active) ? v.active : (kept[0]?.id ?? null);
  return { on: v.on === true && kept.length > 0, servers: kept, active, sites: sites.slice(0, MAX_PROXY_SITES) };
}

/** The server in use, or null when the proxy is off or has none. */
export function activeServer(state: ProxyState): ProxyServer | null {
  return (state.on && state.servers.find((s) => s.id === state.active)) || null;
}

/** True if `hostname` goes through the proxy: one of the sites, or a subdomain of one. */
export function isProxied(hostname: string, sites: string[]): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return sites.some((s) => host === s || host.endsWith(`.${s}`));
}

/** `sites` with `host` on it, or without it and without whichever site covers it (its parent domain). */
export function withSite(sites: string[], host: string, proxied: boolean): string[] {
  const rest = sites.filter((s) => s !== host && !(host.endsWith(`.${s}`) && !proxied));
  return proxied ? [...rest, host] : rest;
}

/** What a PAC script calls each kind of proxy. */
const PAC_KIND: Record<ProxyScheme, string> = { http: 'PROXY', https: 'HTTPS', socks5: 'SOCKS5', socks4: 'SOCKS' };

/**
 * The PAC script Chrome runs for every request: the listed sites and their subdomains go to the server,
 * the rest connect directly. Null when nothing is to be proxied (off, no server, or no sites).
 *
 * A listed site never falls back to a direct connection: if the server is down the page fails, rather than
 * loading from your own address without saying so.
 */
export function pacScript(state: ProxyState): string | null {
  const server = activeServer(state);
  if (!server || !state.sites.length) return null;
  const via = `${PAC_KIND[server.scheme]} ${server.host}:${server.port}`;
  return [
    'function FindProxyForURL(url, host) {',
    `  var sites = ${JSON.stringify(state.sites)};`,
    "  host = host.toLowerCase().replace(/\\.$/, '');",
    '  for (var i = 0; i < sites.length; i++) {',
    "    if (host === sites[i] || host.slice(-sites[i].length - 1) === '.' + sites[i]) return " + JSON.stringify(via) + ';',
    '  }',
    "  return 'DIRECT';",
    '}',
  ].join('\n');
}

/**
 * The sign-in to answer a proxy's challenge with: the server in use's, when the challenge comes from it.
 * Never another server's, and never for a website's own sign-in box.
 */
export function credentialsFor(state: ProxyState, challenger: { host: string; port: number }): { username: string; password: string } | null {
  const server = activeServer(state);
  if (!server?.username || signInProblem(server)) return null;
  const host = challenger.host.toLowerCase();
  if (server.port !== challenger.port || (host !== server.host && `[${host}]` !== server.host)) return null;
  return { username: server.username, password: server.password ?? '' };
}

// --- chrome.storage ---

export async function getProxy(): Promise<ProxyState> {
  const stored = await chrome.storage.local.get(PROXY_KEY);
  return proxyFrom(stored[PROXY_KEY]);
}

let write = Promise.resolve();
/** Changes what's stored, one change at a time, so two quick ones don't undo each other. */
export function updateProxy(change: (state: ProxyState) => ProxyState): Promise<ProxyState> {
  const next = write.then(async () => {
    const state = proxyFrom(change(await getProxy()));
    await chrome.storage.local.set({ [PROXY_KEY]: state });
    return state;
  });
  write = next.then(
    () => {},
    () => {},
  );
  return next;
}

export function onProxyChanged(callback: (state: ProxyState) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[PROXY_KEY]) callback(proxyFrom(changes[PROXY_KEY].newValue));
  });
}
