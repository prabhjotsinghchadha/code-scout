// SubtitleCat (subtitlecat.com): a free library of subtitle files, many of them for JAV codes, each in
// its original language plus machine translations. Reading its search and subtitle pages (plain HTML, no
// DOM in the background's service worker, so by pattern). The background fetches; see FIND_SUBTITLES.
import { formatCode, type VideoCode } from './codes.ts';

export const SUBTITLECAT = 'https://www.subtitlecat.com';

/** https://www.subtitlecat.com/index.php?search=NSFS-484 */
export function subtitleCatSearchUrl(code: VideoCode): string {
  return `${SUBTITLECAT}/index.php?search=${encodeURIComponent(formatCode(code))}`;
}

/** Whether a file's name is for `code`: "NSFS-484-javgg.net", "[nsfs00484] …", "SSIS_001 eng". */
export function titleHasCode(title: string, { prefix, number }: VideoCode): boolean {
  const label = prefix.replace(/^\d+/, ''); // "300MIUM-123" is often filed as "MIUM-123"
  return new RegExp(`(?<![a-z])(?:\\d*)${label}[-_ ]?0*${number}(?!\\d)`, 'i').test(title);
}

export interface FoundSubtitle {
  /** The file's name on SubtitleCat ("NSFS-484-javgg.net"). */
  title: string;
  /** Its page, which links the file in each language. */
  pageUrl: string;
  /** Language it was written in ("Japanese", "Chinese", "English"…), when the site says. */
  from: string;
  /** Rated good by SubtitleCat's users. */
  good: boolean;
  downloads: number;
  bytes: number;
}

/** Files under this size are a line or two (an ad, a title), not subtitles for a video. */
const MIN_BYTES = 1500;

const UNIT: Record<string, number> = { B: 1, KB: 1e3, MB: 1e6 };

function decodeHtml(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/**
 * The files a SubtitleCat search lists for `code` (its HTML), best first: rated good, then most
 * downloaded. Files for other codes the search also turns up, and near-empty ones, are left out.
 */
export function parseSubtitleCatSearch(html: string, code: VideoCode): FoundSubtitle[] {
  const found: FoundSubtitle[] = [];
  for (const row of html.split(/<tr\b/i).slice(1)) {
    const link = row.match(/<a href="(subs\/[^"]+)">([^<]*)<\/a>\s*(?:\(translated from ([^)]*)\))?/);
    if (!link) continue;
    const title = decodeHtml(link[2]).trim();
    if (!titleHasCode(title, code) && !titleHasCode(decodeURIComponent(link[1]), code)) continue;
    const size = row.match(/metric-value">\s*([\d.,]+)\s*(B|KB|MB)\s*</i);
    const bytes = size ? Number(size[1].replace(/,/g, '')) * (UNIT[size[2].toUpperCase()] ?? 1) : 0;
    if (size && bytes < MIN_BYTES) continue;
    const downloads = row.match(/metric-value">\s*([\d,]+)\s*<span class="sub-table__metric-unit">\s*downloads/i);
    found.push({
      title,
      pageUrl: new URL(decodeHtml(link[1]), `${SUBTITLECAT}/`).href,
      from: link[3]?.trim() ?? '',
      good: /Rated good/i.test(row),
      downloads: downloads ? Number(downloads[1].replace(/,/g, '')) : 0,
      bytes,
    });
  }
  return found.sort((a, b) => Number(b.good) - Number(a.good) || b.downloads - a.downloads);
}

export interface SubtitleFiles {
  /** The English file, when someone has had it translated already. */
  english?: string;
  /** The file as it was uploaded (in the language `from`). */
  original?: string;
  chinese?: string;
  japanese?: string;
}

/** Links to a subtitle's files, from its SubtitleCat page (HTML). */
export function parseSubtitleCatPage(html: string, pageUrl: string): SubtitleFiles {
  const download = (lang: string) => {
    const m = html.match(new RegExp(`<a id="download_${lang}"[^>]*?\\bhref="([^"]+)"`));
    return m ? new URL(decodeHtml(m[1]), pageUrl).href : undefined;
  };
  // Languages not translated yet have a button that names the original file and its folder:
  // translate_from_server_folder('af', 'NSFS-484-javgg.net-orig.srt', '/subs/1534/')
  const orig = html.match(/translate_from_server_folder\('[^']*',\s*'((?:[^'\\]|\\.)*)',\s*'([^']*)'\)/);
  const original = orig ? new URL(decodeHtml(orig[2]) + decodeHtml(orig[1]).replace(/\\(.)/g, '$1'), pageUrl).href : undefined;
  return { english: download('en'), original, chinese: download('zh-CN'), japanese: download('ja') };
}

/** Languages the extension can show: English as it is, Japanese and Chinese through Chrome's translator. */
const USABLE_ORIGINAL = /^(english|japanese|chinese)/i;

/**
 * The file to show for a subtitle, in order: English, else the original when it's in Japanese or Chinese
 * (translated on this computer), else a Chinese or Japanese translation of it.
 */
export function bestFile(files: SubtitleFiles, from: string): string | undefined {
  return files.english ?? (USABLE_ORIGINAL.test(from) ? files.original : undefined) ?? files.chinese ?? files.japanese;
}
