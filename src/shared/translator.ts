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

/** How long to wait before trying again to set up a language that failed. */
const RETRY_LANG_MS = 60_000;

/**
 * Chrome's answer while it's still installing its translator. The first time in a Chrome profile,
 * create() starts a background install (a few minutes) and fails straight away with this instead of
 * waiting. It gives the same answer when more than 10 sites are using the translator at once.
 */
function notReadyYet(err: unknown): boolean {
  return err instanceof Error && /unable to create translator|service count/i.test(err.message);
}

/**
 * Sets up Chinese → English, then Japanese → English in the background. Call straight from a click: the
 * first translator needs it (the first time, Chrome downloads its models). One at a time on purpose:
 * Chrome uses the click up on the first, so a second started alongside it is refused, while once this
 * site has one translator, more can be set up without a click.
 */
export async function createTranslators(onStatus: (text: string) => void = () => {}): Promise<TranslateFn> {
  const api = translatorApi();
  if (!api) throw new Error('English subtitles need Chrome 138 or newer (on-device translation).');
  const create = (lang: SubtitleLang, report: boolean) =>
    api.create({
      sourceLanguage: lang,
      targetLanguage: 'en',
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => {
          if (report && e.loaded < 1) onStatus(`Getting ${LANG_NAME[lang]} → English… ${Math.round(e.loaded * 100)}%`);
        });
      },
    });

  let zh: TranslatorInstance;
  try {
    zh = await create('zh', true);
  } catch (err) {
    if (notReadyYet(err)) {
      throw new Error(
        'Chrome is still installing its on-device translator (the first time, this takes a few minutes). ' +
          'Click EN subs again in a minute or two. If this keeps happening, restart Chrome.',
      );
    }
    throw new Error(`Chrome couldn’t set up translation${err instanceof Error ? `: ${err.message}` : '.'}`);
  }

  const translators: Partial<Record<SubtitleLang, Promise<TranslatorInstance | null>>> = { zh: Promise.resolve(zh) };
  const get = (lang: SubtitleLang): Promise<TranslatorInstance | null> =>
    (translators[lang] ??= create(lang, false).catch(() => {
      setTimeout(() => delete translators[lang], RETRY_LANG_MS); // try again later
      return null;
    }));
  void get('ja'); // ready by the time a Japanese line shows up, usually
  return async (text, from) => {
    for (let attempt = 0; ; attempt++) {
      // A language that couldn't be set up: the other translator still gets the kanji roughly right.
      const lang: SubtitleLang = (await get(from)) ? from : from === 'zh' ? 'ja' : 'zh';
      const translator = await get(lang);
      if (!translator) throw new Error('Chrome’s translator stopped working. Turn EN subs off and on again.');
      try {
        return await translator.translate(text);
      } catch (err) {
        // Chrome restarts its translation service now and then (while it installs another language,
        // say), and translators made before that stop working ("Other generic failures occurred").
        // Once this site has a translator, a new one needs no click: make it and try again.
        if (attempt > 0 || !(err instanceof Error) || err.name !== 'UnknownError') throw err;
        translator.destroy?.();
        delete translators[lang];
      }
    }
  };
}
