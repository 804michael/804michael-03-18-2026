/*
  804Michael — Address Autocomplete for the "Custom Home Value Request" modal
  ----------------------------------------------------------------------------
  Attaches to #val-address (present in the shared valuation modal on every
  page: index.html, ashland.html, mechanicsville.html, glen-allen.html,
  hanover.html). As the user types, suggestions come from our own
  /api/address-autocomplete proxy (a Cloudflare Pages Function), which in
  turn calls sthan.io — never call sthan.io directly from the browser.

  On selecting a suggestion, parses the returned string
    "123 Main St APT 1, Andover, MA 01810-3816"
  into street / city / state / zip and fills #val-city, #val-state, #val-zip.

  Include with: <script defer src="address-autocomplete.js"></script>
*/
(function () {
  'use strict';

  var ENDPOINT = '/api/address-autocomplete';
  var DEBOUNCE_MS = 250;
  var MIN_CHARS = 3;

  function init() {
    var addressEl = document.getElementById('val-address');
    if (!addressEl) return; // page doesn't have the valuation modal

    injectStyles();

    var wrap = document.createElement('div');
    wrap.className = 'addr-ac-wrap';
    addressEl.parentNode.insertBefore(wrap, addressEl);
    wrap.appendChild(addressEl);
    addressEl.setAttribute('autocomplete', 'off');
    addressEl.setAttribute('role', 'combobox');
    addressEl.setAttribute('aria-expanded', 'false');
    addressEl.setAttribute('aria-autocomplete', 'list');

    var list = document.createElement('ul');
    list.className = 'addr-ac-list';
    list.hidden = true;
    wrap.appendChild(list);

    var debounceTimer = null;
    var activeIndex = -1;
    var currentItems = [];
    var currentController = null;
    var lastQuery = '';

    function closeList() {
      list.hidden = true;
      list.innerHTML = '';
      currentItems = [];
      activeIndex = -1;
      addressEl.setAttribute('aria-expanded', 'false');
    }

    function renderList(items) {
      currentItems = items;
      activeIndex = -1;
      list.innerHTML = '';

      if (!items.length) {
        closeList();
        return;
      }

      items.forEach(function (text, i) {
        var li = document.createElement('li');
        li.className = 'addr-ac-item';
        li.textContent = text;
        li.setAttribute('role', 'option');
        li.addEventListener('mousedown', function (e) {
          // mousedown (not click) so it fires before the input's blur
          e.preventDefault();
          selectSuggestion(text);
        });
        li.addEventListener('mouseenter', function () {
          setActive(i);
        });
        list.appendChild(li);
      });

      list.hidden = false;
      addressEl.setAttribute('aria-expanded', 'true');
    }

    function setActive(i) {
      var children = list.querySelectorAll('.addr-ac-item');
      children.forEach(function (el) { el.classList.remove('active'); });
      if (i >= 0 && i < children.length) {
        children[i].classList.add('active');
        children[i].scrollIntoView({ block: 'nearest' });
      }
      activeIndex = i;
    }

    function parseAddress(full) {
      // Expected shape: "123 Main St APT 1, Andover, MA 01810-3816"
      var match = full.match(/^(.*),\s*(.*),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/);
      if (!match) return null;
      return {
        street: match[1].trim(),
        city: match[2].trim(),
        state: match[3].trim().toUpperCase(),
        zip: match[4].trim(),
      };
    }

    function selectSuggestion(full) {
      var parsed = parseAddress(full);
      if (parsed) {
        addressEl.value = parsed.street;
        var cityEl = document.getElementById('val-city');
        var stateEl = document.getElementById('val-state');
        var zipEl = document.getElementById('val-zip');
        if (cityEl) cityEl.value = parsed.city;
        if (stateEl) stateEl.value = parsed.state;
        if (zipEl) zipEl.value = parsed.zip;
        [cityEl, stateEl, zipEl].forEach(function (el) {
          if (el) el.classList.remove('invalid');
        });
      } else {
        // Fallback: couldn't parse, just drop the full string in the address field
        addressEl.value = full;
      }
      addressEl.classList.remove('invalid');
      closeList();
      addressEl.focus();
    }

    function fetchSuggestions(query) {
      if (currentController) currentController.abort();
      currentController = new AbortController();

      fetch(ENDPOINT + '?q=' + encodeURIComponent(query), {
        signal: currentController.signal,
      })
        .then(function (res) { return res.ok ? res.json() : []; })
        .then(function (data) {
          if (!Array.isArray(data)) data = [];
          // Ignore stale responses if the input has since changed
          if (addressEl.value.trim() === query) {
            renderList(data.slice(0, 8));
          }
        })
        .catch(function (err) {
          if (err.name !== 'AbortError') closeList();
        });
    }

    addressEl.addEventListener('input', function () {
      var query = addressEl.value.trim();
      lastQuery = query;
      clearTimeout(debounceTimer);

      if (query.length < MIN_CHARS) {
        closeList();
        return;
      }

      debounceTimer = setTimeout(function () {
        if (addressEl.value.trim() === query) fetchSuggestions(query);
      }, DEBOUNCE_MS);
    });

    addressEl.addEventListener('keydown', function (e) {
      if (list.hidden) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive(Math.min(activeIndex + 1, currentItems.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive(Math.max(activeIndex - 1, 0));
      } else if (e.key === 'Enter') {
        if (activeIndex >= 0 && currentItems[activeIndex]) {
          e.preventDefault();
          selectSuggestion(currentItems[activeIndex]);
        }
      } else if (e.key === 'Escape') {
        closeList();
      }
    });

    addressEl.addEventListener('blur', function () {
      // Slight delay so a mousedown-selection can register first
      setTimeout(closeList, 120);
    });

    document.addEventListener('click', function (e) {
      if (!wrap.contains(e.target)) closeList();
    });
  }

  function injectStyles() {
    if (document.getElementById('addr-ac-styles')) return;
    var style = document.createElement('style');
    style.id = 'addr-ac-styles';
    style.textContent =
      '.addr-ac-wrap{position:relative;}' +
      '.addr-ac-list{position:absolute;top:100%;left:0;right:0;z-index:10001;margin:4px 0 0;padding:6px;' +
      'list-style:none;background:#fff;border:1.5px solid var(--gray-mid,#e0e0e0);border-radius:8px;' +
      'box-shadow:0 10px 30px rgba(0,0,0,.15);max-height:220px;overflow-y:auto;font-family:"Barlow",sans-serif;}' +
      '.addr-ac-item{padding:9px 10px;border-radius:6px;font-size:.92rem;color:var(--black,#111);cursor:pointer;' +
      'line-height:1.3;}' +
      '.addr-ac-item.active,.addr-ac-item:hover{background:var(--red,#DA291C);color:#fff;}';
    document.head.appendChild(style);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
