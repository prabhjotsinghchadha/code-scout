// Reading text and caret position from inputs, textareas and contenteditable editors.
import { codeNearCaret, parseCode, type VideoCode } from '../shared/codes';

export type Editable = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url']);
const MAX_TEXT = 5000;

export function editableFrom(target: EventTarget | null | undefined): Editable | null {
  if (target instanceof HTMLTextAreaElement) return target;
  if (target instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(target.type) ? target : null;
  if (target instanceof HTMLElement && target.isContentEditable) {
    // Use the editor root, not an inner paragraph, so the chip sits under the whole box.
    let root: HTMLElement = target;
    while (root.parentElement?.isContentEditable) root = root.parentElement;
    return root;
  }
  return null;
}

/** The focused element, looking inside open shadow roots. */
export function deepActiveElement(): Element | null {
  let el = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el;
}

export function readEditable(el: Editable): { text: string; caret: number; selected: string } {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    return { text: el.value, caret: start, selected: el.value.slice(start, end) };
  }
  const text = el.innerText.slice(0, MAX_TEXT);
  const selection = window.getSelection();
  let caret = text.length;
  if (selection?.rangeCount && el.contains(selection.anchorNode)) {
    // Caret offset = length of the text from the editor start to the caret.
    const range = document.createRange();
    range.selectNodeContents(el);
    range.setEnd(selection.anchorNode!, selection.anchorOffset);
    caret = range.toString().length;
  }
  return { text, caret, selected: selection?.toString() ?? '' };
}

export function codeInEditable(el: Editable): VideoCode | null {
  const { text, caret } = readEditable(el);
  return text.length <= MAX_TEXT ? codeNearCaret(text, caret) : null;
}

/** For keyboard shortcuts: selected text first, then the code being typed in the focused field. */
export function activeCode(): { code: VideoCode | null; text: string } {
  const el = editableFrom(deepActiveElement());
  if (el) {
    const { selected } = readEditable(el);
    if (selected.trim()) return { code: parseCode(selected), text: selected };
    const code = codeInEditable(el);
    if (code) return { code, text: '' };
  }
  const selected = window.getSelection()?.toString() ?? '';
  return { code: selected.trim() ? parseCode(selected) : null, text: selected };
}
