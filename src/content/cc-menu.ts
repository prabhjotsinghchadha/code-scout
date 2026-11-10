// Video tools: the CC menu, for subtitle files. They're looked up on SubtitleCat by the video's code (from
// the page's address or title, which can be corrected in the menu), or loaded from this computer (one
// downloaded from javsub.ai, say), and shown over the video by subtitle-file.ts:
//   Subtitles for [NSFS-484]
//   ✓ NSFS-484-javgg.net            English · 33 downloads · 👍
//     NSFS-484-javgg.net-ja         Japanese, translated here · 19 downloads
//   Load a file from this computer…
//   Find on javsub.ai ↗
//   Timing  ◀ Earlier  +0.5 s  Later ▶     (while on)
//   Turn subtitles off                     (while on)
// The file picked for a code and its timing are remembered on this computer (cc:NSFS-484), so the
// next time it's picked it comes back in time.
import { codeInUrl, formatCode, parseCode, type VideoCode } from '../shared/codes';
import { sendToBackground, type SubtitleChoice } from '../shared/messages';
import { decodeSubtitleFile, offsetText, parseSubtitles, type Cue } from '../shared/srt';
import type { TranslateFn } from '../shared/translator';
import { pageInfo } from './frame-bridge';
import { prepareTranslation, type StatusKind } from './subs';
import { SubtitleFile } from './subtitle-file';
import { button, onActivate, onUi } from './ui-events';

/** How much Earlier / Later moves the subtitles. */
const STEP_SEC = 0.5;
const RELOAD = 'Reload the page, then try again.';

/** The code of the video a page is about: from its address, else its title. In an embedded player, the page's around it. */
export async function pageCode(): Promise<{ code: VideoCode | null; title: string }> {
  const page = await pageInfo();
  let path = '';
  try {
    path = decodeURIComponent(new URL(page.url).pathname);
  } catch {
    // Not a valid address or encoding: the title still has the code, usually.
  }
  const code = codeInUrl(page.url) ?? parseCode(path) ?? parseCode(page.title) ?? parseCode(document.title);
  return { code, title: page.title };
}

interface Remembered {
  /** The file: a SubtitleCat address, or "file:<name>" for one loaded from this computer. */
  url: string;
  offset: number;
}

const rememberKey = (code: VideoCode) => `cc:${formatCode(code)}`;

async function remembered(code: VideoCode | null): Promise<Remembered | null> {
  if (!code) return null;
  try {
    const key = rememberKey(code);
    return ((await chrome.storage.local.get(key))[key] as Remembered | undefined) ?? null;
  } catch {
    return null; // the extension was updated: this page's script is cut off from it
  }
}

function remember(code: VideoCode | null, value: Remembered) {
  if (code) void chrome.storage.local.set({ [rememberKey(code)]: value }).catch(() => {});
}

function span(className: string, text: string): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = className;
  s.textContent = text;
  return s;
}

const LANG_NAME = { ja: 'Japanese', zh: 'Chinese' };

export class CcMenu {
  /** The subtitles on screen, if any. */
  file: SubtitleFile | null = null;
  private readonly video: HTMLVideoElement;
  private readonly layer: HTMLElement;
  private readonly menu: HTMLElement;
  /** The toolbar's own line at the top of the menu (EN subs). */
  private readonly first: HTMLElement;
  private readonly say: (text: string, kind?: StatusKind) => void;
  private readonly onChange: (on: boolean) => void;
  /** What's on: its address (or file:<name>) and name. */
  private current: { url: string; title: string } | null = null;
  /** The code the menu is for: the page's, or one typed into the menu. */
  private code: VideoCode | null = null;
  private codeChecked = false;
  /** Bumped by each menu opening and each load, so late answers to earlier ones are ignored. */
  private openToken = 0;
  private loadToken = 0;

  /**
   * `first`: the line the menu starts with (the toolbar's EN subs switch). `onChange`: a subtitle file went
   * on or off (the toolbar lights its button, and turns EN subs off).
   */
  constructor(
    video: HTMLVideoElement,
    layer: HTMLElement,
    menu: HTMLElement,
    first: HTMLElement,
    say: (text: string, kind?: StatusKind) => void,
    onChange: (on: boolean) => void,
  ) {
    this.video = video;
    this.layer = layer;
    this.menu = menu;
    this.first = first;
    this.say = say;
    this.onChange = onChange;
  }

