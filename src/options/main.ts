import { getSettings, setSettings } from '../shared/storage';

const enabledEl = document.getElementById('enabled') as HTMLInputElement;
const status = document.getElementById('status') as HTMLParagraphElement;

async function init() {
  const settings = await getSettings();
  enabledEl.checked = settings.enabled;

  enabledEl.addEventListener('change', async () => {
    await setSettings({ enabled: enabledEl.checked });
    status.textContent = 'Saved.';
    setTimeout(() => (status.textContent = ''), 1200);
  });
}

void init();
