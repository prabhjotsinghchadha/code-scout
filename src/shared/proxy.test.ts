import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  activeServer,
  credentialsFor,
  isProxied,
  pacScript,
  parseServer,
  proxyFrom,
  serverAddress,
  signInProblem,
  withSite,
  type ProxyServer,
  type ProxyState,
} from './proxy.ts';

const japan: ProxyServer = { id: 'a', name: 'Japan', scheme: 'socks5', host: '10.0.0.2', port: 1080 };
const us: ProxyServer = { id: 'b', name: 'US', scheme: 'http', host: 'proxy.example.com', port: 8080, username: 'me', password: 'secret' };
const state = (patch: Partial<ProxyState> = {}): ProxyState => ({ on: true, servers: [japan, us], active: 'a', sites: ['missav.ws'], ...patch });

/** What Chrome would do with `host`, by running the PAC script. */
function route(pac: string, host: string): string {
  const find = new Function(`${pac}; return FindProxyForURL;`)() as (url: string, host: string) => string;
  return find(`https://${host}/`, host);
}

test('reads a server from what was typed', () => {
  assert.deepEqual(parseServer('proxy.example.com:8080'), { scheme: 'http', host: 'proxy.example.com', port: 8080 });
  assert.deepEqual(parseServer(' SOCKS5://10.0.0.2:1080/ '), { scheme: 'socks5', host: '10.0.0.2', port: 1080 });
  assert.deepEqual(parseServer('10.0.0.2:1080', 'socks4'), { scheme: 'socks4', host: '10.0.0.2', port: 1080 });
  assert.deepEqual(parseServer('socks://[::1]:9050'), { scheme: 'socks5', host: '[::1]', port: 9050 });
  assert.deepEqual(parseServer('https://me:p%40ss@Proxy.Example.com:443'), {
    scheme: 'https',
    host: 'proxy.example.com',
    port: 443,
    username: 'me',
    password: 'p@ss',
  });
});

test('says what is wrong with a server that cannot be used', () => {
  for (const bad of ['', 'proxy.example.com', 'ftp://proxy.example.com:21', 'proxy.example.com:0', 'proxy.example.com:70000', 'not a server:80', 'a_b.com:80', 'http://x.com:80/path']) {
    assert.ok('error' in parseServer(bad), bad);
  }
});

test('shows a server without its sign-in', () => {
  assert.equal(serverAddress(us), 'http://proxy.example.com:8080');
});

test('a SOCKS proxy with a sign-in is flagged, others are not', () => {
  assert.ok(signInProblem({ scheme: 'socks5', username: 'me' }));
  assert.equal(signInProblem({ scheme: 'socks5' }), null);
  assert.equal(signInProblem(us), null);
});

test('only the listed sites and their subdomains go through the server', () => {
  const pac = pacScript(state())!;
  assert.equal(route(pac, 'missav.ws'), 'SOCKS5 10.0.0.2:1080');
  assert.equal(route(pac, 'www.MissAV.ws'), 'SOCKS5 10.0.0.2:1080');
  assert.equal(route(pac, 'cdn.missav.ws.'), 'SOCKS5 10.0.0.2:1080');
  assert.equal(route(pac, 'notmissav.ws'), 'DIRECT');
  assert.equal(route(pac, 'missav.ws.evil.com'), 'DIRECT');
  assert.equal(route(pac, 'mail.google.com'), 'DIRECT');
});

test('each kind of proxy is named the way a PAC script names it, with no direct fallback', () => {
  const via = (scheme: ProxyServer['scheme']) => route(pacScript(state({ servers: [{ ...japan, scheme }] }))!, 'missav.ws');
  assert.equal(via('http'), 'PROXY 10.0.0.2:1080');
  assert.equal(via('https'), 'HTTPS 10.0.0.2:1080');
  assert.equal(via('socks4'), 'SOCKS 10.0.0.2:1080');
  assert.ok(!via('http').includes('DIRECT'));
});

test('nothing is proxied when off, with no server, or with no sites', () => {
  assert.equal(pacScript(state({ on: false })), null);
  assert.equal(pacScript(state({ sites: [] })), null);
  assert.equal(pacScript(state({ servers: [], active: null })), null);
  assert.equal(activeServer(state({ on: false })), null);
  assert.equal(activeServer(state({ active: 'b' }))?.name, 'US');
});

test('a site name cannot break out of the script', () => {
  const pac = pacScript(state({ sites: ['x.com"];return "PROXY evil:1";//'] }))!;
  assert.equal(route(pac, 'example.com'), 'DIRECT');
});

test('checks what is stored', () => {
  const read = proxyFrom({
    on: true,
    active: 'gone',
    servers: [japan, { ...us, id: 'a' }, { id: 'c', scheme: 'ftp', host: 'x.com', port: 21 }, { id: 'd', scheme: 'http', host: 'x.com', port: 0 }, 'junk', { ...us, name: '  ' }],
    sites: ['https://www.MissAV.ws/en', 'missav.ws', 'not a site', 7],
  });
  assert.deepEqual(read.servers.map((s) => s.id), ['a', 'b']);
  assert.equal(read.servers[1].name, 'proxy.example.com');
  assert.equal(read.active, 'a'); // the one picked is gone: the first
  assert.deepEqual(read.sites, ['missav.ws']);
  assert.deepEqual(proxyFrom(undefined), { on: false, servers: [], active: null, sites: [] });
  assert.equal(proxyFrom({ on: true, servers: [] }).on, false); // on with no server is off
});

test('a password is only kept with a user name', () => {
  const [server] = proxyFrom({ servers: [{ ...us, username: '' }] }).servers;
  assert.equal(server.username, undefined);
  assert.equal(server.password, undefined);
});

test('a site is switched on and off, with the domain that covers it', () => {
  assert.equal(isProxied('m.missav.ws', ['missav.ws']), true);
  assert.equal(isProxied('notmissav.ws', ['missav.ws']), false);
  assert.deepEqual(withSite(['a.com'], 'missav.ws', true), ['a.com', 'missav.ws']);
  assert.deepEqual(withSite(['a.com', 'missav.ws'], 'missav.ws', true), ['a.com', 'missav.ws']);
  assert.deepEqual(withSite(['a.com', 'missav.ws'], 'missav.ws', false), ['a.com']);
  assert.deepEqual(withSite(['a.com', 'missav.ws'], 'm.missav.ws', false), ['a.com']);
});

test('signs in to the server in use only', () => {
  const inUse = state({ active: 'b' });
  assert.deepEqual(credentialsFor(inUse, { host: 'Proxy.Example.com', port: 8080 }), { username: 'me', password: 'secret' });
  assert.equal(credentialsFor(inUse, { host: 'proxy.example.com', port: 3128 }), null);
  assert.equal(credentialsFor(inUse, { host: 'other.example.com', port: 8080 }), null);
  assert.equal(credentialsFor(state({ active: 'b', on: false }), { host: 'proxy.example.com', port: 8080 }), null);
  assert.equal(credentialsFor(state(), { host: '10.0.0.2', port: 1080 }), null); // no sign-in saved
  const socks = state({ servers: [{ ...japan, username: 'me', password: 'x' }] });
  assert.equal(credentialsFor(socks, { host: '10.0.0.2', port: 1080 }), null);
});
