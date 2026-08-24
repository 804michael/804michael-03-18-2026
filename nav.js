/* ============================================================
   SHARED SITE NAVIGATION — nav.js
   Loaded on every page via: <script src="nav.js" defer></script>
   Requires a <div id="site-nav"></div> placeholder right after <body>,
   and nav.css linked in <head>.

   This one file drives hamburger open/close, nav-shrink-on-scroll,
   the Connect dropdown, and active-link highlighting on every page
   that includes it — edit behavior here once, it applies everywhere.
   Edit nav-partial.html to change links/structure; edit nav.css to
   change appearance.
   ============================================================ */

(function () {
  const placeholder = document.getElementById('site-nav');
  if (!placeholder) {
    console.warn('nav.js: no <div id="site-nav"></div> placeholder found on this page — nav will not load.');
    return;
  }

  fetch('nav-partial.html')
    .then(res => {
      if (!res.ok) throw new Error('nav-partial.html fetch failed: ' + res.status);
      return res.text();
    })
    .then(html => {
      placeholder.outerHTML = html;
      initNav();
    })
    .catch(err => {
      console.error('nav.js: failed to load shared navigation.', err);
    });

  function initNav() {
    const nav = document.getElementById('nav');
    const mob = document.getElementById('mob-menu');
    const bd = document.getElementById('backdrop');
    const h1 = document.getElementById('h1');
    const h2 = document.getElementById('h2');
    const h3 = document.getElementById('h3');
    const hamBtn = document.getElementById('ham-btn');
    const mobClose = document.getElementById('mob-close');
    const connectBtn = document.getElementById('connect-btn');
    const connectDd = document.getElementById('connect-dd');

    // Nav shrink on scroll
    window.addEventListener('scroll', () => {
      nav.classList.toggle('scrolled', window.scrollY > 40);
    });

    // Hamburger open/close
    function openMob() {
      mob.classList.add('open');
      bd.classList.add('open');
      h1.style.transform = 'translateY(7px) rotate(45deg)';
      h2.style.opacity = '0';
      h3.style.transform = 'translateY(-7px) rotate(-45deg)';
      document.body.style.overflow = 'hidden';
    }
    window.closeMob = function closeMob() {
      mob.classList.remove('open');
      bd.classList.remove('open');
      h1.style.transform = '';
      h2.style.opacity = '';
      h3.style.transform = '';
      document.body.style.overflow = '';
    };
    hamBtn.addEventListener('click', openMob);
    mobClose.addEventListener('click', window.closeMob);

    // Connect dropdown toggle (click, not just hover — needed for touch)
    connectBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      const open = connectDd.classList.toggle('open');
      connectBtn.setAttribute('aria-expanded', open);
    });
    document.addEventListener('click', function () {
      connectDd.classList.remove('open');
      connectBtn.setAttribute('aria-expanded', 'false');
    });
    connectDd.addEventListener('click', function (e) { e.stopPropagation(); });

    // Active-link highlighting — matches the current page's filename
    // against every nav link's href, works regardless of which page loaded this partial.
    // Links with a "#" fragment (e.g. index.html#guides) are same-page scroll shortcuts,
    // not a distinct destination page, so they're excluded — otherwise "Area Guides"
    // would show as permanently active on every visit to the homepage, fighting with
    // the intended hover-only highlight inside the dropdown.
    const currentFile = (location.pathname.split('/').pop() || 'index.html');
    document.querySelectorAll('.nav-links a, .nav-dropdown a, .mob-links a').forEach(a => {
      const rawHref = a.getAttribute('href');
      if (rawHref.includes('#')) return;
      const hrefFile = rawHref.split('/').pop();
      if (hrefFile && hrefFile === currentFile) {
        a.classList.add('active');
      }
    });
  }
})();
