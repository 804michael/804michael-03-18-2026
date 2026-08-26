/*
  804Michael — Address Autocomplete for the "Custom Home Value Request" modal
  ----------------------------------------------------------------------------
  Uses Nominatim (OpenStreetMap's free geocoding service) — the same service
  already powering map-search.html on this site. Called directly from the
  browser; no backend proxy or API credentials needed.

  Results are soft-biased toward Virginia via a viewbox (addresses elsewhere
  in the US still show up, just ranked lower), and each suggestion is built
  from Nominatim's structured address fields, so City/State/Zip come out
  clean — including a plain 5-digit ZIP rather than ZIP+4.

  Include with: <script defer src="address-autocomplete.js"></script>
*/
(function () {
  'use strict';

  var ENDPOINT = 'https://nominatim.openstreetmap.org/search';
  // Statewide Virginia bounding box, used as a soft preference (bounded=0),
  // not a hard filter — out-of-state addresses can still match, just ranked lower.
  var VA_VIEWBOX = '-83.7,39.5,-75.1,36.5';
  var DEBOUNCE_MS = 300;
  var MIN_CHARS = 3;

  var STATE_ABBR = {
    alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
    colorado: 'CO', connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC',
    florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL',
    indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
    maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI',
    minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT',
    nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
    'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC',
    'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR',
    pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
    'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT',
    vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV',
    wisconsin: 'WI', wyoming: 'WY',
  };

  function stateToAbbr(name) {
    if (!name) return '';
    if (name.length === 2) return name.toUpperCase();
    return STATE_ABBR[name.trim().toLowerCase()] || name;
  }

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

      items.forEach(function (item, i) {
        var li = document.createElement('li');
        li.className = 'addr-ac-item';
        li.textContent = item.display;
        li.setAttribute('role', 'option');
        li.addEventListener('mousedown', function (e) {
          e.preventDefault(); // fires before input's blur
          selectSuggestion(item);
        });
        li.addEventListener('mouseenter', function () { setActive(i); });
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

    function selectSuggestion(item) {
      addressEl.value = item.street;
      var cityEl = document.getElementById('val-city');
      var stateEl = document.getElementById('val-state');
      var zipEl = document.getElementById('val-zip');
      if (cityEl) cityEl.value = item.city;
      if (stateEl) stateEl.value = item.state;
      if (zipEl) zipEl.value = item.zip;
      [addressEl, cityEl, stateEl, zipEl].forEach(function (el) {
        if (el) el.classList.remove('invalid');
      });
      closeList();
      addressEl.focus();
    }

    function toSuggestion(result) {
      var a = result.address || {};
      var houseNum = a.house_number || '';
      var road = a.road || a.pedestrian || a.path || '';
      var street = (houseNum ? houseNum + ' ' + road : road).trim() ||
        (result.display_name ? result.display_name.split(',')[0] : '');
      var city = a.city || a.town || a.village || a.hamlet || a.county || '';
      var state = stateToAbbr(a.state || '');
      var zip = (a.postcode || '').split('-')[0]; // strip ZIP+4 if Nominatim ever includes it

      var displayParts = [street, city, state].filter(Boolean).join(', ');
      var display = zip ? displayParts + ' ' + zip : displayParts;

      return { display: display, street: street, city: city, state: state, zip: zip };
    }

    function fetchSuggestions(query) {
      if (currentController) currentController.abort();
      currentController = new AbortController();

      var url = ENDPOINT +
        '?format=json&limit=8&addressdetails=1&countrycodes=us' +
        '&q=' + encodeURIComponent(query) +
        '&viewbox=' + VA_VIEWBOX + '&bounded=0';

      fetch(url, {
        signal: currentController.signal,
        headers: { 'Accept-Language': 'en-US,en' },
      })
        .then(function (res) { return res.ok ? res.json() : []; })
        .then(function (data) {
          if (!Array.isArray(data)) data = [];
          if (addressEl.value.trim() === query) {
            renderList(data.map(toSuggestion).filter(function (s) { return s.display; }));
          }
        })
        .catch(function (err) {
          if (err.name !== 'AbortError') closeList();
        });
    }

    addressEl.addEventListener('input', function () {
      var query = addressEl.value.trim();
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
      setTimeout(closeList, 120); // let a mousedown-selection register first
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
