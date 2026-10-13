// Applies the saved theme before first paint (loaded as a blocking script in <head> so it
// satisfies a strict script-src 'self' CSP). Keep in sync with src/lib/theme.ts.
(function () {
  try {
    var t = localStorage.getItem('solace.theme');
    if (t === 'light' || t === 'dark') {
      document.documentElement.setAttribute('data-theme', t);
      var scheme = document.querySelector('meta[name="color-scheme"]');
      if (scheme) scheme.setAttribute('content', t);
      var c = t === 'dark' ? '#131a2c' : '#f4f3f8';
      var metas = document.querySelectorAll('meta[name="theme-color"]');
      for (var i = 0; i < metas.length; i++) metas[i].setAttribute('content', c);
    }
  } catch {
    /* storage blocked: follow the OS */
  }
})();
