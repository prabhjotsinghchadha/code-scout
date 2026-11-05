// Offscreen document: reads text in subtitle strips with PaddleOCR (PP-OCRv6), on this computer, and
// translates lines when the page's content script has no Translator API of its own.
// The background creates this page when "EN subs" first needs it and closes it when idle; content
// scripts send work through the background (OCR_STRIP / TRANSLATE → { target: 'offscreen', … }).
//
// Model: the PP-OCRv6 tiny text detector with the small recogniser and its full dictionary, which reads
// Simplified and Traditional Chinese and Japanese (the tiny recogniser has no kana).
import './ort-env';
import { PaddleOcrService } from 'ppu-paddle-ocr/web';
import type { OcrResult, OffscreenMessage, TranslateResult } from '../shared/messages';
import type { OcrLine } from '../shared/subtitles';
import { createTranslators, translatorStatus, type TranslateFn } from '../shared/translator';

const MODEL = {
  detection: chrome.runtime.getURL('ocr/det.ort'),
  recognition: chrome.runtime.getURL('ocr/rec.ort'),
  charactersDictionary: chrome.runtime.getURL('ocr/dict.txt'),
};

let service: Promise<PaddleOcrService> | null = null;

function getService(): Promise<PaddleOcrService> {
  if (!service) {
    service = (async () => {
      const s = new PaddleOcrService({ model: MODEL, session: { executionProviders: ['wasm'] } });
      await s.initialize();
      return s;
    })();
    service.catch(() => (service = null)); // try again next time
  }
  return service;
}

/** OCR runs one strip at a time; a strip that arrives while another is read waits its turn. */
let queue: Promise<unknown> = Promise.resolve();

async function readStrip(image: string): Promise<OcrResult> {
  const svc = await getService();
  const bytes = await (await fetch(image)).arrayBuffer();
  const result = await svc.recognize(bytes, { flatten: true });
  const lines: OcrLine[] = result.results.map((r) => ({
    text: r.text,
    box: { x: r.box.x, y: r.box.y, width: r.box.width, height: r.box.height },
    score: r.confidence,
  }));
  return { lines };
}

let translate: Promise<TranslateFn> | null = null;

async function translateLine(text: string, from: 'zh' | 'ja'): Promise<TranslateResult> {
  if (!translate) {
    // No click here, so the models can't download from this page: they must be set up already
    // (Settings → Video tools → Set up English subtitles).
    const status = await translatorStatus();
    if (!status) return { error: 'English subtitles need Chrome 138 or newer (on-device translation).' };
    if (status.zh !== 'available' && status.ja !== 'available') {
      return { error: 'Set up English subtitles first: Settings → Video tools → Set up English subtitles.' };
    }
    translate = createTranslators();
    translate.catch(() => (translate = null));
  }
  return { text: await (await translate)(text, from) };
}

chrome.runtime.onMessage.addListener((message: OffscreenMessage, _sender, sendResponse) => {
  if (message?.target !== 'offscreen') return false;
  const fail = (err: unknown) => sendResponse({ error: err instanceof Error ? err.message : String(err) });
  if (message.type === 'TRANSLATE') {
    translateLine(message.text, message.from).then(sendResponse, fail);
    return true;
  }
  if (message.type !== 'OCR') return false;
  const run = queue.then(() => readStrip(message.image));
  queue = run.catch(() => {});
  run.then(sendResponse, fail);
  return true; // answer asynchronously
});
