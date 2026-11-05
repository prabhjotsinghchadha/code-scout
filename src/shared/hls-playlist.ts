// HLS (.m3u8) playlists: just enough parsing for parallel loading and downloads.

export interface Variant {
  url: string;
  bandwidth: number;
  width?: number;
  height?: number;
}

export interface MediaPlaylist {
  /** Absolute segment URLs, in play order. */
  segments: string[];
  /** Each segment's length in seconds (same order). */
  durations: number[];
  /** Segments are encrypted (#EXT-X-KEY with a method other than NONE). */
  encrypted: boolean;
  /** The list is complete (#EXT-X-ENDLIST): a video, not a live stream. */
  ended: boolean;
  /** Segments are byte ranges of a bigger file (#EXT-X-BYTERANGE). */
  byteRanges: boolean;
  /** fMP4 segments with an init section (#EXT-X-MAP) instead of MPEG-TS. */
  fmp4: boolean;
}

export function isPlaylist(text: string): boolean {
  return text.trimStart().startsWith('#EXTM3U');
}

/** A master playlist lists qualities (variants); a media playlist lists segments. */
export function isMasterPlaylist(text: string): boolean {
  return /^#EXT-X-STREAM-INF/m.test(text);
}

function resolve(uri: string, baseUrl: string): string {
  try {
    return new URL(uri, baseUrl).href;
  } catch {
    return uri;
  }
}

/** Attribute list of a tag line: `BANDWIDTH=800000,RESOLUTION=1280x720,CODECS="a,b"`. */
export function parseAttributes(list: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of list.matchAll(/([A-Z0-9-]+)=("[^"]*"|[^,]*)/g)) {
    attrs[m[1]] = m[2].replace(/^"|"$/g, '');
  }
  return attrs;
}

function lines(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

export function parseMasterPlaylist(text: string, baseUrl: string): Variant[] {
  const variants: Variant[] = [];
  let pending: Record<string, string> | null = null;
  for (const line of lines(text)) {
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      pending = parseAttributes(line.slice(line.indexOf(':') + 1));
    } else if (pending && !line.startsWith('#')) {
      const [w, h] = (pending.RESOLUTION ?? '').split('x').map(Number);
      variants.push({
        url: resolve(line, baseUrl),
        bandwidth: Number(pending.BANDWIDTH) || 0,
        ...(w && h ? { width: w, height: h } : {}),
      });
      pending = null;
    }
  }
  return variants;
}

export function parseMediaPlaylist(text: string, baseUrl: string): MediaPlaylist {
  const result: MediaPlaylist = {
    segments: [],
    durations: [],
    encrypted: false,
    ended: false,
    byteRanges: false,
    fmp4: false,
  };
  let duration = 0;
  for (const line of lines(text)) {
    if (line.startsWith('#EXTINF:')) {
      duration = parseFloat(line.slice(8)) || 0;
    } else if (line.startsWith('#EXT-X-KEY:')) {
      const method = parseAttributes(line.slice(11)).METHOD;
      if (method && method !== 'NONE') result.encrypted = true;
    } else if (line.startsWith('#EXT-X-ENDLIST')) {
      result.ended = true;
    } else if (line.startsWith('#EXT-X-BYTERANGE')) {
      result.byteRanges = true;
    } else if (line.startsWith('#EXT-X-MAP')) {
      result.fmp4 = true;
    } else if (!line.startsWith('#')) {
      result.segments.push(resolve(line, baseUrl));
      result.durations.push(duration);
      duration = 0;
    }
  }
  return result;
}

/** The variant to download: the one playing if known, otherwise the highest quality. */
export function pickVariant(variants: Variant[], playingUrl?: string): Variant | undefined {
  if (playingUrl) {
    const playing = variants.find((v) => v.url === playingUrl);
    if (playing) return playing;
  }
  return [...variants].sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || b.bandwidth - a.bandwidth)[0];
}

/** Why a media playlist can't be saved as one MP4 file, or null if it can. */
export function downloadProblem(playlist: MediaPlaylist): string | null {
  if (!playlist.segments.length) return 'The video has no segments.';
  if (!playlist.ended) return 'This is a live stream, not a video.';
  if (playlist.encrypted) return 'This video is encrypted.';
  if (playlist.byteRanges || playlist.fmp4) return 'This video uses a format the downloader doesn’t support yet.';
  return null;
}

/** The last part of a URL's path, e.g. "f7e5….m3u8": used to recognise the same video under a fresh link. */
export function fileName(url: string): string {
  try {
    return new URL(url).pathname.split('/').pop() ?? '';
  } catch {
    return '';
  }
}

/**
 * Links to the same playlist found in a page's HTML (same file name, new token): sites put a token that
 * expires in the link, and a fresh copy of the page has a fresh one.
 */
export function findPlaylistLinks(html: string, playlistUrl: string): string[] {
  const name = fileName(playlistUrl);
  if (!name) return [];
  const found = html.match(/https?:\\?\/\\?\/[^"'\s<>]+?\.m3u8[^"'\s<>]*/g) ?? [];
  return [...new Set(found.map((u) => u.replace(/\\\//g, '/')))].filter((u) => fileName(u) === name && u !== playlistUrl);
}
