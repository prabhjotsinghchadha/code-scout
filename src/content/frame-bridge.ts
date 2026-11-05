// Video tools in players embedded from another site (jav.guru's video servers, say). Chrome keeps two
// things from a frame of another site than the page's: the "Save as" dialog and its on-device
// translator. So the frame asks the tab's top page, through the background, to do them:
//  - Save as: the top page shows the dialog (a click in the frame also counts as a click on the page)
//    and writes what the frame sends it over a MessageChannel, so the frame still does the downloading.
//  - Translate: the top page sets up the translator and translates the frame's subtitle lines.
import { sendToBackground, type Message, type SaveAnswer, type TranslateResult } from '../shared/messages';
import { createTranslators, type SubtitleLang, type TranslateFn } from '../shared/translator';

/** In a frame from another site than the page's (where Chrome holds back some features). */
export function inForeignFrame(): boolean {
  if (window === window.top) return false;
  try {
    return !window.top!.location.href; // readable only from the same site
  } catch {
    return true;
  }
}

/** The address and title the tab shows: from a frame of another site, the top page's. */
export async function pageInfo(): Promise<{ url: string; title: string }> {
  const own = { url: location.href, title: document.title };
  if (!inForeignFrame()) return own;
  const tab = await sendToBackground({ type: 'TAB_PAGE' }).catch(() => null);
  return tab?.url ? tab : own;
}

/** Translation by the top page (see above). */
export const translateInPage: TranslateFn = async (text, from) => {
  const result = await sendToBackground({ type: 'TRANSLATE_IN_PAGE', text, from }).catch(() => null);
  if (!result) throw new Error('Reload the page to use EN subs here.');
  if ('error' in result) throw new Error(result.error);
  return result.text;
};

/** Where a download is written. `abort` throws the half-written file away. */
export interface SaveTarget {
  /** The file's name, as picked in the dialog. */
  name: string;
  write(chunk: unknown): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}

/** A file picked in this page's own "Save as" dialog. */
export async function fileTarget(handle: FileSystemFileHandle): Promise<SaveTarget> {
  const writer = await handle.createWritable();
  return {
    name: handle.name,
    write: (chunk) => writer.write(chunk as FileSystemWriteChunkType),
    close: () => writer.close(),
    abort: async () => {
      await writer.abort().catch(() => {});
      await (handle as FileSystemFileHandle & { remove?: () => Promise<void> }).remove?.().catch(() => {});
    },
  };
}

/** Write chunks: raw bytes, or the MP4 writer's { type: 'write', data, position }. */
type Chunk = Uint8Array | { type: 'write'; data: Uint8Array; position?: number };

/**
 * "Save as" shown by the top page, for a frame. Resolves to its answer: the file to write to, or
 * cancelled / an error.
 */
export async function saveInPage(suggestedName: string): Promise<SaveTarget | { cancelled: true } | { error: string }> {
  const answer = await sendToBackground({ type: 'SAVE_IN_PAGE', name: suggestedName }).catch(() => null);
  if (!answer) return { error: 'Reload the page, then try again.' };
  if (!('token' in answer)) return answer;
  const channel = new MessageChannel();
  window.top!.postMessage({ javtrSave: answer.token }, '*', [channel.port2]);
  const port = channel.port1;
  const waiting = new Map<number, { resolve: () => void; reject: (err: Error) => void }>();
  let nextId = 0;
  port.onmessage = (e: MessageEvent) => {
    const { id, error } = (e.data ?? {}) as { id?: number; error?: string };
    const call = id === undefined ? undefined : waiting.get(id);
    if (!call) return;
    waiting.delete(id!);
    if (error) call.reject(new Error(error));
    else call.resolve();
  };
  let ended = false;
  const call = (op: 'write' | 'close' | 'abort', data?: Uint8Array, position?: number) =>
    new Promise<void>((resolve, reject) => {
      if (ended) return reject(new Error('The file is already closed.'));
      const id = nextId++;
      waiting.set(id, { resolve, reject });
      port.postMessage({ id, op, data, position }, data ? [data.buffer] : []);
    });
  // Closing or discarding twice (the MP4 writer and the error handling both may) must not wait forever.
  const end = (op: 'close' | 'abort') => {
    if (ended) return Promise.resolve();
    const last = call(op);
    ended = true;
    return last.finally(() => port.close());
  };
  return {
    name: answer.name,
    write: (chunk) => {
      const { data, position } = chunk instanceof Uint8Array ? { data: chunk, position: undefined } : (chunk as Exclude<Chunk, Uint8Array>);
      return call('write', data.slice(), position); // a copy: its buffer moves to the page
    },
    close: () => end('close'),
    abort: () => end('abort'),
  };
}

// --- The top page's side ---

let translator: Promise<TranslateFn> | null = null;

async function translateHere(text: string, from: SubtitleLang): Promise<TranslateResult> {
  try {
    const setup = (translator ??= createTranslators());
    let translate: TranslateFn;
    try {
      translate = await setup;
    } catch (err) {
      if (translator === setup) translator = null; // the next click tries again
      throw err;
    }
    return { text: await translate(text, from) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** Files picked for frames, waiting for the frame's MessageChannel. */
const saves = new Map<string, { target: SaveTarget; timer: ReturnType<typeof setTimeout> }>();

async function openSave(token: string, name: string): Promise<SaveAnswer> {
  const picker = (window as Window & { showSaveFilePicker?: (o: object) => Promise<FileSystemFileHandle> }).showSaveFilePicker;
  if (!picker) return { error: 'This browser can’t save files from a page (needs Chrome 86 or newer).' };
  let handle: FileSystemFileHandle;
  try {
    handle = await picker({ suggestedName: name, types: [{ description: 'MP4 video', accept: { 'video/mp4': ['.mp4'] } }] });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return { cancelled: true };
    return { error: err instanceof Error ? err.message : String(err) };
  }
  const target = await fileTarget(handle);
  // The frame connects straight away; if it never does (it went away), drop the empty file.
  const timer = setTimeout(() => {
    saves.delete(token);
    void target.abort();
  }, 30_000);
  saves.set(token, { target, timer });
  return { name: target.name, token };
}

function onFrameMessage(e: MessageEvent) {
  const token = (e.data as { javtrSave?: unknown } | null)?.javtrSave;
  if (typeof token !== 'string') return;
  const save = saves.get(token);
  const port = e.ports[0];
  if (!save || !port) return;
  saves.delete(token);
  clearTimeout(save.timer);
  const { target } = save;
  let queue = Promise.resolve();
  port.onmessage = (m: MessageEvent) => {
    const { id, op, data, position } = (m.data ?? {}) as { id: number; op: string; data?: Uint8Array; position?: number };
    queue = queue.then(async () => {
      try {
        if (op === 'write' && data) await target.write(position === undefined ? data : { type: 'write', data, position });
        else if (op === 'close') await target.close();
        else if (op === 'abort') await target.abort();
        port.postMessage({ id });
      } catch (err) {
        port.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
      }
    });
  };
}

/** In the top page: do what this page's frames from other sites can't (see above). */
export function serveFrames() {
  chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
    if (message.type === 'PAGE_TRANSLATE') {
      void translateHere(message.text, message.from).then(sendResponse);
      return true;
    }
    if (message.type === 'PAGE_SAVE') {
      void openSave(message.token, message.name).then(sendResponse);
      return true;
    }
    return false;
  });
  window.addEventListener('message', onFrameMessage);
}
