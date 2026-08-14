/* ============================================================
 * SiteSearch — main logic (minimal version)
 *
 * Features:
 *   1. Minimal search home: a logo + a search box
 *   2. Detect country/region via free IP geolocation APIs
 *      - China (CN)      -> use Bing search (bing.com/search)
 *      - Other regions   -> use Google search (google.com/search)
 *   3. URL params: ?q=keyword &engine=google|bing &lang=zh|en
 * ============================================================ */

(() => {
  'use strict';

  /* ---------------- Config ---------------- */
  const ENGINES = {
    google: {
      name: 'Google',
      search: 'https://www.google.com/search',
    },
    bing: {
      name: 'Bing',
      search: 'https://www.bing.com/search',
    },
  };

  const DEFAULT_ENGINE = 'google'; // default for non-China regions
  const CN_ENGINE = 'bing';        // default for China

  const K_GEO = 'ss.geo';          // cache: {country, ip, ts}, ip used for real-time comparison
  const K_LANG = 'ss.lang';
  const K_SITES = 'ss.sites';      // custom sites: [{name, domain}]
  const GEO_TTL = 6 * 60 * 60 * 1000; // 6 hours
  const PROVIDER_TIMEOUT = 5000;

  /**
   * IP geolocation providers (tried in order as fallbacks).
   * All are free, CORS-enabled APIs that need no API key.
   * Each returns: ip (current public egress IP) + country (region code).
   */
  const GEO_PROVIDERS = [
    {
      name: 'ipapi.co',
      url: 'https://ipapi.co/json/',
      parse: (d) => (typeof d.country_code === 'string'
        ? { country: d.country_code.toUpperCase(), ip: typeof d.ip === 'string' ? d.ip : null }
        : null),
    },
    {
      name: 'ip-api.com',
      url: 'https://ip-api.com/json/?fields=status,countryCode,query',
      parse: (d) => (d && d.status === 'success' && typeof d.countryCode === 'string'
        ? { country: d.countryCode.toUpperCase(), ip: typeof d.query === 'string' ? d.query : null }
        : null),
    },
    {
      name: 'ipwho.is',
      url: 'https://ipwho.is/',
      parse: (d) => (d && d.success !== false && typeof d.country_code === 'string'
        ? { country: d.country_code.toUpperCase(), ip: typeof d.ip === 'string' ? d.ip : null }
        : null),
    },
  ];

  /* ---------------- State ---------------- */
  let engine = DEFAULT_ENGINE; // currently active engine
  let country = null;          // country code, e.g. CN
  let lang = 'zh';

  const qs = new URLSearchParams(location.search);
  const paramQuery = qs.get('q') || '';
  const paramEngine = qs.get('engine');
  const paramLang = qs.get('lang');

  /* ---------------- DOM ---------------- */
  const els = {
    form: document.getElementById('search-form'),
    input: document.getElementById('search-input'),
    settingsBtn: document.getElementById('settings-btn'),
    sitesPanel: document.getElementById('sites-panel'),
    sitesClose: document.getElementById('sites-close'),
    sitesList: document.getElementById('sites-list'),
    siteNameInput: document.getElementById('site-name-input'),
    siteDomainInput: document.getElementById('site-domain-input'),
    siteAddBtn: document.getElementById('site-add-btn'),
    suggestions: document.getElementById('suggestions'),
  };

  /* ---------------- Custom Sites ---------------- */
  function getCustomSites() {
    try {
      const raw = safeLocal.get(K_SITES);
      if (raw) return JSON.parse(raw);
    } catch { /* ignore */ }
    return [];
  }

  function saveCustomSites(sites) {
    safeLocal.set(K_SITES, JSON.stringify(sites));
  }

  function addCustomSite(name, domain) {
    const sites = getCustomSites();
    // Check if domain already exists
    const normalizedDomain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
    const existing = sites.find(s => s.domain.toLowerCase() === normalizedDomain);
    if (existing) return false;
    sites.push({ name: name.trim(), domain: normalizedDomain });
    saveCustomSites(sites);
    renderSitesList();
    return true;
  }

  function removeCustomSite(domain) {
    const sites = getCustomSites();
    const filtered = sites.filter(s => s.domain.toLowerCase() !== domain.toLowerCase());
    saveCustomSites(filtered);
    renderSitesList();
  }

  function renderSitesList() {
    const sites = getCustomSites();
    if (sites.length === 0) {
      els.sitesList.innerHTML = '<div class="sites-empty">还没有添加自定义站点</div>';
      return;
    }
    els.sitesList.innerHTML = sites.map(site => `
      <div class="site-item" data-domain="${site.domain}">
        <div class="site-item-info">
          <div class="site-item-name">${escapeHtml(site.name)}</div>
          <div class="site-item-domain">${escapeHtml(site.domain)}</div>
        </div>
        <button class="site-delete-btn" data-domain="${escapeHtml(site.domain)}" aria-label="删除 ${escapeHtml(site.name)}">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
          </svg>
        </button>
      </div>
    `).join('');
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /* ---------------- Suggestions ---------------- */
  function showSuggestions(query) {
    const sites = getCustomSites();
    if (sites.length === 0) {
      hideSuggestions();
      return;
    }

    // Check for site: prefix
    const siteMatch = query.match(/^site:(\S+)\s+(.*)$/);
    if (siteMatch) {
      hideSuggestions();
      return;
    }

    // Filter sites by name or domain
    const filtered = sites.filter(s =>
      s.name.toLowerCase().includes(query.toLowerCase()) ||
      s.domain.toLowerCase().includes(query.toLowerCase())
    );

    if (filtered.length === 0) {
      hideSuggestions();
      return;
    }

    els.suggestions.innerHTML = filtered.map(site => `
      <div class="suggestion-item" data-site="${escapeHtml(site.domain)}" data-query="${escapeHtml(query)}">
        <svg class="suggestion-icon" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/>
        </svg>
        <div class="suggestion-text">
          <span class="site-name">${escapeHtml(site.name)}</span>
          <span class="site-domain">${escapeHtml(site.domain)}</span>
        </div>
      </div>
    `).join('');

    els.suggestions.classList.remove('hidden');
  }

  function hideSuggestions() {
    els.suggestions.classList.add('hidden');
    els.suggestions.innerHTML = '';
  }

  /* ---------------- Utils ---------------- */
  const safeLocal = {
    get(k) {
      try { return localStorage.getItem(k); } catch { return null; }
    },
    set(k, v) {
      try { localStorage.setItem(k, v); } catch { /* ignore */ }
    },
  };

  /* ---------------- Geolocation ---------------- */
  /** Read a valid cache entry {country, ip, ts}; null if missing/expired */
  function cachedGeo() {
    try {
      const raw = JSON.parse(safeLocal.get(K_GEO) || 'null');
      if (raw && raw.country && Date.now() - raw.ts < GEO_TTL) return raw;
    } catch { /* ignore */ }
    return null;
  }

  /**
   * Fetch the current public egress IP and its region in real time.
   * Returns {country, ip}; on success, stores the "IP -> region"
   * mapping into the 6-hour cache.
   */
  async function fetchGeo() {
    for (const p of GEO_PROVIDERS) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), PROVIDER_TIMEOUT);
      try {
        const res = await fetch(p.url, { signal: ctrl.signal });
        if (!res.ok) continue;
        const data = await res.json();
        const geo = p.parse(data);
        if (geo && geo.country) {
          safeLocal.set(K_GEO, JSON.stringify({
            country: geo.country,
            ip: geo.ip || null,
            ts: Date.now(),
          }));
          return geo;
        }
      } catch { /* try next provider */ }
      finally {
        clearTimeout(timer);
      }
    }
    return null;
  }

  const engineForCountry = (c) => (c === 'CN' ? CN_ENGINE : DEFAULT_ENGINE);

  /* ---------------- Render (sync page language only) ---------------- */
  function render() {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  }

  /* ---------------- Search ---------------- */
  function goSearch(query) {
    const q = (query || '').trim();
    if (!q) return;

    // Check for site: prefix
    const siteMatch = q.match(/^site:(\S+)\s+(.*)$/);
    if (siteMatch) {
      const domain = siteMatch[1];
      const searchQuery = siteMatch[2];
      const def = ENGINES[engine];
      const siteQuery = searchQuery ? `${searchQuery} site:${domain}` : `site:${domain}`;
      location.href = def.search + '?' + new URLSearchParams({ q: siteQuery }).toString();
      return;
    }

    const def = ENGINES[engine];
    location.href = def.search + '?' + new URLSearchParams({ q }).toString();
  }

  /* ---------------- Events ---------------- */
  function bindEvents() {
    els.form.addEventListener('submit', (e) => {
      e.preventDefault();
      hideSuggestions();
      goSearch(els.input.value);
    });

    // Settings button
    els.settingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      els.sitesPanel.classList.toggle('hidden');
      renderSitesList();
    });

    // Close sites panel
    els.sitesClose.addEventListener('click', () => {
      els.sitesPanel.classList.add('hidden');
    });

    // Add site
    els.siteAddBtn.addEventListener('click', () => {
      const name = els.siteNameInput.value.trim();
      const domain = els.siteDomainInput.value.trim();
      if (!name || !domain) return;
      // Remove protocol if present
      const normalizedDomain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      if (addCustomSite(name, normalizedDomain)) {
        els.siteNameInput.value = '';
        els.siteDomainInput.value = '';
      }
    });

    // Enter key in add form
    els.siteDomainInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        els.siteAddBtn.click();
      }
    });

    // Delete site (delegation)
    els.sitesList.addEventListener('click', (e) => {
      const btn = e.target.closest('.site-delete-btn');
      if (btn) {
        const domain = btn.dataset.domain;
        removeCustomSite(domain);
      }
    });

    // Suggestions (delegation)
    els.suggestions.addEventListener('click', (e) => {
      const item = e.target.closest('.suggestion-item');
      if (item) {
        const site = item.dataset.site;
        const query = item.dataset.query;
        // Add site: prefix to query
        const newQuery = query ? `site:${site} ${query}` : `site:${site}`;
        els.input.value = newQuery;
        hideSuggestions();
        goSearch(newQuery);
      }
    });

    // Input events for suggestions
    els.input.addEventListener('input', () => {
      const query = els.input.value.trim();
      if (query) {
        showSuggestions(query);
      } else {
        hideSuggestions();
      }
    });

    els.input.addEventListener('focus', () => {
      const query = els.input.value.trim();
      if (query) {
        showSuggestions(query);
      }
    });

    els.input.addEventListener('blur', () => {
      // Delay to allow click on suggestions
      setTimeout(hideSuggestions, 200);
    });

    // Keyboard navigation for suggestions
    let activeSuggestion = -1;
    els.input.addEventListener('keydown', (e) => {
      const items = els.suggestions.querySelectorAll('.suggestion-item');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeSuggestion = Math.min(activeSuggestion + 1, items.length - 1);
        updateActiveSuggestion(items);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeSuggestion = Math.max(activeSuggestion - 1, -1);
        updateActiveSuggestion(items);
      } else if (e.key === 'Enter' && activeSuggestion >= 0) {
        e.preventDefault();
        items[activeSuggestion].click();
      }
    });

    function updateActiveSuggestion(items) {
      items.forEach((item, i) => {
        item.classList.toggle('active', i === activeSuggestion);
      });
    }

    // Shortcuts: "/" focuses the input, Esc clears it
    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement !== els.input) {
        e.preventDefault();
        els.input.focus();
      } else if (e.key === 'Escape' && document.activeElement === els.input) {
        els.input.value = '';
        hideSuggestions();
      } else if (e.key === 'Escape' && !els.sitesPanel.classList.contains('hidden')) {
        els.sitesPanel.classList.add('hidden');
      }
    });

    // Click outside to close
    document.addEventListener('click', (e) => {
      if (!els.sitesPanel.contains(e.target) && e.target !== els.settingsBtn) {
        els.sitesPanel.classList.add('hidden');
      }
      if (!els.suggestions.contains(e.target) && e.target !== els.input) {
        hideSuggestions();
      }
    });
  }

  /* ---------------- Init ---------------- */
  async function init() {
    // 1. Language: URL param > localStorage > default zh
    const storedLang = safeLocal.get(K_LANG);
    lang = paramLang === 'zh' || paramLang === 'en' ? paramLang : storedLang === 'en' ? 'en' : 'zh';
    safeLocal.set(K_LANG, lang);
    render();

    // 2. Engine: URL param > geolocation cache > default
    const cached = cachedGeo();
    const c = cached ? cached.country : null;
    engine = paramEngine && ENGINES[paramEngine]
      ? paramEngine
      : (c ? engineForCountry(c) : DEFAULT_ENGINE);

    if (paramQuery) els.input.value = paramQuery;

    bindEvents();

    if (cached) {
      // Cache hit: pick the engine from the cached region first,
      // then verify the real IP in the background.
      country = c;
      if (!paramEngine) engine = engineForCountry(c);

      const geo = await fetchGeo();
      if (geo) {
        const ipUnchanged = cached.ip && cached.ip === geo.ip;
        if (!ipUnchanged) {
          // IP changed (VPN toggle / route switch) -> re-locate with live result
          country = geo.country;
          if (!paramEngine) engine = engineForCountry(country);
        }
        // IP unchanged: keep the cached region
      }
      // Verification failed: keep the cached region
    } else {
      // No cache: locate asynchronously
      const geo = await fetchGeo();
      country = geo ? geo.country : null;
      if (!paramEngine && country) {
        engine = engineForCountry(country);
      }
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();