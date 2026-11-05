// Chrome's on-device Translator API (Chrome 138+): Chinese/Japanese → English, on this computer.
// The language models download once (a few tens of MB each); that first download needs a click.
// Used by the content script (EN subs), and by the offscreen document and Settings as a fallback.

export type SubtitleLang = 'zh' | 'ja';

interface TranslatorInstance {
  translate(text: string): Promise<string>;
  destroy?(): void;
}

interface DownloadMonitor {
  addEventListener(type: 'downloadprogress', listener: (e: Event & { loaded: number }) => void): void;
}

interface TranslatorStatic {
  availability(options: { sourceLanguage: string; targetLanguage: string }): Promise<string>;
  create(options: {
    sourceLanguage: string;
    targetLanguage: string;
    monitor?: (m: DownloadMonitor) => void;
  }): Promise<TranslatorInstance>;
}

export const LANGS: SubtitleLang[] = ['zh', 'ja'];
const LANG_NAME: Record<SubtitleLang, string> = { zh: 'Chinese', ja: 'Japanese' };

export function translatorApi(): TranslatorStatic | null {
  return (globalThis as { Translator?: TranslatorStatic }).Translator ?? null;
}

/** Whether both languages are ready to use without a download ("available"), per language. */
export async function translatorStatus(): Promise<Record<SubtitleLang, string> | null> {
  const api = translatorApi();
  if (!api) return null;
  const entries = await Promise.all(
    LANGS.map(async (lang) => [lang, await api.availability({ sourceLanguage: lang, targetLanguage: 'en' }).catch(() => 'unavailable')]),
  );
  return Object.fromEntries(entries) as Record<SubtitleLang, string>;
}

export type TranslateFn = (text: string, from: SubtitleLang) => Promise<string>;

/**
 * Creates the Chinese and Japanese translators. Call straight from a click (the first time, Chrome
 * downloads the models, which needs one). Throws when neither language can be set up.
 */
export async function createTranslators(onStatus: (text: string) => void = () => {}): Promise<TranslateFn> {
  const api = translatorApi();
  if (!api) throw new Error('English subtitles need Chrome 138 or newer (on-device translation).');
  const progress: Record<SubtitleLang, number> = { zh: 0, ja: 0 };
  const create = (lang: SubtitleLang) =>
    api.create({
      sourceLanguage: lang,
      targetLanguage: 'en',
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => {
          progress[lang] = e.loaded;
          if (e.loaded < 1) onStatus(`Getting ${LANG_NAME[lang]} → English… ${Math.round(e.loaded * 100)}%`);
        });
      },
    });
  // Both started at once, while the click still counts.
  const [zh, ja] = await Promise.allSettled([create('zh'), create('ja')]);
  const translators: Partial<Record<SubtitleLang, TranslatorInstance>> = {};
  if (zh.status === 'fulfilled') translators.zh = zh.value;
  if (ja.status === 'fulfilled') translators.ja = ja.value;
  if (!translators.zh && !translators.ja) {
    const reason = zh.status === 'rejected' ? zh.reason : null;
    throw new Error(`Chrome couldn’t set up translation${reason instanceof Error ? `: ${reason.message}` : '.'}`);
  }
  return async (text, from) => {
    const translator = translators[from] ?? translators[from === 'zh' ? 'ja' : 'zh']!;
    return translator.translate(text);
  };
}
