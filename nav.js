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

  // ── EmailJS (Message modal) ──────────────────────────────────────────
  // Same EmailJS account already used by the Home Value forms on
  // index.html / home-value-estimate.html (EMAILJS_PUBLIC_KEY + SERVICE_ID
  // match exactly — these are public-by-design EmailJS identifiers, not
  // secrets). MESSAGE_TEMPLATE_ID is a NEW template that must exist in the
  // EmailJS dashboard (dashboard.emailjs.com → Email Templates → Create
  // New Template), with this exact Template ID and these variables used
  // somewhere in the template body/settings:
  //   {{from_name}}  {{from_email}}  {{phone}}  {{message}}  {{page_url}}
  // Set "To Email" to wherever leads should land, and "Reply To" to
  // {{from_email}} so replying from the inbox goes straight back to the
  // visitor. Loaded lazily (only once someone opens the Message modal),
  // not on every page load, since most visitors never click it.
  const EMAILJS_PUBLIC_KEY = 'OKJ28y1nsaYakyCX3';
  const EMAILJS_SERVICE_ID = 'service_wfjv62c';
  const MESSAGE_TEMPLATE_ID = 'template_contact_message';
  let _emailjsReady = false;
  function loadEmailJS(cb) {
    if (window.emailjs) {
      if (!_emailjsReady) { emailjs.init(EMAILJS_PUBLIC_KEY); _emailjsReady = true; }
      cb();
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/emailjs-com@3/dist/email.min.js';
    s.onload = function () { emailjs.init(EMAILJS_PUBLIC_KEY); _emailjsReady = true; cb(); };
    s.onerror = function () { console.error('nav.js: failed to load the EmailJS SDK — check your connection and try again.'); };
    document.head.appendChild(s);
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

    // ── Message modal (Connect ▸ Message, and the mobile "Message
    // 804-Michael" button) — see the EmailJS setup notes near the top of
    // this file for what needs to exist in the EmailJS dashboard.
    const msgOverlay = document.getElementById('msgModalOverlay');
    const msgForm = document.getElementById('msgForm');
    const msgStatus = document.getElementById('msgStatus');
    const msgSubmitBtn = document.getElementById('msgSubmitBtn');
    const messageTrigger = document.getElementById('message-trigger');
    const mobMessageBtn = document.getElementById('mob-message-btn');
    const msgModalClose = document.getElementById('msgModalClose');
    const msgCancel = document.getElementById('msgCancel');

    function openMsgModal() {
      if (!msgOverlay) return;
      loadEmailJS(function () {}); // warm the SDK up now so it's ready by the time they hit Send
      msgOverlay.classList.add('open');
      connectDd.classList.remove('open');
      connectBtn.setAttribute('aria-expanded', 'false');
      if (typeof window.closeMob === 'function') window.closeMob();
    }
    function closeMsgModal() {
      if (msgOverlay) msgOverlay.classList.remove('open');
    }
    if (messageTrigger) messageTrigger.addEventListener('click', openMsgModal);
    if (mobMessageBtn) mobMessageBtn.addEventListener('click', openMsgModal);
    if (msgModalClose) msgModalClose.addEventListener('click', closeMsgModal);
    if (msgCancel) msgCancel.addEventListener('click', closeMsgModal);
    if (msgOverlay) msgOverlay.addEventListener('click', function (e) { if (e.target === msgOverlay) closeMsgModal(); });

    if (msgForm) {
      msgForm.addEventListener('submit', function (e) {
        e.preventDefault();
        const nameEl = document.getElementById('msgName');
        const emailEl = document.getElementById('msgEmail');
        const phoneEl = document.getElementById('msgPhone');
        const bodyEl = document.getElementById('msgBody');

        const missing = [];
        if (!nameEl.value.trim()) missing.push('your name');
        if (!emailEl.value.trim() && !phoneEl.value.trim()) missing.push('an email or phone number so I can get back to you');
        if (!bodyEl.value.trim()) missing.push('a message');
        if (missing.length) {
          msgStatus.textContent = 'Please add: ' + missing.join(', ') + '.';
          msgStatus.className = 'msg-modal-status error';
          return;
        }

        msgSubmitBtn.disabled = true;
        const originalLabel = msgSubmitBtn.textContent;
        msgSubmitBtn.textContent = 'Sending…';
        msgStatus.textContent = '';
        msgStatus.className = 'msg-modal-status';

        loadEmailJS(function () {
          emailjs.send(EMAILJS_SERVICE_ID, MESSAGE_TEMPLATE_ID, {
            from_name: nameEl.value.trim(),
            from_email: emailEl.value.trim() || '(not provided)',
            phone: phoneEl.value.trim() || '(not provided)',
            message: bodyEl.value.trim(),
            page_url: window.location.href
          }).then(function () {
            msgStatus.textContent = '✓ Message sent — I\'ll get back to you soon.';
            msgStatus.className = 'msg-modal-status success';
            msgSubmitBtn.textContent = '✓ Sent!';
            msgForm.reset();
            setTimeout(closeMsgModal, 1800);
            setTimeout(function () {
              msgSubmitBtn.disabled = false;
              msgSubmitBtn.textContent = originalLabel;
              msgStatus.textContent = '';
              msgStatus.className = 'msg-modal-status';
            }, 2000);
          }).catch(function (err) {
            console.error('EmailJS error:', err);
            // Surface the actual EmailJS error text when available (e.g. "template ID not
            // found", "service ID not found") — fastest way to diagnose a misconfigured
            // EmailJS template/service straight from the browser console.
            const detail = (err && (err.text || err.message)) ? (': ' + (err.text || err.message)) : '';
            msgStatus.textContent = 'Something went wrong sending your message' + detail + '. Please call or text 804-642-4235 instead.';
            msgStatus.className = 'msg-modal-status error';
            msgSubmitBtn.disabled = false;
            msgSubmitBtn.textContent = originalLabel;
          });
        });
      });
    }
  }
})();
