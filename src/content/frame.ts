// Frames inside a page, such as a player embedded from another site (jav.guru plays each of its video
// servers in one): video tools, and the pop-up blocker when it's on for the page's site. Both follow
// the page's site (what the popup and Settings show), not the frame's. The page itself is index.ts's.
import { isSiteOff } from '../shared/hosts';
import { sendToBackground } from '../shared/messages';
import { getSettings, onSettingsChanged, type Settings } from '../shared/storage';
import { applyPageAccent } from '../shared/theme';
import { disablePopupGuard, enablePopupGuard } from './popup-guard';
import { setPlayerKeys, setToolbarMessages, setVideoTools } from './video-auto';

/** The site of the page this frame is in, or the frame's own when Chrome doesn't say. */
function pageHost(): string {
  const origins = location.ancestorOrigins;
  try {
    return (origins?.length && new URL(origins[origins.length - 1]).hostname) || location.hostname;
  } catch {
    return location.hostname;
  }
}

if (window !== window.top && /^https?:$/.test(location.protocol)) {
  const page = pageHost();
  let pageScriptAsked = false;
  const apply = (settings: Settings) => {
    const offHere = (sites: string[]) => isSiteOff(page, sites) || isSiteOff(location.hostname, sites);
    const videoTools = settings.videoTools && !offHere(settings.videoOffSites);
    if (videoTools) applyPageAccent(settings.accent); // the toolbar's colour
    setVideoTools(videoTools);
    setPlayerKeys(videoTools && settings.playerKeys);
    setToolbarMessages(settings.toolbarMessages);
    if (isSiteOff(page, settings.popupBlockSites)) {
      enablePopupGuard();
      // The blocker's page-side script: registered for the page's own site only, so added here.
      if (!pageScriptAsked) {
        pageScriptAsked = true;
        void sendToBackground({ type: 'BLOCK_POPUPS_IN_FRAME' }).catch(() => {});
      }
    } else {
      disablePopupGuard();
    }
  };
  void getSettings().then((settings) => {
    apply(settings);
    onSettingsChanged(apply);
  });
}
