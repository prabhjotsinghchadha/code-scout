// Keeps an extension page (popup, Settings) in the look picked in Settings → Appearance: now, and when it
// changes while the page is open. public/theme-boot.js has already put the last look on before the first paint.
import { getSettings, onSettingsChanged } from './storage.ts';
import { applyTheme } from './theme.ts';

export function followLook() {
  void getSettings().then((settings) => applyTheme(settings));
  onSettingsChanged((settings) => applyTheme(settings));
}
