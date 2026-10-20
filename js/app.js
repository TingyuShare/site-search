/* ============================================================
 * SiteSearch — main logic (minimal version)
 *
 * Features:
 *   1. Minimal search home: a logo + a search box
 *   2. Configurable default search engine (Google / Bing),
 *      chosen as a single option in the Custom Sites panel
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

  const DEFAULT_ENGINE = 'google';

  const K_ENGINE = 'ss.engine';    // selected default search engine
  const K_LANG = 'ss.lang';
  const K_SITES = 'ss.sites';      // custom sites: [{name, domain}]

  /* ---------------- State ---------------- */
  let engine = DEFAULT_ENGINE; // currently active engine
  let lang = 'zh';

  const qs = new URLSearchParams(location.search);
  const paramQuery = qs.get('q') || '';
  const paramEngine = qs.get('engine');
  const paramLang = qs.get('lang');

  /* ---------------- DOM ---------------- */
  const els = {
    form: document.getElementById('search-form'),
    input: document.getElementById('search-input'),
    settingsBtn: document.getElementById('settings-btn-fixed'),
    sitesPanel: document.getElementById('sites-panel'),
    sitesClose: document.getElementById('sites-close'),
    sitesList: document.getElementById('sites-list'),
    suggestions: document.getElementById('suggestions'),
    bulkImportInput: document.getElementById('bulk-import-input'),
    bulkImportBtn: document.getElementById('bulk-import-btn'),
    engineSelect: document.getElementById('engine-selector'),
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
    if (existing) return 'duplicate';
    sites.push({ name: name.trim(), domain: normalizedDomain });
    saveCustomSites(sites);
    renderSitesList();
    return 'added';
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
      els.sitesList.innerHTML = '<div class="sites-empty">No custom sites added yet</div>';
      return;
    }
    els.sitesList.innerHTML = sites.map(site => `
      <div class="site-item" data-domain="${site.domain}">
        <div class="site-item-info">
          <div class="site-item-name">${escapeHtml(site.name)}</div>
          <div class="site-item-domain">${escapeHtml(site.domain)}</div>
        </div>
        <button class="site-delete-btn" data-domain="${escapeHtml(site.domain)}" aria-label="Delete ${escapeHtml(site.name)}">
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
    const siteMatch = query.match(/^site:(\S+)(?:\s+(.*))?$/);
    if (siteMatch) {
      hideSuggestions();
      return;
    }

    // Filter sites by name or domain (match any word in query)
    const queryWords = query.toLowerCase().split(/\s+/);
    const filtered = sites.filter(s =>
      queryWords.some(word =>
        s.name.toLowerCase().includes(word) ||
        s.domain.toLowerCase().includes(word)
      )
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

  /* ---------------- Default Search Engine ---------------- */
  /** Resolve the active engine: URL param > localStorage selection > default */
  function resolveEngine() {
    if (paramEngine && ENGINES[paramEngine]) return paramEngine;
    const stored = safeLocal.get(K_ENGINE);
    if (stored && ENGINES[stored]) return stored;
    return DEFAULT_ENGINE;
  }

  function renderEngineSelector() {
    els.engineSelect.querySelectorAll('input[name="default-engine"]').forEach((radio) => {
      radio.checked = radio.value === engine;
    });
  }

  function setEngine(value) {
    if (!ENGINES[value]) return;
    engine = value;
    safeLocal.set(K_ENGINE, value);
    renderEngineSelector();
  }

  /* ---------------- Render (sync page language only) ---------------- */
  function render() {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  }

  /* ---------------- Search ---------------- */
  function goSearch(query) {
    const q = (query || '').trim();
    if (!q) return;

    // Check for site: prefix (handle both "site:domain" and "site:domain query")
    const siteMatch = q.match(/^site:(\S+)(?:\s+(.*))?$/);
    if (siteMatch) {
      const domain = siteMatch[1];
      const searchQuery = siteMatch[2] || '';
      const def = ENGINES[engine];
      const siteQuery = searchQuery ? `${searchQuery} site:${domain}` : `site:${domain}`;
      location.href = def.search + '?' + new URLSearchParams({ q: siteQuery }).toString();
      return;
    }

    // Check if first word matches a configured custom site
    const sites = getCustomSites();
    const words = q.split(/\s+/);
    const firstWord = words[0];
    if (firstWord) {
      const matchedSite = sites.find(s => s.name.toLowerCase() === firstWord.toLowerCase());
      if (matchedSite) {
        const def = ENGINES[engine];
        const newQuery = `${q} site:${matchedSite.domain}`;
        location.href = def.search + '?' + new URLSearchParams({ q: newQuery }).toString();
        return;
      }
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
      renderEngineSelector();
    });

    // Bulk import
    els.bulkImportBtn.addEventListener('click', () => {
      const text = els.bulkImportInput.value.trim();
      if (!text) return;
      
      const lines = text.split(/\n/).filter(line => line.trim());
      let imported = 0;
      let errors = 0;
      let duplicates = 0;
      
      for (const line of lines) {
        const parts = line.split(':');
        if (parts.length >= 2) {
          const name = parts[0].trim();
          const domain = parts.slice(1).join(':').trim();
          if (name && domain) {
            const normalizedDomain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
            const result = addCustomSite(name, normalizedDomain);
            if (result === 'added') {
              imported++;
            } else if (result === 'duplicate') {
              duplicates++;
            } else {
              errors++;
            }
          } else {
            errors++;
          }
        } else {
          errors++;
        }
      }
      
      // Clear input after import
      els.bulkImportInput.value = '';
      
      // Show feedback
      if (imported > 0 || duplicates > 0) {
        renderSitesList();
        let msg = `Successfully imported ${imported} site(s)`;
        if (duplicates > 0) msg += `, ${duplicates} already exist`;
        if (errors > 0) msg += `, ${errors} format error(s)`;
        alert(msg);
      } else if (errors > 0) {
        alert(`Import failed: All lines have format errors. Please use Name:Domain format`);
      }
    });

    // Enter key in bulk import textarea
    els.bulkImportInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        els.bulkImportBtn.click();
      }
    });

    // Close sites panel
    els.sitesClose.addEventListener('click', () => {
      els.sitesPanel.classList.add('hidden');
    });

    // Default search engine selection
    els.engineSelect.addEventListener('change', (e) => {
      if (e.target.name === 'default-engine') {
        setEngine(e.target.value);
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
        // Replace the FIRST word in the query with site:domain (full match only)
        const words = query.split(/\s+/);
        let replaced = false;
        for (let i = 0; i < words.length; i++) {
          const word = words[i];
          // Exact (case-insensitive) match between the word and the site domain
          if (word.toLowerCase() === site.toLowerCase()) {
            words[i] = `site:${site}`;
            replaced = true;
            break;
          }
        }
        const newQuery = replaced ? words.join(' ') : (query ? `site:${site} ${query}` : `site:${site}`);
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
  function init() {
    // 1. Language: URL param > localStorage > default zh
    const storedLang = safeLocal.get(K_LANG);
    lang = paramLang === 'zh' || paramLang === 'en' ? paramLang : storedLang === 'en' ? 'en' : 'zh';
    safeLocal.set(K_LANG, lang);
    render();

    // 2. Engine: URL param > localStorage selection > default
    engine = resolveEngine();

    if (paramQuery) els.input.value = paramQuery;

    bindEvents();

    // Auto-search if query parameter is present
    if (paramQuery) {
      goSearch(paramQuery);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();