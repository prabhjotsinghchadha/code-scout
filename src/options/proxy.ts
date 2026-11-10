// Settings → Proxy: the servers, which one is in use, and the sites that go through it (shared/proxy.ts).
import { siteKey } from '../shared/hosts';
import { icon } from '../shared/icons';
import {
  getProxy,
  MAX_PROXY_SITES,
  MAX_SERVERS,
  newServerId,
  onProxyChanged,
  parseServer,
  SCHEME_LABELS,
  SCHEMES,
  serverAddress,
  signInProblem,
  updateProxy,
  type ProxyScheme,
  type ProxyServer,
  type ProxyState,
} from '../shared/proxy';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: object = {}): HTMLElementTagNameMap[K] {
  return Object.assign(document.createElement(tag), props);
}

function showError(target: HTMLElement, message: string | null) {
  target.hidden = !message;
  target.textContent = message ?? '';
}

export async function setupProxy(flash: (text: string) => void) {
  const on = $<HTMLInputElement>('proxy-on');
  const stateLine = $('proxy-state');
  const warning = $('proxy-warning');
  const serverList = $<HTMLUListElement>('proxy-servers');
  const serverError = $('proxy-server-error');
  const siteList = $<HTMLUListElement>('proxy-sites');
  const siteError = $('proxy-error');
  const scheme = $<HTMLSelectElement>('proxy-scheme');
  let state = await getProxy();

  scheme.replaceChildren(...SCHEMES.map((s) => el('option', { value: s, textContent: SCHEME_LABELS[s] })));

  const change = async (edit: (state: ProxyState) => ProxyState, note = 'Saved') => {
    state = await updateProxy(edit);
    render();
    flash(note);
  };

  /** Chrome lets one extension set the proxy: say so when it isn't this one. */
  const checkControl = async () => {
    const { levelOfControl } = await chrome.proxy.settings.get({});
    const using = state.on && state.sites.length > 0;
    showError(
      warning,
      !using
        ? null
        : levelOfControl === 'controlled_by_other_extensions'
          ? 'Another extension (a VPN or proxy one) is setting Chrome’s proxy, so this one isn’t in use. Switch that extension off to use it.'
          : levelOfControl === 'not_controllable'
            ? 'Chrome’s proxy is set by your organisation or by a command-line option, so this one isn’t in use.'
            : null,
    );
  };

  function serverRow(server: ProxyServer): HTMLLIElement {
    const li = el('li', { className: 'server' });
    const radio = el('input', { type: 'radio', name: 'proxy-active', checked: server.id === state.active, title: `Use ${server.name}` });
    radio.setAttribute('aria-label', `Use ${server.name}`);
    radio.addEventListener('change', () => radio.checked && void change((s) => ({ ...s, active: server.id })));
    const name = el('input', { className: 'inline-name', value: server.name, title: 'Click to rename', maxLength: 40 });
    name.addEventListener('change', () => {
      const value = name.value.trim() || server.host;
      void change((s) => ({ ...s, servers: s.servers.map((x) => (x.id === server.id ? { ...x, name: value } : x)) }));
    });
    const text = el('span');
    text.append(name, el('small', { textContent: serverAddress(server) + (server.username ? ` · signs in as ${server.username}` : '') }));
    const problem = signInProblem(server);
    if (problem) text.append(el('small', { className: 'problem', textContent: problem }));
    const remove = el('button', { type: 'button', className: 'icon-btn danger', title: `Remove ${server.name}` });
    remove.setAttribute('aria-label', `Remove ${server.name}`);
    remove.append(icon('trash'));
    remove.addEventListener('click', () => void change((s) => ({ ...s, servers: s.servers.filter((x) => x.id !== server.id) }), 'Removed'));
    li.append(radio, text, remove);
    // The whole row picks the server, except where it's being renamed or removed.
    li.addEventListener('click', (e) => {
      if (e.target instanceof Element && e.target.closest('input, button')) return;
      radio.click();
    });
    return li;
  }

  function render() {
    const active = state.servers.find((s) => s.id === state.active);
    on.checked = state.on;
    on.disabled = !state.servers.length;
    stateLine.textContent = !state.servers.length
      ? 'Add a server below first.'
      : !state.on
        ? 'Off: every site connects directly.'
        : !state.sites.length
          ? `On, through ${active?.name}, but no sites use it yet.`
          : `On: ${state.sites.length} site${state.sites.length === 1 ? '' : 's'} through ${active?.name}.`;
    // Not while a name is being typed: the list is redrawn when the change comes back anyway.
    serverList.replaceChildren(...state.servers.map(serverRow));
    $('proxy-servers-empty').hidden = state.servers.length > 0;
    siteList.replaceChildren(
      ...state.sites.map((host) => {
        const li = el('li');
        const remove = el('button', { type: 'button', className: 'btn ghost sm', textContent: 'Connect directly', title: `Stop using the proxy for ${host}` });
        remove.addEventListener('click', () => void change((s) => ({ ...s, sites: s.sites.filter((x) => x !== host) })));
        li.append(el('span', { textContent: host }), remove);
        return li;
      }),
    );
    $('proxy-empty').hidden = state.sites.length > 0;
    void checkControl();
  }

  on.addEventListener('change', () => void change((s) => ({ ...s, on: on.checked })));

  const address = $<HTMLInputElement>('proxy-address');
  const name = $<HTMLInputElement>('proxy-name');
  const user = $<HTMLInputElement>('proxy-user');
  const pass = $<HTMLInputElement>('proxy-pass');
  $('add-proxy-server').addEventListener('submit', (e) => {
    e.preventDefault();
    const parsed = parseServer(address.value, scheme.value as ProxyScheme);
    if ('error' in parsed) return showError(serverError, parsed.error);
    if (state.servers.length >= MAX_SERVERS) return showError(serverError, `${MAX_SERVERS} servers is the most that fit. Remove one first.`);
    // The boxes win over a sign-in pasted with the address.
    const username = user.value.trim() || parsed.username;
    const password = user.value.trim() ? pass.value : parsed.password;
    if (!username && pass.value) return showError(serverError, 'Add the user name the password goes with.');
    const server: ProxyServer = {
      ...parsed,
      id: newServerId(),
      name: name.value.trim() || parsed.host,
      ...(username ? { username, ...(password ? { password } : {}) } : { username: undefined, password: undefined }),
    };
    const problem = signInProblem(server);
    if (problem) return showError(serverError, problem);
    showError(serverError, null);
    // The first server is switched on: that's what adding it was for.
    void change((s) => ({ ...s, servers: [...s.servers, server], ...(s.servers.length ? {} : { active: server.id, on: true }) }), 'Server added');
    for (const input of [address, name, user, pass]) input.value = '';
  });

  const site = $<HTMLInputElement>('proxy-site');
  $('add-proxy-site').addEventListener('submit', (e) => {
    e.preventDefault();
    const host = siteKey(site.value);
    if (!host) return showError(siteError, 'Enter a site like missav.ws.');
    if (state.sites.includes(host)) return showError(siteError, `${host} already uses the proxy.`);
    if (state.sites.length >= MAX_PROXY_SITES) return showError(siteError, `${MAX_PROXY_SITES} sites is the most that fit. Remove one first.`);
    showError(siteError, null);
    void change((s) => ({ ...s, sites: [...s.sites, host] }));
    site.value = '';
  });

  // Changed from the popup while this page is open.
  onProxyChanged((next) => {
    if (JSON.stringify(next) === JSON.stringify(state)) return;
    state = next;
    if (!(document.activeElement instanceof HTMLInputElement && document.activeElement.closest('#proxy-servers'))) render();
  });
  render();
}
