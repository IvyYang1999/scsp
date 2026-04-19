/**
 * SCSP Community Widget — widget.js
 * Self-contained web component: <scsp-community>
 *
 * Attributes:
 *   registry   — URL to registry/index.json
 *   theme      — "light" | "dark" | "auto" (default: "auto")
 *   max-height — CSS max-height for the scrollable list (default: "500px")
 *
 * Usage:
 *   <script src="https://scsp.dev/sdk/widget.js"></script>
 *   <scsp-community registry="https://..." theme="auto" max-height="600px"></scsp-community>
 */

(function () {
  'use strict';

  /* -----------------------------------------------------------------------
     Fallback data (used if registry fetch fails)
     ----------------------------------------------------------------------- */
  const FALLBACK = [
    {
      id: 'auth-totp-v1',
      name: 'TOTP Two-Factor Authentication',
      version: '1.0.0',
      layer: 'module',
      description: 'Adds RFC 6238-compliant TOTP 2FA to any SCSP-compatible app\'s login flow.',
      tags: ['auth', 'security', 'mfa', '2fa'],
      active_installs: 147,
      compatibility_score: 0.94
    },
    {
      id: 'calendar-week-view-v1',
      name: 'Calendar Week View',
      version: '1.2.0',
      layer: 'component',
      description: '7-day week view with drag-and-drop event rescheduling. Works with React, Vue, Svelte.',
      tags: ['ui', 'calendar', 'scheduling'],
      active_installs: 89,
      compatibility_score: 0.91
    },
    {
      id: 'approval-workflow-v1',
      name: 'Approval Workflow State Machine',
      version: '2.0.1',
      layer: 'behavior',
      description: 'Multi-step approval state machine with audit trail and email notifications.',
      tags: ['workflow', 'approval', 'audit'],
      active_installs: 203,
      compatibility_score: 0.88
    },
    {
      id: 'perf-image-lazy-load-v1',
      name: 'Image Lazy Loading',
      version: '1.0.3',
      layer: 'improvement',
      description: 'IntersectionObserver-based lazy loading. Zero dependencies, progressive enhancement.',
      tags: ['performance', 'images', 'optimization'],
      active_installs: 412,
      compatibility_score: 0.97
    }
  ];

  /* -----------------------------------------------------------------------
     Layer color config
     ----------------------------------------------------------------------- */
  const LAYER_COLORS = {
    module:      { bg: '#eff6ff', text: '#3b82f6' },
    component:   { bg: '#ecfdf5', text: '#10b981' },
    behavior:    { bg: '#fff7ed', text: '#f97316' },
    improvement: { bg: '#faf5ff', text: '#a855f7' }
  };

  const LAYER_COLORS_DARK = {
    module:      { bg: '#1e3a5f', text: '#93c5fd' },
    component:   { bg: '#064e3b', text: '#6ee7b7' },
    behavior:    { bg: '#431407', text: '#fdba74' },
    improvement: { bg: '#3b0764', text: '#d8b4fe' }
  };

  /* -----------------------------------------------------------------------
     Helpers
     ----------------------------------------------------------------------- */
  function esc(s) {
    if (!s) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmt(n) {
    if (n == null) return '—';
    return Number(n).toLocaleString();
  }

  function isDark(theme) {
    if (theme === 'dark') return true;
    if (theme === 'light') return false;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  /* -----------------------------------------------------------------------
     Styles (injected into shadow DOM)
     ----------------------------------------------------------------------- */
  function buildStyles(dark) {
    const c = {
      bg:         dark ? '#1e293b' : '#ffffff',
      bgSec:      dark ? '#0f172a' : '#f8fafc',
      bgTer:      dark ? '#334155' : '#f1f5f9',
      surface:    dark ? '#1e293b' : '#ffffff',
      border:     dark ? '#334155' : '#e2e8f0',
      text:       dark ? '#f1f5f9' : '#0f172a',
      textSec:    dark ? '#94a3b8' : '#475569',
      textMuted:  dark ? '#64748b' : '#94a3b8',
      primary:    dark ? '#818cf8' : '#6366f1',
      primaryHov: dark ? '#6366f1' : '#4f46e5',
      primaryLt:  dark ? '#1e1b4b' : '#e0e7ff',
      success:    dark ? '#6ee7b7' : '#10b981',
      tag:        dark ? '#334155' : '#f1f5f9'
    };

    return `
      :host {
        display: block;
        font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
        color-scheme: ${dark ? 'dark' : 'light'};
        --primary: ${c.primary};
        --border: ${c.border};
      }

      * { box-sizing: border-box; margin: 0; padding: 0; }

      .widget {
        background: ${c.bg};
        border: 1px solid ${c.border};
        border-radius: 12px;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        font-size: 14px;
        box-shadow: 0 1px 3px rgba(0,0,0,${dark ? '0.4' : '0.08'}),
                    0 4px 12px rgba(0,0,0,${dark ? '0.3' : '0.04'});
      }

      .widget-header {
        padding: 14px 16px;
        border-bottom: 1px solid ${c.border};
        background: ${c.bgSec};
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }

      .widget-brand {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .widget-logo {
        width: 24px;
        height: 24px;
        background: linear-gradient(135deg, ${c.primary}, ${dark ? '#3730a3' : '#4f46e5'});
        border-radius: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 9px;
        font-weight: 800;
        color: #fff;
        flex-shrink: 0;
      }

      .widget-title {
        font-weight: 700;
        font-size: 13px;
        color: ${c.text};
        letter-spacing: -0.01em;
      }

      .widget-subtitle {
        font-size: 11px;
        color: ${c.textMuted};
      }

      .widget-open-link {
        font-size: 11px;
        font-weight: 600;
        color: ${c.primary};
        text-decoration: none;
        padding: 4px 8px;
        border-radius: 6px;
        border: 1px solid ${c.border};
        background: ${c.surface};
        white-space: nowrap;
        flex-shrink: 0;
        transition: background 0.15s;
      }
      .widget-open-link:hover { background: ${c.primaryLt}; }

      .widget-search-wrap {
        padding: 10px 12px;
        border-bottom: 1px solid ${c.border};
        background: ${c.surface};
        position: relative;
      }

      .widget-search-icon {
        position: absolute;
        left: 22px;
        top: 50%;
        transform: translateY(-50%);
        color: ${c.textMuted};
        pointer-events: none;
        width: 14px;
        height: 14px;
      }

      .widget-search {
        width: 100%;
        padding: 7px 10px 7px 30px;
        border: 1.5px solid ${c.border};
        border-radius: 8px;
        background: ${c.bgSec};
        color: ${c.text};
        font-family: inherit;
        font-size: 13px;
        outline: none;
        transition: border-color 0.15s, box-shadow 0.15s;
      }
      .widget-search::placeholder { color: ${c.textMuted}; }
      .widget-search:focus {
        border-color: ${c.primary};
        box-shadow: 0 0 0 3px ${dark ? 'rgba(99,102,241,0.25)' : 'rgba(99,102,241,0.15)'};
      }

      .widget-list {
        overflow-y: auto;
        flex: 1;
        padding: 6px;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .widget-list::-webkit-scrollbar { width: 4px; }
      .widget-list::-webkit-scrollbar-track { background: transparent; }
      .widget-list::-webkit-scrollbar-thumb {
        background: ${c.border};
        border-radius: 4px;
      }

      .cap-item {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        padding: 10px 12px;
        border-radius: 8px;
        border: 1px solid transparent;
        gap: 12px;
        transition: background 0.15s, border-color 0.15s;
        cursor: default;
      }
      .cap-item:hover {
        background: ${c.bgSec};
        border-color: ${c.border};
      }

      .cap-item-left { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }

      .cap-item-header { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }

      .cap-item-name {
        font-weight: 600;
        font-size: 13px;
        color: ${c.text};
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .layer-badge {
        display: inline-flex;
        padding: 2px 6px;
        border-radius: 100px;
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        flex-shrink: 0;
      }

      .cap-item-desc {
        font-size: 12px;
        color: ${c.textSec};
        line-height: 1.4;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      .cap-item-tags { display: flex; flex-wrap: wrap; gap: 3px; }

      .tag {
        display: inline-flex;
        padding: 1px 6px;
        border-radius: 100px;
        font-size: 10px;
        background: ${c.tag};
        color: ${c.textSec};
      }

      .cap-item-right {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 6px;
        flex-shrink: 0;
      }

      .cap-item-stat {
        font-size: 11px;
        color: ${c.textMuted};
        white-space: nowrap;
      }

      .cap-item-stat b { color: ${c.text}; }

      .copy-btn {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 4px 8px;
        border-radius: 6px;
        font-size: 11px;
        font-weight: 600;
        background: ${c.primary};
        color: #fff;
        border: none;
        cursor: pointer;
        font-family: inherit;
        transition: background 0.15s, transform 0.1s;
        white-space: nowrap;
      }
      .copy-btn:hover { background: ${c.primaryHov}; }
      .copy-btn:active { transform: scale(0.96); }

      .copy-btn.copied {
        background: ${c.success};
      }

      .widget-empty {
        padding: 32px 16px;
        text-align: center;
        color: ${c.textMuted};
        font-size: 13px;
      }

      .widget-footer {
        padding: 8px 12px;
        border-top: 1px solid ${c.border};
        background: ${c.bgSec};
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }

      .widget-footer-count {
        font-size: 11px;
        color: ${c.textMuted};
      }

      .widget-footer-brand {
        font-size: 10px;
        color: ${c.textMuted};
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }

      .widget-loading {
        padding: 24px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      @keyframes shimmer {
        from { background-position: 200% 0; }
        to   { background-position: -200% 0; }
      }

      .skeleton {
        border-radius: 6px;
        background: linear-gradient(
          90deg,
          ${c.bgTer} 25%,
          ${c.bgSec} 50%,
          ${c.bgTer} 75%
        );
        background-size: 200% 100%;
        animation: shimmer 1.5s infinite;
      }
    `;
  }

  /* -----------------------------------------------------------------------
     Custom Element
     ----------------------------------------------------------------------- */
  class ScspCommunity extends HTMLElement {
    static get observedAttributes() {
      return ['registry', 'theme', 'max-height'];
    }

    constructor() {
      super();
      this._shadow = this.attachShadow({ mode: 'open' });
      this._capabilities = [];
      this._filtered = [];
      this._searchQuery = '';
      this._abortController = null;
    }

    connectedCallback() {
      this._render();
      this._fetchCapabilities();

      // Listen for system theme changes when theme="auto"
      if (this.getAttribute('theme') === 'auto' || !this.getAttribute('theme')) {
        this._mql = window.matchMedia('(prefers-color-scheme: dark)');
        this._mqlHandler = () => this._render();
        this._mql.addEventListener('change', this._mqlHandler);
      }
    }

    disconnectedCallback() {
      if (this._mql && this._mqlHandler) {
        this._mql.removeEventListener('change', this._mqlHandler);
      }
      if (this._abortController) {
        this._abortController.abort();
      }
    }

    attributeChangedCallback(name) {
      if (name === 'registry') {
        this._fetchCapabilities();
      } else {
        this._updateStyles();
      }
    }

    /* ---- Data Fetch ---- */
    async _fetchCapabilities() {
      if (this._abortController) this._abortController.abort();
      this._abortController = new AbortController();
      const signal = this._abortController.signal;

      this._showLoading();

      const registryUrl = this.getAttribute('registry');
      const endpoints = registryUrl
        ? [registryUrl]
        : [
            '../registry/index.json',
            './registry/index.json',
            'https://raw.githubusercontent.com/scsp-community/registry/main/registry/index.json'
          ];

      let caps = null;
      for (const url of endpoints) {
        try {
          const res = await fetch(url, { signal, cache: 'no-cache' });
          if (!res.ok) continue;
          const data = await res.json();
          if (data.capabilities && Array.isArray(data.capabilities)) {
            caps = data.capabilities;
            break;
          }
        } catch (err) {
          if (err.name === 'AbortError') return;
        }
      }

      this._capabilities = caps || FALLBACK;
      this._filtered = [...this._capabilities];
      this._renderList();
    }

    /* ---- Filtering ---- */
    _applySearch(query) {
      this._searchQuery = query.toLowerCase().trim();
      if (!this._searchQuery) {
        this._filtered = [...this._capabilities];
      } else {
        this._filtered = this._capabilities.filter(cap => {
          const hay = [cap.name, cap.description, ...(cap.tags || [])].join(' ').toLowerCase();
          return hay.includes(this._searchQuery);
        });
      }
      this._renderList();
    }

    /* ---- Clipboard ---- */
    async _copyInstall(id, btn) {
      const cmd = `scsp install ${id}`;
      try {
        await navigator.clipboard.writeText(cmd);
      } catch (_) {
        const ta = document.createElement('textarea');
        ta.value = cmd;
        ta.style.cssText = 'position:fixed;opacity:0;';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      if (btn) {
        const orig = btn.innerHTML;
        btn.classList.add('copied');
        btn.textContent = 'Copied!';
        setTimeout(() => {
          btn.classList.remove('copied');
          btn.innerHTML = orig;
        }, 2000);
      }
    }

    /* ---- Render ---- */
    _updateStyles() {
      const styleEl = this._shadow.querySelector('style');
      if (styleEl) {
        styleEl.textContent = buildStyles(isDark(this.getAttribute('theme')));
      }
    }

    _render() {
      const dark = isDark(this.getAttribute('theme'));
      const maxHeight = this.getAttribute('max-height') || '500px';
      const communityUrl = this.getAttribute('community-url') || 'https://scsp.dev/community';

      this._shadow.innerHTML = `
        <style>${buildStyles(dark)}</style>
        <div class="widget" role="region" aria-label="SCSP Community Capabilities">
          <div class="widget-header">
            <div class="widget-brand">
              <div class="widget-logo" aria-hidden="true">SC</div>
              <div>
                <div class="widget-title">SCSP Community</div>
                <div class="widget-subtitle">Capability Browser</div>
              </div>
            </div>
            <a class="widget-open-link" href="${esc(communityUrl)}" target="_blank" rel="noopener noreferrer" aria-label="Open full community page">
              Open in browser ↗
            </a>
          </div>

          <div class="widget-search-wrap">
            <svg class="widget-search-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" /></svg>
            <input
              class="widget-search"
              type="search"
              placeholder="Search capabilities..."
              aria-label="Search capabilities"
              autocomplete="off"
              spellcheck="false"
            />
          </div>

          <div class="widget-list" style="max-height:${esc(maxHeight)};" id="scsp-list" role="list" aria-label="Capabilities">
            <div class="widget-loading" aria-busy="true">
              <div class="skeleton" style="height:18px;width:60%;"></div>
              <div class="skeleton" style="height:14px;width:100%;"></div>
              <div class="skeleton" style="height:14px;width:80%;margin-top:12px;"></div>
              <div class="skeleton" style="height:14px;width:100%;"></div>
            </div>
          </div>

          <div class="widget-footer">
            <span class="widget-footer-count" id="scsp-count" aria-live="polite"></span>
            <span class="widget-footer-brand">Powered by SCSP</span>
          </div>
        </div>
      `;

      // Search handler
      const searchInput = this._shadow.querySelector('.widget-search');
      let debounce;
      searchInput.addEventListener('input', e => {
        clearTimeout(debounce);
        debounce = setTimeout(() => this._applySearch(e.target.value), 200);
      });
    }

    _showLoading() {
      const list = this._shadow.getElementById('scsp-list');
      const count = this._shadow.getElementById('scsp-count');
      if (list) {
        list.innerHTML = `
          <div class="widget-loading" aria-busy="true">
            <div class="skeleton" style="height:18px;width:60%;"></div>
            <div class="skeleton" style="height:14px;width:100%;"></div>
            <div class="skeleton" style="height:14px;width:80%;margin-top:12px;"></div>
            <div class="skeleton" style="height:14px;width:100%;"></div>
          </div>`;
      }
      if (count) count.textContent = '';
    }

    _renderList() {
      const list = this._shadow.getElementById('scsp-list');
      const count = this._shadow.getElementById('scsp-count');
      if (!list) return;

      const dark = isDark(this.getAttribute('theme'));
      const layerColors = dark ? LAYER_COLORS_DARK : LAYER_COLORS;

      if (this._filtered.length === 0) {
        list.innerHTML = `<div class="widget-empty" role="status">No capabilities found</div>`;
        if (count) count.textContent = '0 results';
        return;
      }

      list.innerHTML = this._filtered.map(cap => {
        const lc = layerColors[cap.layer] || layerColors.module;
        const compat = cap.compatibility_score != null
          ? `${Math.round(cap.compatibility_score * 100)}%`
          : '—';
        const tags = (cap.tags || []).slice(0, 3)
          .map(t => `<span class="tag">${esc(t)}</span>`)
          .join('');
        const layerLabel = cap.layer
          ? cap.layer.charAt(0).toUpperCase() + cap.layer.slice(1)
          : 'Module';

        return `
          <div class="cap-item" role="listitem">
            <div class="cap-item-left">
              <div class="cap-item-header">
                <span class="cap-item-name" title="${esc(cap.name)}">${esc(cap.name)}</span>
                <span class="layer-badge" style="background:${lc.bg};color:${lc.text};" aria-label="Type: ${layerLabel}">${layerLabel}</span>
              </div>
              ${cap.description
                ? `<div class="cap-item-desc">${esc(cap.description)}</div>`
                : ''}
              ${tags ? `<div class="cap-item-tags">${tags}</div>` : ''}
            </div>
            <div class="cap-item-right">
              <div class="cap-item-stat"><b>${fmt(cap.active_installs)}</b> installs</div>
              <div class="cap-item-stat">★ <b>${compat}</b></div>
              <button class="copy-btn" data-id="${esc(cap.id)}" aria-label="Copy install command for ${esc(cap.name)}">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" width="10" height="10" aria-hidden="true"><path d="M5.5 3.5A1.5 1.5 0 017 2h2.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 01.439 1.061V9.5A1.5 1.5 0 0112 11h-1v1.5A1.5 1.5 0 019.5 14h-4A1.5 1.5 0 014 12.5v-7A1.5 1.5 0 015.5 4v-.5zM7 3a.5.5 0 00-.5.5v7a.5.5 0 00.5.5h4a.5.5 0 00.5-.5V5.621a.5.5 0 00-.146-.353L9.232 3.146A.5.5 0 008.879 3H7z"/><path d="M4.5 6a.5.5 0 00-.5.5v7a.5.5 0 00.5.5h4a.5.5 0 00.5-.5v-1H7A1.5 1.5 0 015.5 11V6H4.5z"/></svg>
                Install
              </button>
            </div>
          </div>`;
      }).join('');

      if (count) {
        count.textContent = `${this._filtered.length} ${this._filtered.length === 1 ? 'capability' : 'capabilities'}`;
      }

      // Attach copy button handlers
      list.querySelectorAll('.copy-btn[data-id]').forEach(btn => {
        btn.addEventListener('click', () => {
          this._copyInstall(btn.dataset.id, btn);
        });
      });
    }
  }

  /* -----------------------------------------------------------------------
     Register
     ----------------------------------------------------------------------- */
  if (!customElements.get('scsp-community')) {
    customElements.define('scsp-community', ScspCommunity);
  }

  console.info('[SCSP] <scsp-community> registered. v0.1.0');
})();