  open() {
    const token = ++this.openToken;
    const input = document.createElement('input');
    input.className = 'javtr-menu-code';
    input.placeholder = 'Code';
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.title = 'The video’s code. Type another and press Enter to look it up.';
    // The click shield cancels the mousedown that would put the caret in the box.
    onUi(input, 'mousedown', () => input.focus());
    const list = document.createElement('div');
    list.className = 'javtr-menu-list';
    onUi(input, 'keydown', ({ key }) => {
      if (key !== 'Enter') return;
      const code = parseCode(input.value);
      if (!code) {
        list.replaceChildren(span('javtr-menu-note', 'Type a code like NSFS-484, then press Enter.'));
        return;
      }
      this.code = code;
      void this.search(token, input, list);
    });
    const head = document.createElement('div');
    head.className = 'javtr-menu-head';
    head.append(span('', 'Subtitle files for'), input);

    const fileBtn = button('javtr-menu-item', 'Load a file from this computer…', 'An .srt, .vtt or .ass file (one you downloaded from javsub.ai, say)');
    onActivate(fileBtn, () => this.pickFile());
    const javsub = button('javtr-menu-item', 'Find on javsub.ai ↗', 'Opens javsub.ai in a new tab. Download the .srt there, then load it here.');
    onActivate(javsub, () => {
      const url = this.code ? `https://javsub.ai/search/?q=${encodeURIComponent(formatCode(this.code))}` : 'https://javsub.ai/free/?lang=english';
      void sendToBackground({ type: 'OPEN_URLS', urls: [url] }).catch(() => this.say(RELOAD, 'error'));
      this.close();
    });

    this.menu.classList.add('javtr-cc-menu');
    this.menu.style.maxHeight = `${Math.max(180, this.video.getBoundingClientRect().height - 70)}px`;
    this.menu.replaceChildren(this.first, head, list, fileBtn, javsub, ...this.controls());
    this.menu.hidden = false;

    void (async () => {
      if (!this.codeChecked) {
        this.codeChecked = true;
        this.code = (await pageCode()).code;
      }
      if (token !== this.openToken) return;
      if (this.code) return this.search(token, input, list);
      list.replaceChildren(span('javtr-menu-note', 'No video code found on this page. Type it above and press Enter.'));
    })();
  }

  close() {
    this.openToken++;
    this.menu.hidden = true;
  }

  turnOff() {
    this.loadToken++;
    if (!this.file) return;
    this.file.stop();
    this.file = null;
    this.current = null;
    this.onChange(false);
  }

  private async search(token: number, input: HTMLInputElement, list: HTMLElement) {
    const code = this.code!;
    input.value = formatCode(code);
    list.replaceChildren(span('javtr-menu-note', 'Looking on SubtitleCat…'));
    const [result, last] = await Promise.all([
      sendToBackground({ type: 'FIND_SUBTITLES', code }).catch(() => ({ error: RELOAD })),
      remembered(code),
    ]);
    if (token !== this.openToken) return;
    if ('error' in result) {
      list.replaceChildren(span('javtr-menu-note', result.error));
      return;
    }
    if (!result.choices.length) {
      list.replaceChildren(span('javtr-menu-note', `SubtitleCat has no subtitles for ${formatCode(code)}. Try javsub.ai, below.`));
      return;
    }
    list.replaceChildren(...result.choices.map((choice) => this.choiceItem(choice, last)));
  }

