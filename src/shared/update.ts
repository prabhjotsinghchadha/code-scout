// "A newer version is out": Code Scout is shared as a zip on its GitHub releases page and loaded with
// "Load unpacked", which Chrome never updates by itself. So, at most once a day, the popup asks GitHub
// for the latest release and shows a line with a link when it is newer than the one installed.
// Nothing about the user is sent: it is one plain request for a public page.

/** The GitHub repository whose releases carry the zip, as "owner/name". Empty: never check. */
export const RELEASES_REPO: string = 'prabhjotsinghchadha/code-scout';

export const UPDATE_KEY = 'update';
/** How long an answer from GitHub is good for. */
export const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;

export interface Release {
  /** Without the tag's "v": 0.2.0 */
  version: string;
  /** Its page on GitHub, where the zip is. */
  url: string;
}

/** What is remembered between checks (chrome.storage.local). */
export interface UpdateState {
  checkedAt: number;
  latest: Release | null;
  /** The version whose notice the user closed: not shown again until a newer one is out. */
  dismissed?: string;
}

const numbers = (version: string): number[] | null => {
  const parts = version.trim().replace(/^v/i, '').split('.');
  if (!parts.length || parts.length > 4 || !parts.every((p) => /^\d{1,9}$/.test(p))) return null;
  return parts.map(Number);
};

/** Is `latest` a later version than `current`? Dotted numbers ("v" allowed); anything else is never newer. */
export function isNewer(latest: string, current: string): boolean {
  const a = numbers(latest);
  const b = numbers(current);
  if (!a || !b) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff) return diff > 0;
  }
  return false;
}

/** The release in GitHub's "latest release" answer, if it is a usable one from `repo`. */
export function parseRelease(json: unknown, repo: string): Release | null {
  if (!json || typeof json !== 'object') return null;
  const { tag_name: tag, html_url: url, draft, prerelease } = json as Record<string, unknown>;
  if (draft === true || prerelease === true) return null;
  if (typeof tag !== 'string' || typeof url !== 'string') return null;
  if (!numbers(tag)) return null;
  // Only ever link to the repository's own pages, whatever the answer says.
  if (!url.startsWith(`https://github.com/${repo}/releases/`)) return null;
  return { version: tag.trim().replace(/^v/i, ''), url };
}

/** The release to tell the user about: newer than what is installed, and not one they closed. */
export function noticeFor(state: UpdateState | undefined, current: string): Release | null {
  const latest = state?.latest;
  if (!latest || !isNewer(latest.version, current)) return null;
  return state.dismissed === latest.version ? null : latest;
}

async function stored(): Promise<UpdateState | undefined> {
  const got = await chrome.storage.local.get(UPDATE_KEY);
  return got[UPDATE_KEY] as UpdateState | undefined;
}

/**
 * The newer release to show, if any. Asks GitHub when the last answer is over a day old; offline, or
 * when GitHub says no, the last answer stands and the next try is a day away.
 */
export async function availableUpdate(now = Date.now()): Promise<Release | null> {
  if (!RELEASES_REPO) return null;
  const current = chrome.runtime.getManifest().version;
  let state = await stored();
  if (!state || now - state.checkedAt >= CHECK_EVERY_MS || now < state.checkedAt) {
    let latest = state?.latest ?? null;
    try {
      const response = await fetch(`https://api.github.com/repos/${RELEASES_REPO}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json' },
        credentials: 'omit',
        cache: 'no-store',
      });
      if (response.ok) latest = parseRelease(await response.json(), RELEASES_REPO);
    } catch {
      // Offline: keep what was known.
    }
    state = { checkedAt: now, latest, dismissed: state?.dismissed };
    await chrome.storage.local.set({ [UPDATE_KEY]: state });
  }
  return noticeFor(state, current);
}

/** The user closed the notice for this version. */
export async function dismissUpdate(version: string): Promise<void> {
  const state = await stored();
  if (state) await chrome.storage.local.set({ [UPDATE_KEY]: { ...state, dismissed: version } });
}
