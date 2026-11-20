/* Resolve the theme before the first paint.
   ---------------------------------------------------------------------------
   "Match my device" is resolved to a real data-theme value here, so the
   stylesheet declares the dark palette exactly once. The file is in <head>
   and runs synchronously, so the attribute — and the brand theme — are on
   <html> before the first paint: no white flash for a dark-mode user.

   It stays a separate file rather than an inline <script> so the server can
   keep sending Content-Security-Policy: script-src 'self' with no exception. */
(function () {
  var STORE = 'ksf-theme';
  var root = document.documentElement;

  function preference() {
    try {
      return localStorage.getItem(STORE) || 'system';
    } catch {
      /* Private mode, or storage disabled by policy. Follow the device. */
      return 'system';
    }
  }

  function systemIsDark() {
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  function apply(pref) {
    var resolved = pref === 'system' ? (systemIsDark() ? 'dark' : 'light') : pref;
    root.setAttribute('data-theme', resolved);
    root.setAttribute('data-theme-pref', pref);
    root.style.colorScheme = resolved;
  }

  apply(preference());

  /* The brand theme (one of five) the last session on this browser used, so
     the colours are right before the server has answered. */
  var BRANDS = ['ksf-green', 'ocean-blue', 'royal-purple', 'sunset-amber', 'graphite'];
  try {
    var brand = localStorage.getItem('ksf-brand');
    root.setAttribute('data-brand', BRANDS.indexOf(brand) >= 0 ? brand : 'ksf-green');
  } catch {
    root.setAttribute('data-brand', 'ksf-green');
  }

  /* Following the device means following it as it changes — a phone that
     switches to dark at sunset should take the workspace with it. */
  if (window.matchMedia) {
    var query = window.matchMedia('(prefers-color-scheme: dark)');
    var onChange = function () {
      if (root.getAttribute('data-theme-pref') === 'system') apply('system');
    };
    if (query.addEventListener) query.addEventListener('change', onChange);
    else if (query.addListener) query.addListener(onChange);
  }

  /* How much the pages move: data-motion on <html>.
       full — everything (the default);
       calm — a device that asks for less motion (Windows "Animation effects"
              off, macOS "Reduce motion"): fades, gentle floating and hover
              effects stay, the scroll-linked parallax and big slides go;
       off  — still: the visitor switched animations off (the switch at the
              foot of the website), or a setting asks for none.
     The choice made with the switch wins over the device. */
  var MOTION = 'ksf-motion';
  function motion() {
    var chosen;
    try { chosen = localStorage.getItem(MOTION); } catch { chosen = null; }
    if (chosen === 'off') return 'off';
    if (chosen === 'on') return 'full';
    var calm = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    return calm ? 'calm' : 'full';
  }
  root.setAttribute('data-motion', motion());
  if (window.matchMedia) {
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    var onMotion = function () { root.setAttribute('data-motion', motion()); };
    if (reduce.addEventListener) reduce.addEventListener('change', onMotion);
    else if (reduce.addListener) reduce.addListener(onMotion);
  }
})();