  private choiceItem(choice: SubtitleChoice, last: Remembered | null): HTMLButtonElement {
    const on = this.current?.url === choice.fileUrl;
    const wasLast = !on && last?.url === choice.fileUrl;
    const b = button('javtr-menu-item javtr-menu-choice', '', `${choice.title}\nfrom SubtitleCat`);
    const detail = [
      choice.english ? 'English' : `${choice.from || 'Original'}, translated here`,
      `${choice.downloads} download${choice.downloads === 1 ? '' : 's'}`,
      choice.good ? '👍' : '',
      wasLast ? `last used${last.offset ? `, ${offsetText(last.offset)}` : ''}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    b.append(span('javtr-menu-name', `${on ? '✓ ' : ''}${choice.title}`), span('javtr-menu-detail', detail));
    onActivate(b, () => void this.loadChoice(choice, last?.url === choice.fileUrl ? last.offset : 0));
    return b;
  }

  private async loadChoice(choice: SubtitleChoice, offset: number) {
    const token = ++this.loadToken;
    const code = this.code;
    this.close();
    // Chrome's first translator setup needs this click: start it now for a file that isn't in English.
    const translation = choice.english ? null : prepareTranslation((text) => this.say(text, 'wait'));
    translation?.catch(() => {}); // reported once the file is in
    this.say(`Loading ${choice.title}…`, 'wait');
    const result = await sendToBackground({ type: 'GET_SUBTITLE_FILE', url: choice.fileUrl }).catch(() => ({ error: RELOAD }));
    if (token !== this.loadToken) return;
    if ('error' in result) {
      this.say(`Couldn’t load the subtitles: ${result.error}`, 'error');
      return;
    }
    await this.show(token, code, parseSubtitles(result.text), { url: choice.fileUrl, title: choice.title }, translation, offset);
  }

  private pickFile() {
    const code = this.code;
    this.close();
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.srt,.vtt,.ass,.ssa,.txt';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;
      const token = ++this.loadToken;
      void (async () => {
        const [bytes, last] = await Promise.all([file.arrayBuffer(), remembered(code)]);
        if (token !== this.loadToken) return;
        const url = `file:${file.name}`;
        await this.show(token, code, parseSubtitles(decodeSubtitleFile(new Uint8Array(bytes))), { url, title: file.name }, null, last?.url === url ? last.offset : 0);
      })();
    });
    input.click(); // still in the menu click, so the file chooser may open
  }

  private async show(
    token: number,
    code: VideoCode | null,
    cues: Cue[],
    source: { url: string; title: string },
    translation: Promise<TranslateFn> | null,
    offset: number,
  ) {
    if (token !== this.loadToken) return;
    if (!cues.length) {
      this.say(`${source.title} has no subtitle lines in it (it should be an .srt, .vtt or .ass file).`, 'error');
      return;
    }
    this.file?.stop();
    const file = new SubtitleFile(this.video, this.layer, cues, this.say);
    file.offset = offset;
    this.file = file;
    this.current = source;
    this.onChange(true);
    remember(code, { url: source.url, offset });
    const on = `Subtitles on: ${source.title}${offset ? `, ${offsetText(offset)} as last time` : ''}.`;
    const tip = 'Out of time? CC ▾ → Earlier / Later.';
    if (file.lang === 'other') {
      this.say(`${on} ${tip}`);
      return;
    }
    // Japanese or Chinese: its lines show as they are until Chrome's translator is ready (the first
    // time, Chrome downloads it), then in English.
    const from = LANG_NAME[file.lang];
    this.say(`${on} Setting up translation from ${from}…`, 'wait');
    try {
      const translate = await (translation ?? prepareTranslation((text) => this.say(text, 'wait')));
      if (this.file !== file) return;
      file.setTranslate(translate);
      this.say(`${on} Translating from ${from} as it plays. ${tip}`);
    } catch (err) {
      if (this.file !== file) return;
      this.say(`Showing the ${from} lines as they are: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }

  /** Timing and off, while subtitles are on. */
  private controls(): HTMLElement[] {
    const file = this.file;
    if (!file) return [];
    const row = document.createElement('div');
    row.className = 'javtr-menu-row';
    const value = span('javtr-menu-offset', offsetText(file.offset));
    const step = (delta: number) => {
      file.offset = Math.round((file.offset + delta) * 10) / 10;
      value.textContent = offsetText(file.offset);
      if (this.current) remember(this.code, { url: this.current.url, offset: file.offset });
    };
    const earlier = button('javtr-menu-step', '◀ Earlier', `Show the subtitles ${STEP_SEC} s earlier`);
    const later = button('javtr-menu-step', 'Later ▶', `Show the subtitles ${STEP_SEC} s later`);
    onActivate(earlier, () => step(-STEP_SEC));
    onActivate(later, () => step(STEP_SEC));
    row.append(span('javtr-menu-label', 'Timing'), earlier, value, later);
    const off = button('javtr-menu-item', 'Turn subtitles off', '');
    onActivate(off, () => {
      this.turnOff();
      this.close();
      this.say('Subtitles off.');
    });
    return [row, off];
  }
}
