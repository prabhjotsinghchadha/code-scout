import { findCodes, formatCode, type VideoCode } from '../shared/codes';
import { isSiteOff } from '../shared/hosts';
import type { Message } from '../shared/messages';
import { getSettings, onSettingsChanged, type Settings } from '../shared/storage';
import { lastContextLink, watchContextLinks } from './context-link';
import { activeCode } from './editable';
import { disableFavouriteMarks, enableFavouriteMarks } from './favourite-marks';
import { startFavourites } from './favourites';
import { disableFieldChip, enableFieldChip } from './field-chip';
import { serveFrames } from './frame-bridge';
import { disableInline, enableInline } from './inline';
import { disablePopupGuard, enablePopupGuard } from './popup-guard';
import { setSeenMarks } from './seen';
import { setPlayerKeys, setVideoTools } from './video-auto';

function pageCodes(): VideoCode[] {
  const seen = new Map<string, VideoCode>();
  for (const { code } of findCodes(document.body.innerText)) seen.set(formatCode(code), code);
  return [...seen.values()];
}

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  if (message.type === 'GET_PAGE_CODES') sendResponse({ codes: pageCodes() });
  if (message.type === 'GET_ACTIVE_CODE') sendResponse(activeCode());
  if (message.type === 'GET_CONTEXT_LINK') sendResponse(lastContextLink());
  return false;
});
// Everywhere, javtrailers.com too: its actress links can be saved from the right-click menu.
watchContextLinks();
// "Save as" and translation for video players embedded from other sites (frame-bridge.ts).
serveFrames();

async function init() {
  // javtrailers.com has its own search and links; don't add our UI there.
  if (location.hostname.endsWith('javtrailers.com')) return;
  // Known before the ▶ buttons are drawn, so favourites show as ★ straight away.
  await startFavourites().catch(() => {});

  // Likewise the codes already seen, for their ✓.
  const initial = await getSettings();
  await setSeenMarks(initial.rememberSeen).catch(() => {});

  const state = { inlineButtons: false, fieldChip: false, seen: initial.rememberSeen };
  const apply = (settings: Settings) => {
    if (settings.rememberSeen !== state.seen) {
      state.seen = settings.rememberSeen;
      void setSeenMarks(settings.rememberSeen).catch(() => {});
    }
    // Turned off for this site: no ▶ buttons or chip (right-click and shortcuts still work).
    const off = isSiteOff(location.hostname, settings.offSites);
    const inlineButtons = settings.inlineButtons && !off;
    const fieldChip = settings.fieldChip && !off;
    if (inlineButtons !== state.inlineButtons) {
      (inlineButtons ? enableInline : disableInline)();
      // ♥ by favourite actresses' names and # on favourite tags' links come and go with the ▶ buttons.
      if (inlineButtons) void enableFavouriteMarks().catch(() => {});
      else disableFavouriteMarks();
    }
    if (fieldChip !== state.fieldChip) (fieldChip ? enableFieldChip : disableFieldChip)();
    state.inlineButtons = inlineButtons;
    state.fieldChip = fieldChip;
    if (isSiteOff(location.hostname, settings.popupBlockSites)) enablePopupGuard();
    else disablePopupGuard();
    // Video tools: on every site unless turned off (frames, e.g. embedded players: frame.ts).
    const videoTools = settings.videoTools && !isSiteOff(location.hostname, settings.videoOffSites);
    setVideoTools(videoTools);
    setPlayerKeys(videoTools && settings.playerKeys);
  };
  apply(initial);
  onSettingsChanged(apply);
}

void init();
