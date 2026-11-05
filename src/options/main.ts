import type { OpenMode } from '../shared/codes';
import { getSettings, setSettings, type Settings } from '../shared/storage';

const status = document.getElementById('status') as HTMLParagraphElement;
const inlineButtons = document.getElementById('inlineButtons') as HTMLInputElement;
const openInBackground = document.getElementById('openInBackground') as HTMLInputElement;
const modeRadios = document.querySelectorAll<HTMLInputElement>('input[name="openMode"]');

let timer: number | undefined;
async function save(patch: Partial<Settings>) {
  await setSettings(patch);
  status.textContent = 'Saved.';
  clearTimeout(timer);
  timer = window.setTimeout(() => (status.textContent = ''), 1200);
}

async function init() {
  const settings = await getSettings();
  inlineButtons.checked = settings.inlineButtons;
  openInBackground.checked = settings.openInBackground;
  modeRadios.forEach((r) => (r.checked = r.value === settings.openMode));

  inlineButtons.addEventListener('change', () => save({ inlineButtons: inlineButtons.checked }));
  openInBackground.addEventListener('change', () => save({ openInBackground: openInBackground.checked }));
  modeRadios.forEach((r) =>
    r.addEventListener('change', () => r.checked && save({ openMode: r.value as OpenMode })),
  );
}

void init();
