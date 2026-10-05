/* KSF boot fallback.
   ---------------------------------------------------------------------------
   Shows a plain explanation if the application never mounts — opened straight
   from the file system, or the launcher still installing.

   This lives in its own file rather than inline in index.html so the server can
   send `Content-Security-Policy: script-src 'self'` with no inline exception.
   That one header is the difference between an injected <script> running and
   being refused by the browser. */
(function () {
  var root = document.getElementById('root');
  if (!root) return;

  function recover(title, message) {
    if (root.childElementCount) return;

    var main = document.createElement('main');
    main.className = 'boot-recovery';

    var card = document.createElement('section');

    var brand = document.createElement('strong');
    /* The product name, spelled out rather than imported: this file runs
       before any module loads, which is the whole point of it. */
    brand.textContent = 'KSF';
    card.appendChild(brand);

    var heading = document.createElement('h1');
    heading.textContent = title;
    card.appendChild(heading);

    var para = document.createElement('p');
    para.textContent = message;
    card.appendChild(para);

    var how = document.createElement('p');
    how.appendChild(document.createTextNode('How to open it correctly: extract the whole folder, then double-click '));
    var code = document.createElement('code');
    code.textContent = 'START_KSF.bat';
    how.appendChild(code);
    how.appendChild(document.createTextNode('.'));
    card.appendChild(how);

    main.appendChild(card);
    root.appendChild(main);
  }

  if (window.location.protocol === 'file:') {
    recover(
      'Please start KSF with the launcher',
      'KSF is a React and TypeScript application. Opening index.html directly cannot start its secure API, router or database.'
    );
  } else {
    window.setTimeout(function () {
      recover(
        'KSF is taking longer than usual to start',
        'The launcher may still be installing packages. Keep the launcher window open and reload this page once it says the workspace is ready.'
      );
    }, 20000);
  }
})();
