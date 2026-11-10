// Runs before an extension page is drawn (a plain script in <head>): puts the look picked in Settings on
// <html> from the copy the last page kept (shared/theme.ts), so the page doesn't open in the default look
// and then change. The page's own script confirms it from the settings.
(function () {
  try {
    var look = JSON.parse(localStorage.getItem('look') || 'null');
    if (!look) return;
    var root = document.documentElement;
    if (look.theme === 'light' || look.theme === 'dark') root.dataset.theme = look.theme;
    if (typeof look.accent === 'string' && /^[a-z]+$/.test(look.accent)) root.dataset.accent = look.accent;
  } catch (e) {
    // No copy, or storage is off: the default look until the settings are read.
  }
})();
