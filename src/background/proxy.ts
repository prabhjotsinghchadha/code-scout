// Proxy for chosen sites (shared/proxy.ts): hands Chrome the PAC script, and signs in to the server.
import { credentialsFor, getProxy, onProxyChanged, pacScript } from '../shared/proxy';

let applying = Promise.resolve();

/** Makes Chrome's proxy setting match what's stored: the PAC script, or no setting of ours at all. */
export function applyProxy(): Promise<void> {
  // One at a time, so the last change is the one that stands.
  applying = applying
    .then(async () => {
      const pac = pacScript(await getProxy());
      if (pac) {
        // mandatory: a script that fails to run must not fall back to direct connections.
        await chrome.proxy.settings.set({ value: { mode: 'pac_script', pacScript: { data: pac, mandatory: true } }, scope: 'regular' });
      } else {
        await chrome.proxy.settings.clear({ scope: 'regular' });
      }
    })
    .catch((err) => console.error('Setting the proxy failed', err));
  return applying;
}

onProxyChanged(() => void applyProxy());

/** Requests already answered once: a second challenge means the sign-in is wrong, so Chrome asks the user. */
const answered = new Map<string, number>();

chrome.webRequest.onAuthRequired.addListener(
  (details, callback) => {
    const answer = callback ?? (() => {});
    // A website's own sign-in box is none of ours.
    if (!details.isProxy || answered.has(details.requestId)) {
      answer({});
      return undefined;
    }
    void getProxy()
      .then((state) => {
        const authCredentials = credentialsFor(state, details.challenger);
        if (!authCredentials) return answer({});
        if (answered.size > 500) answered.clear();
        answered.set(details.requestId, Date.now());
        answer({ authCredentials });
      })
      .catch(() => answer({}));
    return undefined;
  },
  { urls: ['<all_urls>'] },
  ['asyncBlocking'],
);
