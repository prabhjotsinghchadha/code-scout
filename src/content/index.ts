import { findCodes, formatCode, type VideoCode } from '../shared/codes';
import { isSiteOff } from '../shared/hosts';
import type { Message } from '../shared/messages';
import { getSettings, onSettingsChanged, type Settings } from '../shared/storage';
import { lastContextLink, watchContextLinks } from './context-link';
import { activeCode } from './editable';
import { disableFavouriteMarks, enableFavouriteMarks } from './favourite-marks';
import { startFavourites } from './favourites';
import { disableFieldChip, enableFieldChip } from './field-chip';
import { disableInline, enableInline } from './inline';
import { disablePopupGuard, enablePopupGuard } from './popup-guard';

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

let stopWaitingForVideo: (() => void) | null = null;
let videoToolsLoaded = false;

/** Calls `found` once the page has a <video> (now, or when one is added). Returns a cancel function. */
function whenPageHasVideo(found: () => void): () => void {
  const videos = document.getElementsByTagName('video'); // live: checking it is cheap
  if (videos.length) {
    found();
    return () => {};
  }
  const observer = new MutationObserver(() => {
    if (!videos.length) return;
    observer.disconnect();
    found();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  return () => observer.disconnect();
}

async function init() {
  // javtrailers.com has its own search and links; don't add our UI there.
  if (location.hostname.endsWith('javtrailers.com')) return;
  // Known before the ▶ buttons are drawn, so favourites show as ★ straight away.
  await startFavourites().catch(() => {});

  const state = { inlineButtons: false, fieldChip: false, video: false };
  const apply = (settings: Settings) => {
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
    // Video tools: on every site unless turned off; their code (the downloader is large) loads only once
    // the page has a video.
    const video = settings.videoTools && !isSiteOff(location.hostname, settings.videoOffSites);
    if (video !== state.video) {
      state.video = video;
      stopWaitingForVideo?.();
      stopWaitingForVideo = null;
      const toggle = () => void import('./video-tools').then((m) => (state.video ? m.enableVideoTools() : m.disableVideoTools()));
      if (!video) {
        if (videoToolsLoaded) toggle();
      } else {
        stopWaitingForVideo = whenPageHasVideo(() => {
          stopWaitingForVideo = null;
          videoToolsLoaded = true;
          toggle();
        });
      }
    }
  };
  apply(await getSettings());
  onSettingsChanged(apply);
}

void init();
