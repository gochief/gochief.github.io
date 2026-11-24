const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../js/i18n.js'), 'utf8');

function element(attributes = {}) {
  const listeners = new Map();
  return {
    hidden: true,
    getAttribute: name => attributes[name],
    setAttribute(name, value) { attributes[name] = value; },
    addEventListener(name, callback) { listeners.set(name, callback); },
    dispatch(name, event) { if (listeners.has(name)) listeners.get(name)(event); }
  };
}

function page(options = {}) {
  const storage = new Map(options.saved ? [['gochief.language', options.saved]] : []);
  const button = element({ 'data-i18n': 'switch_language', 'data-i18n-attr': 'aria-label' });
  const navigation = element({ 'data-i18n': 'main_navigation', 'data-i18n-attr': 'aria-label' });
  const metadata = Object.fromEntries([
    'meta[name="description"]', 'meta[property="og:title"]', 'meta[property="og:description"]',
    'meta[property="og:locale"]', 'meta[name="twitter:title"]', 'meta[name="twitter:description"]'
  ].map(selector => [selector, element()]));
  const translations = {
    messages: {
      zh: { switch_language: 'Switch to English', main_navigation: '主导航' },
      en: { switch_language: '切换为中文', main_navigation: 'Main navigation' }
    },
    page: {
      zh: { title: '关于 - gochief', description: '中文介绍', locale: 'zh_CN' },
      en: { title: 'About - gochief', description: 'English introduction', locale: 'en_US' }
    }
  };
  const posted = [];
  const comments = element();
  const document = Object.assign(element(), {
    readyState: options.loading ? 'loading' : 'complete',
    documentElement: { lang: 'zh-CN' },
    getElementById(id) {
      if (id === 'site-translations') return { textContent: options.data || JSON.stringify(translations) };
      if (id === 'J_language_toggle') return button;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-i18n-attr]') return [button, navigation];
      if (selector === 'iframe.giscus-frame') return [{ contentWindow: { postMessage: (...args) => posted.push(args) } }];
      return [];
    },
    querySelector(selector) {
      return selector.includes('giscus.app/client.js') ? comments : metadata[selector];
    }
  });
  const window = Object.assign(element(), {
    navigator: { language: options.browserLanguage || 'zh-CN' },
    localStorage: {
      getItem(key) {
        if (options.blockStorage) throw new Error('Storage disabled');
        return storage.get(key) || null;
      },
      setItem(key, value) {
        if (options.blockStorage) throw new Error('Storage disabled');
        storage.set(key, value);
      }
    }
  });
  vm.runInNewContext(source, { window, document });
  return { window, document, storage, button, navigation, metadata, posted, comments };
}

test('restores saved preference before content is parsed', () => {
  const result = page({ saved: 'en', loading: true });
  assert.equal(result.document.documentElement.lang, 'en');
  assert.equal(result.button.hidden, true);
  result.document.dispatch('DOMContentLoaded');
  assert.equal(result.button.hidden, false);
  assert.equal(result.document.title, 'About - gochief');
});

test('switches both ways and persists the choice for later pages', () => {
  const result = page();
  assert.equal(result.document.documentElement.lang, 'zh-CN');
  result.button.dispatch('click');
  assert.equal(result.document.documentElement.lang, 'en');
  assert.equal(result.storage.get('gochief.language'), 'en');
  assert.equal(result.document.title, 'About - gochief');
  assert.equal(result.navigation.getAttribute('aria-label'), 'Main navigation');
  assert.equal(result.metadata['meta[property="og:locale"]'].getAttribute('content'), 'en_US');
  assert.equal(result.metadata['meta[name="description"]'].getAttribute('content'), 'English introduction');
  assert.equal(result.comments.getAttribute('data-lang'), 'en');
  assert.equal(result.posted.at(-1)[1], 'https://giscus.app');
  assert.equal(page({ saved: result.storage.get('gochief.language') }).document.documentElement.lang, 'en');
  result.button.dispatch('click');
  assert.equal(result.document.documentElement.lang, 'zh-CN');
  assert.equal(result.storage.get('gochief.language'), 'zh');
  assert.equal(result.document.title, '关于 - gochief');
});

test('uses the browser language on first visit and ignores unsupported preferences', () => {
  assert.equal(page({ browserLanguage: 'en-GB' }).document.documentElement.lang, 'en');
  assert.equal(page({ browserLanguage: 'fr-FR' }).document.documentElement.lang, 'zh-CN');
  assert.equal(page({ saved: 'invalid', browserLanguage: 'en-US' }).document.documentElement.lang, 'en');
  assert.equal(page({ saved: 'zh', browserLanguage: 'en-US' }).document.documentElement.lang, 'zh-CN');
});

test('still switches when storage is blocked', () => {
  const result = page({ blockStorage: true });
  assert.doesNotThrow(() => result.button.dispatch('click'));
  assert.equal(result.document.documentElement.lang, 'en');
});

test('synchronizes other tabs and rejects invalid storage events', () => {
  const result = page();
  result.window.dispatch('storage', { key: 'unrelated', newValue: 'en' });
  assert.equal(result.document.documentElement.lang, 'zh-CN');
  result.window.dispatch('storage', { key: 'gochief.language', newValue: 'en' });
  assert.equal(result.document.documentElement.lang, 'en');
  result.window.dispatch('storage', { key: 'gochief.language', newValue: 'invalid' });
  assert.equal(result.document.documentElement.lang, 'en');
  result.window.dispatch('storage', { key: 'gochief.language', newValue: null });
  assert.equal(result.document.documentElement.lang, 'zh-CN');
});

test('malformed translation data leaves the language control usable', () => {
  for (const data of ['{broken', 'null', '{}']) {
    const result = page({ data });
    assert.doesNotThrow(() => result.button.dispatch('click'));
    assert.equal(result.document.documentElement.lang, 'en');
  }
});
