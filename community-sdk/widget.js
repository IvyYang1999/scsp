/**
 * SCSP Community Widget — widget.js
 * Self-contained web component: <scsp-community>
 *
 * Attributes:
 *   registry      — URL to registry/index.json
 *   theme         — "light" | "dark" | "auto" (default: "auto")
 *   max-height    — CSS max-height for the scrollable list (default: "500px")
 *   community-url — URL for the "Open in browser" link
 *   registry-base — Base URL for fetching .scsp files (used for intent preview)
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
      description: 'Adds RFC 6238-compliant TOTP 2FA to any SCSP-compatible app\'s login flow. Includes brute-force lockout, single-use recovery codes, and OWASP ASVS 2.8 compliance constraints.',
      tags: ['auth', 'security', 'mfa', '2fa'],
      active_installs: 147,
      compatibility_score: 0.94,
      rollback_rate: 0.006,
      signed: true,
      author_name: 'Alice Chen',
    },
    {
      id: 'calendar-week-view-v1',
      name: 'Calendar Week View',
      version: '1.2.0',
      layer: 'component',
      description: '7-day week view with drag-and-drop event rescheduling. Works with React, Vue, Svelte. Zero external dependencies beyond the host UI framework.',
      tags: ['ui', 'calendar', 'scheduling'],
      active_installs: 89,
      compatibility_score: 0.91,
      rollback_rate: 0.011,
      signed: true,
      author_name: 'Marco Rossi',
    },
    {
      id: 'approval-workflow-v1',
      name: 'Approval Workflow State Machine',
      version: '2.0.1',
      layer: 'behavior',
      description: 'Multi-step approval state machine (draft → review → approved/rejected) with audit trail and email notifications. Supports configurable approver chains.',
      tags: ['workflow', 'approval', 'audit'],
      active_installs: 203,
      compatibility_score: 0.88,
      rollback_rate: 0.036,
      signed: true,
      author_name: 'Priya Sharma',
    },
    {
      id: 'perf-image-lazy-load-v1',
      name: 'Image Lazy Loading',
      version: '1.0.3',
      layer: 'improvement',
      description: 'IntersectionObserver-based lazy loading. Zero dependencies, progressive enhancement. Reduces initial page load by up to 60% on media-rich screens.',
      tags: ['performance', 'images', 'optimization'],
      active_installs: 412,
      compatibility_score: 0.97,
      rollback_rate: 0.005,
      signed: true,
      author_name: 'Kai Müller',
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
      bgQuad:     dark ? '#1e293b' : '#ffffff',
      surface:    dark ? '#1e293b' : '#ffffff',
      border:     dark ? '#334155' : '#e2e8f0',
      borderSub:  dark ? '#1e293b' : '#f1f5f9',
      text:       dark ? '#f1f5f9' : '#0f172a',
      textSec:    dark ? '#94a3b8' : '#475569',
      textMuted:  dark ? '#64748b' : '#94a3b8',
      primary:    dark ? '#818cf8' : '#6366f1',
      primaryHov: dark ? '#6366f1' : '#4f46e5',
      primaryLt:  dark ? '#1e1b4b' : '#e0e7ff',
      success:    dark ? '#6ee7b7' : '#10b981',
      successBg:  dark ? '#064e3b' : '#ecfdf5',
      warning:    dark ? '#fcd34d' : '#f59e0b',
      tag:        dark ? '#334155' : '#f1f5f9',
      mono:       "'JetBrains Mono', 'Fira Code', ui-monospace, monospace",
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

      /* ── Header ── */
      .widget-header {
        padding: 12px 14px;
        border-bottom: 1px solid ${c.border};
        background: ${c.bgSec};
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        flex-shrink: 0;
      }

      .widget-brand { display: flex; align-items: center; gap: 8px; }

      .widget-logo {
        width: 26px; height: 26px;
        background: linear-gradient(135deg, ${c.primary}, ${dark ? '#3730a3' : '#4f46e5'});
        border-radius: 7px;
        display: flex; align-items: center; justify-content: center;
        font-size: 9px; font-weight: 800; color: #fff; flex-shrink: 0;
        box-shadow: 0 2px 6px rgba(99,102,241,${dark ? '0.4' : '0.25'});
      }

      .widget-title { font-weight: 700; font-size: 13px; color: ${c.text}; letter-spacing: -0.01em; }
      .widget-subtitle { font-size: 11px; color: ${c.textMuted}; }

      .widget-open-link {
        font-size: 11px; font-weight: 600; color: ${c.primary};
        text-decoration: none; padding: 4px 8px; border-radius: 6px;
        border: 1px solid ${c.border}; background: ${c.surface};
        white-space: nowrap; flex-shrink: 0; transition: background 0.15s;
      }
      .widget-open-link:hover { background: ${c.primaryLt}; }

      /* ── Search ── */
      .widget-search-wrap {
        padding: 10px 12px;
        border-bottom: 1px solid ${c.border};
        background: ${c.surface};
        position: relative;
        flex-shrink: 0;
      }

      .widget-search-icon {
        position: absolute; left: 22px; top: 50%; transform: translateY(-50%);
        color: ${c.textMuted}; pointer-events: none; width: 14px; height: 14px;
      }

      .widget-search {
        width: 100%; padding: 7px 10px 7px 30px;
        border: 1.5px solid ${c.border}; border-radius: 8px;
        background: ${c.bgSec}; color: ${c.text};
        font-family: inherit; font-size: 13px; outline: none;
        transition: border-color 0.15s, box-shadow 0.15s;
      }
      .widget-search::placeholder { color: ${c.textMuted}; }
      .widget-search:focus {
        border-color: ${c.primary};
        box-shadow: 0 0 0 3px ${dark ? 'rgba(99,102,241,0.25)' : 'rgba(99,102,241,0.15)'};
      }

      /* ── List ── */
      .widget-list {
        overflow-y: auto; flex: 1; padding: 6px;
        display: flex; flex-direction: column; gap: 2px;
      }

      .widget-list::-webkit-scrollbar { width: 4px; }
      .widget-list::-webkit-scrollbar-track { background: transparent; }
      .widget-list::-webkit-scrollbar-thumb { background: ${c.border}; border-radius: 4px; }

      /* ── Capability Item ── */
      .cap-item {
        border-radius: 8px;
        border: 1.5px solid transparent;
        overflow: hidden;
        transition: border-color 0.15s;
      }

      .cap-item.expanded {
        border-color: ${c.primary};
        box-shadow: 0 0 0 3px ${dark ? 'rgba(99,102,241,0.15)' : 'rgba(99,102,241,0.08)'};
      }

      .cap-item-row {
        display: flex; align-items: flex-start; justify-content: space-between;
        padding: 10px 12px; gap: 10px;
        cursor: pointer;
        background: transparent;
        transition: background 0.12s;
        user-select: none;
      }

      .cap-item-row:hover { background: ${c.bgSec}; }
      .cap-item.expanded .cap-item-row { background: ${c.bgSec}; }

      .cap-item-left { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
      .cap-item-header { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }

      .cap-item-name {
        font-weight: 600; font-size: 13px; color: ${c.text};
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }

      .layer-badge {
        display: inline-flex; padding: 2px 6px; border-radius: 100px;
        font-size: 10px; font-weight: 700; text-transform: uppercase;
        letter-spacing: 0.04em; flex-shrink: 0;
      }

      .cap-item-meta { font-size: 11px; color: ${c.textMuted}; }

      .cap-item-desc {
        font-size: 12px; color: ${c.textSec}; line-height: 1.4;
        display: -webkit-box; -webkit-line-clamp: 2;
        -webkit-box-orient: vertical; overflow: hidden;
      }

      .cap-item-tags { display: flex; flex-wrap: wrap; gap: 3px; }

      .tag {
        display: inline-flex; padding: 1px 6px; border-radius: 100px;
        font-size: 10px; background: ${c.tag}; color: ${c.textSec};
      }

      .cap-item-right {
        display: flex; flex-direction: column; align-items: flex-end;
        gap: 5px; flex-shrink: 0;
      }

      .cap-item-stat { font-size: 11px; color: ${c.textMuted}; white-space: nowrap; }
      .cap-item-stat b { color: ${c.text}; }
      .cap-item-stat.compat b { color: ${c.success}; }

      .expand-chevron {
        width: 14px; height: 14px; color: ${c.textMuted};
        transition: transform 0.2s; flex-shrink: 0; margin-top: 2px;
      }
      .cap-item.expanded .expand-chevron { transform: rotate(180deg); }

      /* ── Detail Panel ── */
      .cap-detail {
        display: none;
        background: ${c.bgSec};
        border-top: 1px solid ${c.border};
        padding: 12px 14px;
        flex-direction: column;
        gap: 12px;
      }
      .cap-item.expanded .cap-detail { display: flex; }

      /* Install tabs */
      .install-tabs { display: flex; gap: 0; border-radius: 8px; overflow: hidden; border: 1.5px solid ${c.border}; }

      .install-tab {
        flex: 1; padding: 6px 0; border: none; background: ${c.bgTer};
        color: ${c.textMuted}; font-size: 11px; font-weight: 600;
        font-family: inherit; cursor: pointer; transition: background 0.12s, color 0.12s;
        letter-spacing: 0.02em; text-transform: uppercase;
      }
      .install-tab:first-child { border-right: 1px solid ${c.border}; }
      .install-tab.active { background: ${c.primary}; color: #fff; }
      .install-tab:hover:not(.active) { background: ${c.bg}; color: ${c.text}; }

      .install-cmd-wrap {
        display: flex; align-items: center; justify-content: space-between;
        padding: 8px 10px; gap: 8px;
        background: ${c.bg}; border: 1.5px solid ${c.border};
        border-radius: 8px;
      }

      .install-cmd {
        font-family: ${c.mono};
        font-size: 12px; color: ${c.text};
        flex: 1; min-width: 0; overflow: hidden;
        text-overflow: ellipsis; white-space: nowrap;
      }

      .copy-btn {
        display: inline-flex; align-items: center; gap: 4px;
        padding: 4px 8px; border-radius: 6px; font-size: 11px; font-weight: 600;
        background: ${c.primary}; color: #fff; border: none; cursor: pointer;
        font-family: inherit; transition: background 0.12s, transform 0.1s;
        white-space: nowrap; flex-shrink: 0;
      }
      .copy-btn:hover { background: ${c.primaryHov}; }
      .copy-btn:active { transform: scale(0.95); }
      .copy-btn.copied { background: ${c.success}; }

      /* Badges */
      .detail-badges { display: flex; flex-wrap: wrap; gap: 5px; }

      .review-badge {
        display: inline-flex; align-items: center; gap: 3px;
        padding: 3px 8px; border-radius: 100px;
        font-size: 10px; font-weight: 600;
        background: ${c.successBg}; color: ${c.success};
        border: 1px solid ${c.success};
      }

      .detail-section-label {
        font-size: 10px; font-weight: 700; text-transform: uppercase;
        letter-spacing: 0.06em; color: ${c.textMuted};
        margin-bottom: 4px;
      }

      /* Intent preview */
      .intent-preview {
        background: ${c.bg}; border: 1.5px solid ${c.border};
        border-radius: 8px; overflow: hidden;
      }

      .intent-preview-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 6px 10px; border-bottom: 1px solid ${c.border};
        background: ${c.bgTer};
      }

      .intent-preview-label {
        font-size: 10px; font-weight: 700; text-transform: uppercase;
        letter-spacing: 0.06em; color: ${c.textMuted};
      }

      .intent-preview-body {
        padding: 10px; font-size: 12px; color: ${c.textSec};
        line-height: 1.55; max-height: 100px; overflow: hidden;
        position: relative;
      }

      .intent-preview-fade {
        position: absolute; bottom: 0; left: 0; right: 0; height: 28px;
        background: linear-gradient(to bottom, transparent, ${c.bg});
        pointer-events: none;
      }

      .intent-loading {
        padding: 10px; font-size: 11px; color: ${c.textMuted};
        font-style: italic;
      }

      /* Stats row in detail */
      .detail-stats {
        display: flex; gap: 12px; flex-wrap: wrap;
      }

      .detail-stat {
        display: flex; flex-direction: column; align-items: center;
        padding: 6px 10px; border-radius: 7px;
        background: ${c.bg}; border: 1px solid ${c.border};
        min-width: 60px;
      }

      .detail-stat-value { font-size: 14px; font-weight: 700; color: ${c.text}; }
      .detail-stat-value.good { color: ${c.success}; }
      .detail-stat-value.warn { color: ${c.warning}; }
      .detail-stat-label { font-size: 10px; color: ${c.textMuted}; margin-top: 1px; }

      /* Footer */
      .widget-footer {
        padding: 8px 12px; border-top: 1px solid ${c.border};
        background: ${c.bgSec}; display: flex; align-items: center;
        justify-content: space-between; gap: 8px; flex-shrink: 0;
      }

      .widget-footer-count { font-size: 11px; color: ${c.textMuted}; }
      .widget-footer-brand { font-size: 10px; color: ${c.textMuted}; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }

      /* Loading / empty */
      .widget-empty { padding: 28px 16px; text-align: center; color: ${c.textMuted}; font-size: 13px; }

      .widget-loading { padding: 20px; display: flex; flex-direction: column; gap: 8px; }

      @keyframes shimmer {
        from { background-position: 200% 0; }
        to   { background-position: -200% 0; }
      }

      .skeleton {
        border-radius: 6px;
        background: linear-gradient(90deg, ${c.bgTer} 25%, ${c.bgSec} 50%, ${c.bgTer} 75%);
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
      return ['registry', 'theme', 'max-height', 'registry-base'];
    }

    constructor() {
      super();
      this._shadow = this.attachShadow({ mode: 'open' });
      this._capabilities = [];
      this._filtered = [];
      this._expandedId = null;
      this._activeTab = {}; // id → 'cli' | 'skill'
      this._intentCache = {}; // id → intent text or null
      this._abortController = null;
    }

    connectedCallback() {
      this._render();
      this._fetchCapabilities();

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
      if (this._abortController) this._abortController.abort();
    }

    attributeChangedCallback(name) {
      if (name === 'registry') {
        this._fetchCapabilities();
      } else {
        this._updateStyles();
      }
    }

    /* ── Data Fetch ── */
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
            'https://raw.githubusercontent.com/IvyYang1999/scsp/main/registry/index.json'
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

    /* ── Intent Fetch ── */
    async _fetchIntent(id) {
      if (this._intentCache[id] !== undefined) return this._intentCache[id];

      // Try to figure out registry base
      const registryBase = this.getAttribute('registry-base')
        || this.getAttribute('registry')?.replace(/\/index\.json$/, '')
        || 'https://raw.githubusercontent.com/IvyYang1999/scsp/main/registry';

      const url = `${registryBase}/capabilities/${id}/${id}.scsp`;

      try {
        const res = await fetch(url, { cache: 'no-cache' });
        if (!res.ok) throw new Error('not found');
        const text = await res.text();
        const match = text.match(/##\s+Intent\s*([\s\S]*?)(?=\n##|\n```yaml|\n---|\s*$)/i);
        const intent = match ? match[1].trim().replace(/\n{3,}/g, '\n\n') : null;
        this._intentCache[id] = intent;
        return intent;
      } catch {
        this._intentCache[id] = null;
        return null;
      }
    }

    /* ── Search ── */
    _applySearch(query) {
      const q = query.toLowerCase().trim();
      if (!q) {
        this._filtered = [...this._capabilities];
      } else {
        this._filtered = this._capabilities.filter(cap => {
          const hay = [cap.name, cap.description, ...(cap.tags || [])].join(' ').toLowerCase();
          return hay.includes(q);
        });
      }
      this._expandedId = null;
      this._renderList();
    }

    /* ── Toggle Expand ── */
    _toggleExpand(id) {
      if (this._expandedId === id) {
        this._expandedId = null;
      } else {
        this._expandedId = id;
        if (!this._activeTab[id]) this._activeTab[id] = 'cli';
        // Kick off intent fetch (non-blocking)
        this._loadIntent(id);
      }
      this._renderList();
    }

    async _loadIntent(id) {
      if (this._intentCache[id] !== undefined) return;
      const intent = await this._fetchIntent(id);
      // Update intent preview if still expanded
      if (this._expandedId === id) {
        const el = this._shadow.querySelector(`[data-intent="${id}"]`);
        if (el) {
          if (intent) {
            el.innerHTML = `<div class="intent-preview-body">${esc(intent)}<div class="intent-preview-fade"></div></div>`;
          } else {
            el.innerHTML = `<div class="intent-loading">Intent preview not available.</div>`;
          }
        }
      }
    }

    /* ── Clipboard ── */
    async _copyCmd(cmd, btn) {
      try {
        await navigator.clipboard.writeText(cmd);
      } catch (_) {
        const ta = document.createElement('textarea');
        ta.value = cmd; ta.style.cssText = 'position:fixed;opacity:0;';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); ta.remove();
      }
      if (btn) {
        const orig = btn.innerHTML;
        btn.classList.add('copied');
        btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="10" height="10"><path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd"/></svg> Copied!`;
        setTimeout(() => { btn.classList.remove('copied'); btn.innerHTML = orig; }, 2000);
      }
    }

    /* ── Switch Tab ── */
    _switchTab(id, tab) {
      this._activeTab[id] = tab;
      const detail = this._shadow.querySelector(`[data-detail="${id}"]`);
      if (!detail) return;

      const tabs = detail.querySelectorAll('.install-tab');
      const dark = isDark(this.getAttribute('theme'));
      const lc = (dark ? LAYER_COLORS_DARK : LAYER_COLORS);
      const cap = this._capabilities.find(c => c.id === id);
      if (!cap) return;

      tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tab));

      const cmdWrap = detail.querySelector('.install-cmd-wrap');
      if (!cmdWrap) return;

      const cmd = tab === 'skill' ? `/scsp-install ${id}` : `scsp install ${id}`;
      const hint = tab === 'skill'
        ? `<span style="font-size:10px;color:${lc.module?.text || '#6366f1'};margin-left:4px;">Claude Code</span>`
        : '';
      cmdWrap.querySelector('.install-cmd').textContent = cmd;
      const existingHint = cmdWrap.querySelector('.cmd-hint');
      if (existingHint) existingHint.remove();
      if (hint) cmdWrap.insertAdjacentHTML('beforeend', `<span class="cmd-hint">${hint}</span>`);

      cmdWrap.querySelector('.copy-btn').onclick = () => {
        this._copyCmd(cmd, cmdWrap.querySelector('.copy-btn'));
      };
    }

    /* ── Styles update ── */
    _updateStyles() {
      const styleEl = this._shadow.querySelector('style');
      if (styleEl) styleEl.textContent = buildStyles(isDark(this.getAttribute('theme')));
    }

    /* ── Full Render ── */
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
              Browse all ↗
            </a>
          </div>

          <div class="widget-search-wrap">
            <svg class="widget-search-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"/></svg>
            <input class="widget-search" type="search" placeholder="Search capabilities..." aria-label="Search capabilities" autocomplete="off" spellcheck="false"/>
          </div>

          <div class="widget-list" style="max-height:${esc(maxHeight)};" id="scsp-list" role="list" aria-label="Capabilities">
            <div class="widget-loading" aria-busy="true">
              <div class="skeleton" style="height:18px;width:60%;"></div>
              <div class="skeleton" style="height:14px;width:100%;"></div>
              <div class="skeleton" style="height:14px;width:80%;margin-top:10px;"></div>
              <div class="skeleton" style="height:14px;width:100%;"></div>
            </div>
          </div>

          <div class="widget-footer">
            <span class="widget-footer-count" id="scsp-count" aria-live="polite"></span>
            <span class="widget-footer-brand">Powered by SCSP</span>
          </div>
        </div>
      `;

      const searchInput = this._shadow.querySelector('.widget-search');
      let debounce;
      searchInput.addEventListener('input', e => {
        clearTimeout(debounce);
        debounce = setTimeout(() => this._applySearch(e.target.value), 200);
      });

      if (this._filtered.length > 0) this._renderList();
    }

    _showLoading() {
      const list = this._shadow.getElementById('scsp-list');
      const count = this._shadow.getElementById('scsp-count');
      if (list) {
        list.innerHTML = `
          <div class="widget-loading" aria-busy="true">
            <div class="skeleton" style="height:18px;width:60%;"></div>
            <div class="skeleton" style="height:14px;width:100%;"></div>
            <div class="skeleton" style="height:14px;width:80%;margin-top:10px;"></div>
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
          ? `${Math.round(cap.compatibility_score * 100)}%` : '—';
        const rollback = cap.rollback_rate != null
          ? `${(cap.rollback_rate * 100).toFixed(1)}%` : '—';
        const tags = (cap.tags || []).slice(0, 3)
          .map(t => `<span class="tag">${esc(t)}</span>`).join('');
        const layerLabel = cap.layer
          ? cap.layer.charAt(0).toUpperCase() + cap.layer.slice(1)
          : 'Module';
        const isExpanded = this._expandedId === cap.id;
        const activeTab = this._activeTab[cap.id] || 'cli';
        const cliCmd = `scsp install ${cap.id}`;
        const skillCmd = `/scsp-install ${cap.id}`;
        const currentCmd = activeTab === 'skill' ? skillCmd : cliCmd;

        // Intent preview content
        const intentContent = this._intentCache[cap.id]
          ? `<div class="intent-preview-body">${esc(this._intentCache[cap.id])}<div class="intent-preview-fade"></div></div>`
          : this._intentCache[cap.id] === null
            ? `<div class="intent-loading">Intent preview not available.</div>`
            : `<div class="intent-loading">Loading intent…</div>`;

        return `
          <div class="cap-item${isExpanded ? ' expanded' : ''}" role="listitem" data-id="${esc(cap.id)}">

            <!-- Collapsed row (always visible) -->
            <div class="cap-item-row" data-toggle="${esc(cap.id)}" tabindex="0" role="button"
                 aria-expanded="${isExpanded}" aria-label="${esc(cap.name)}">
              <div class="cap-item-left">
                <div class="cap-item-header">
                  <span class="cap-item-name">${esc(cap.name)}</span>
                  <span class="layer-badge" style="background:${lc.bg};color:${lc.text};">${layerLabel}</span>
                </div>
                ${cap.description
                  ? `<div class="cap-item-desc">${esc(cap.description)}</div>`
                  : ''}
                ${tags ? `<div class="cap-item-tags">${tags}</div>` : ''}
              </div>
              <div class="cap-item-right">
                <div class="cap-item-stat"><b>${fmt(cap.active_installs)}</b> installs</div>
                <div class="cap-item-stat compat">★ <b>${compat}</b></div>
                <svg class="expand-chevron" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5"/>
                </svg>
              </div>
            </div>

            <!-- Expanded detail panel -->
            <div class="cap-detail" data-detail="${esc(cap.id)}">

              <!-- Install command with CLI / Claude Code tabs -->
              <div>
                <div class="detail-section-label">Install</div>
                <div style="margin-top:6px;">
                  <div class="install-tabs">
                    <button class="install-tab${activeTab === 'cli' ? ' active' : ''}" data-tab="cli" data-id="${esc(cap.id)}">CLI</button>
                    <button class="install-tab${activeTab === 'skill' ? ' active' : ''}" data-tab="skill" data-id="${esc(cap.id)}">Claude Code</button>
                  </div>
                  <div class="install-cmd-wrap" style="margin-top:6px;">
                    <span class="install-cmd">${esc(currentCmd)}</span>
                    <button class="copy-btn" aria-label="Copy install command" data-copy="${esc(currentCmd)}">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" width="10" height="10" aria-hidden="true"><path d="M5.5 3.5A1.5 1.5 0 017 2h2.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 01.439 1.061V9.5A1.5 1.5 0 0112 11h-1v1.5A1.5 1.5 0 019.5 14h-4A1.5 1.5 0 014 12.5v-7A1.5 1.5 0 015.5 4v-.5zM7 3a.5.5 0 00-.5.5v7a.5.5 0 00.5.5h4a.5.5 0 00.5-.5V5.621a.5.5 0 00-.146-.353L9.232 3.146A.5.5 0 008.879 3H7z"/><path d="M4.5 6a.5.5 0 00-.5.5v7a.5.5 0 00.5.5h4a.5.5 0 00.5-.5v-1H7A1.5 1.5 0 015.5 11V6H4.5z"/></svg>
                      Copy
                    </button>
                  </div>
                </div>
              </div>

              <!-- Stats row -->
              <div>
                <div class="detail-section-label">Community Stats</div>
                <div class="detail-stats" style="margin-top:6px;">
                  <div class="detail-stat">
                    <span class="detail-stat-value good">${compat}</span>
                    <span class="detail-stat-label">Compat</span>
                  </div>
                  <div class="detail-stat">
                    <span class="detail-stat-value">${fmt(cap.active_installs)}</span>
                    <span class="detail-stat-label">Installs</span>
                  </div>
                  <div class="detail-stat">
                    <span class="detail-stat-value${cap.rollback_rate > 0.05 ? ' warn' : ''}">${rollback}</span>
                    <span class="detail-stat-label">Rollback</span>
                  </div>
                  ${cap.signed ? `<div class="detail-stat"><span class="detail-stat-value good">✓</span><span class="detail-stat-label">Signed</span></div>` : ''}
                </div>
              </div>

              <!-- Intent preview -->
              <div>
                <div class="intent-preview">
                  <div class="intent-preview-header">
                    <span class="intent-preview-label">What this installs</span>
                    ${cap.author_name ? `<span style="font-size:10px;color:var(--primary)">by ${esc(cap.author_name)}</span>` : ''}
                  </div>
                  <div data-intent="${esc(cap.id)}">${intentContent}</div>
                </div>
              </div>

            </div>
          </div>`;
      }).join('');

      if (count) {
        count.textContent = `${this._filtered.length} ${this._filtered.length === 1 ? 'capability' : 'capabilities'}`;
      }

      // ── Event delegation ──
      list.addEventListener('click', e => {
        // Toggle row
        const toggleEl = e.target.closest('[data-toggle]');
        if (toggleEl) {
          this._toggleExpand(toggleEl.dataset.toggle);
          return;
        }
        // Tab switch
        const tabEl = e.target.closest('.install-tab');
        if (tabEl) {
          e.stopPropagation();
          this._switchTab(tabEl.dataset.id, tabEl.dataset.tab);
          return;
        }
        // Copy button
        const copyEl = e.target.closest('.copy-btn');
        if (copyEl) {
          e.stopPropagation();
          const cmd = copyEl.dataset.copy || copyEl.closest('.install-cmd-wrap')?.querySelector('.install-cmd')?.textContent;
          if (cmd) this._copyCmd(cmd, copyEl);
          return;
        }
      });

      // Keyboard: Enter/Space on row toggles expand
      list.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          const toggleEl = e.target.closest('[data-toggle]');
          if (toggleEl) { e.preventDefault(); this._toggleExpand(toggleEl.dataset.toggle); }
        }
      });
    }
  }

  /* -----------------------------------------------------------------------
     Register
     ----------------------------------------------------------------------- */
  if (!customElements.get('scsp-community')) {
    customElements.define('scsp-community', ScspCommunity);
  }

  console.info('[SCSP] <scsp-community> registered. v0.2.0');
})();
