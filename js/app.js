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
  };

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
    const def = ENGINES[engine];
    location.href = def.search + '?' + new URLSearchParams({ q }).toString();
  }

  /* ---------------- Events ---------------- */
  function bindEvents() {
    els.form.addEventListener('submit', (e) => {
      e.preventDefault();
      goSearch(els.input.value);
    });

    // Shortcuts: "/" focuses the input, Esc clears it
    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement !== els.input) {
        e.preventDefault();
        els.input.focus();
      } else if (e.key === 'Escape' && document.activeElement === els.input) {
        els.input.value = '';
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