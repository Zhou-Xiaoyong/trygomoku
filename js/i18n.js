/**
 * i18n Translation Engine for Gomoku Online
 * Supports: en, zh-CN
 * Usage: add data-i18n="key" to elements; translations in i18n/*.json
 */

const i18n = {
  currentLang: 'en',
  translations: {},
  fallbackLang: 'en',
  supportedLangs: ['en', 'zh-CN', 'ja-JP', 'ru-RU', 'ko-KR'],

  // Global translation helper (safe fallback: returns key if translation missing)
  _t(key, fallback) {
    const keys = key.split('.');
    let obj = this.translations;
    for (const k of keys) {
      if (obj == null) return fallback || key;
      obj = obj[k];
    }
    return obj !== undefined ? obj : (fallback || key);
  },

  async init() {
    this.currentLang = this.detectLanguage();
    await this.loadTranslations(this.currentLang);
    this.applyAll();
    this.initSwitcher();
    // Notify other scripts (e.g. game.js) that translations are ready
    document.dispatchEvent(new CustomEvent('i18n-ready'));
  },

  detectLanguage() {
    // 1. URL path: /zh-CN/, /zh-CN/index.html, etc.
    //    URL路径是语言的唯一真相来源，不受 localStorage 影响
    const pathMatch = window.location.pathname.match(/^\/([a-z]{2}(-[A-Z]{2})?)(?:\/|$)/);
    if (pathMatch && this.supportedLangs.includes(pathMatch[1])) return pathMatch[1];
    // 2. URL param: ?lang=zh-CN
    const params = new URLSearchParams(window.location.search);
    if (params.get('lang') && this.supportedLangs.includes(params.get('lang'))) return params.get('lang');
    // 3. 默认英文（不读取 localStorage，避免中英文页面混乱）
    return 'en';
  },

  async loadTranslations(lang) {
    this.currentLang = lang;
    localStorage.setItem('gomoku-lang', lang);
    document.documentElement.lang = lang;
    if (lang === 'en') { this.translations = {}; return; }
    try {
      // Use absolute path from site root, works for both / and /zh-CN/ etc.
      const resp = await fetch(`/i18n/${lang}.json`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      this.translations = await resp.json();
    } catch (e) {
      console.warn(`[i18n] Failed to load ${lang}.json`, e);
      this.translations = {};
    }
  },

  get(key) {
    const keys = key.split('.');
    let obj = this.translations;
    for (const k of keys) {
      if (obj == null) return undefined;
      obj = obj[k];
    }
    return obj;
  },

  applyAll() {
    if (this.currentLang === 'en') return;

    // Handle <title> separately via document.title
    const titleEl = document.querySelector('title[data-i18n]');
    if (titleEl) {
      const key = titleEl.getAttribute('data-i18n');
      const text = this.get(key);
      if (text !== undefined) document.title = text;
    }

    // Handle [data-i18n] — body elements only (skip <title> and <meta>)
    document.querySelectorAll('[data-i18n]').forEach(el => {
      if (el.tagName === 'TITLE' || el.tagName === 'META') return;
      const key = el.getAttribute('data-i18n');
      const text = this.get(key);
      if (text !== undefined) el.textContent = text;
    });

    // Handle [data-i18n-attr] — for <meta content="..."> attributes
    document.querySelectorAll('[data-i18n-attr]').forEach(el => {
      const attr = el.getAttribute('data-i18n-attr');
      const key = el.getAttribute('data-i18n');
      const text = this.get(key);
      if (attr && text !== undefined) el.setAttribute(attr, text);
    });

    // Handle [data-i18n-html]
    document.querySelectorAll('[data-i18n-html]').forEach(el => {
      const key = el.getAttribute('data-i18n-html');
      const html = this.get(key);
      if (html !== undefined) el.innerHTML = html;
    });

    // Handle [data-i18n-placeholder]
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      const text = this.get(key);
      if (text !== undefined) el.placeholder = text;
    });

    // Handle [data-i18n-aria]
    document.querySelectorAll('[data-i18n-aria]').forEach(el => {
      const key = el.getAttribute('data-i18n-aria');
      const text = this.get(key);
      if (text !== undefined) el.setAttribute('aria-label', text);
    });
  },

  initSwitcher() {
    const sel = document.getElementById('langSwitcher');
    if (!sel) return;
    sel.value = this.currentLang;
    // Remove any existing handler to avoid duplicates
    sel.onchange = null;
    sel.onchange = (e) => {
      const lang = sel.value;
      if (lang === 'en') {
        // Always go to site root for English
        window.location.href = '/';
      } else {
        // Navigate to language subdirectory
        window.location.href = '/' + lang + '/';
      }
    };
  }
};

// Global translation helper — safe to call from game.js even before i18n.init()
// Supports optional fallback: __t('key') or __t('key', 'fallback')
window.__t = function(key, fallback) {
  return i18n._t(key, fallback);
};

document.addEventListener('DOMContentLoaded', () => i18n.init());
