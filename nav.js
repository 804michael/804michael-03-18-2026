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
      // Let pages know the shared nav/banner markup now exists in the DOM —
      // useful for any page that measures banner/nav height (e.g. map-search.html
      // sizing the map area around the fixed chrome above it).
      window.dispatchEvent(new CustomEvent('navReady'));
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
    const banner = document.getElementById('banner');

    // Keep --banner-h synced to the banner's ACTUAL rendered height, always.
    // The banner's promo text wraps to a different number of lines depending
    // on viewport width (and font size), so no single hardcoded pixel value
    // in nav.css/a page's <style> block can stay correct at every width —
    // that's what kept causing #nav to sit behind the banner (or extra gap
    // below it) every time the banner text or font size changed. This makes
    // it self-correcting instead of something that has to be hand-tuned
    // across every page again on the next banner change.
    //
    // IMPORTANT: #banner itself is sized with `min-height:var(--banner-h)`
    // (see nav.css), so measuring banner.getBoundingClientRect().height
    // directly is circular — it can just be reading back whatever the CSS
    // fallback forced it to, not the text's real height, and then locks
    // that (possibly wrong) number in permanently. That's what caused the
    // banner to render taller on some pages than others even with identical
    // promo text: pages without a page-local --banner-h override inherited
    // nav.css's mobile fallback (70px), which is bigger than the true
    // 2-line content height (~39px), so the container's min-height won and
    // this function just kept re-measuring — and re-confirming — that
    // inflated 70px. Measuring the inner <p> instead sidesteps this: the
    // banner's min-height never constrains its child's natural height, so
    // this always reflects the text's real wrapped height regardless of
    // whatever --banner-h currently is.
    let bannerSyncRaf = null;
    function syncBannerHeight() {
      if (!banner) return;
      const textEl = banner.querySelector('p') || banner;
      const bcs = getComputedStyle(banner);
      const padTop = parseFloat(bcs.paddingTop) || 0;
      const padBottom = parseFloat(bcs.paddingBottom) || 0;
      const contentH = textEl.getBoundingClientRect().height;
      const h = Math.ceil(contentH + padTop + padBottom);
      if (h > 0) document.documentElement.style.setProperty('--banner-h', h + 'px');
    }
    function scheduleBannerSync() {
      if (bannerSyncRaf) cancelAnimationFrame(bannerSyncRaf);
      bannerSyncRaf = requestAnimationFrame(syncBannerHeight);
    }
    scheduleBannerSync();
    window.addEventListener('resize', scheduleBannerSync);
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(scheduleBannerSync);
    }
    // Re-check once more shortly after load in case a late web-font swap
    // (FOUT → the real Barlow Condensed) reflowed the banner's line count.
    setTimeout(scheduleBannerSync, 500);

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
