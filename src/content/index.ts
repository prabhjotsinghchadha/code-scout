import { findCodes, formatCode, type VideoCode } from '../shared/codes';
import { isSiteOff } from '../shared/hosts';
import type { Message } from '../shared/messages';
import { getSettings, onSettingsChanged, type Settings } from '../shared/storage';
import { activeCode } from './editable';
import { disableFieldChip, enableFieldChip } from './field-chip';
import { disableInline, enableInline } from './inline';

function pageCodes(): VideoCode[] {
  const seen = new Map<string, VideoCode>();
  for (const { code } of findCodes(document.body.innerText)) seen.set(formatCode(code), code);
  return [...seen.values()];
}

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  if (message.type === 'GET_PAGE_CODES') sendResponse({ codes: pageCodes() });
  if (message.type === 'GET_ACTIVE_CODE') sendResponse(activeCode());
  return false;
});

async function init() {
  // javtrailers.com has its own search and links; don't add our UI there.
  if (location.hostname.endsWith('javtrailers.com')) return;

  const state = { inlineButtons: false, fieldChip: false };
  const apply = (settings: Settings) => {
    // Turned off for this site: no ▶ buttons or chip (right-click and shortcuts still work).
    const off = isSiteOff(location.hostname, settings.offSites);
    const inlineButtons = settings.inlineButtons && !off;
    const fieldChip = settings.fieldChip && !off;
    if (inlineButtons !== state.inlineButtons) (inlineButtons ? enableInline : disableInline)();
    if (fieldChip !== state.fieldChip) (fieldChip ? enableFieldChip : disableFieldChip)();
    state.inlineButtons = inlineButtons;
    state.fieldChip = fieldChip;
  };
  apply(await getSettings());
  onSettingsChanged(apply);
}

void init();
