(function () {
  'use strict';

  var storageKey = 'gochief.language';
  var language;
  var translations = { messages: {}, page: {} };

  function valid(value) {
    return value === 'zh' || value === 'en';
  }

  function browserLanguage() {
    return /^en\b/i.test((window.navigator && window.navigator.language) || '') ? 'en' : 'zh';
  }

  try {
    language = window.localStorage.getItem(storageKey);
  } catch (error) {
    // The switch still works when browser storage is unavailable.
  }
  if (!valid(language)) language = browserLanguage();
  document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';

  try {
    var data = document.getElementById('site-translations');
    if (data) {
      var parsed = JSON.parse(data.textContent);
      if (parsed && parsed.messages && parsed.page) translations = parsed;
    }
  } catch (error) {
    // Keep the readable HTML fallback if translation metadata is unavailable.
  }

  function applyLanguage(next, persist) {
    if (!valid(next)) return;
    language = next;
    document.documentElement.lang = next === 'en' ? 'en' : 'zh-CN';
    document.querySelectorAll('[data-language]').forEach(function (element) {
      element.hidden = element.getAttribute('data-language') !== next;
    });
    if (persist) {
      try { window.localStorage.setItem(storageKey, next); } catch (error) {}
    }

    var messages = translations.messages[next] || {};
    document.querySelectorAll('[data-i18n-attr]').forEach(function (element) {
      var attribute = element.getAttribute('data-i18n-attr');
      var key = element.getAttribute('data-i18n');
      if ((attribute === 'aria-label' || attribute === 'title') && messages[key]) {
        element.setAttribute(attribute, messages[key]);
      }
    });

    var page = translations.page[next];
    if (page) {
      document.title = page.title;
      [
        ['meta[name="description"]', page.description],
        ['meta[property="og:title"]', page.title],
        ['meta[property="og:description"]', page.description],
        ['meta[property="og:locale"]', page.locale],
        ['meta[name="twitter:title"]', page.title],
        ['meta[name="twitter:description"]', page.description]
      ].forEach(function (item) {
        var element = document.querySelector(item[0]);
        if (element) element.setAttribute('content', item[1]);
      });
    }

    var button = document.getElementById('J_language_toggle');
    if (button) button.hidden = false;

    var comments = document.querySelector('script[src="https://giscus.app/client.js"]');
    if (comments) comments.setAttribute('data-lang', next === 'en' ? 'en' : 'zh-CN');
    document.querySelectorAll('iframe.giscus-frame').forEach(function (frame) {
      if (frame.contentWindow) {
        frame.contentWindow.postMessage({ giscus: { setConfig: { lang: next === 'en' ? 'en' : 'zh-CN' } } }, 'https://giscus.app');
      }
    });
  }

  function init() {
    applyLanguage(language, false);
    var button = document.getElementById('J_language_toggle');
    if (button) button.addEventListener('click', function () {
      applyLanguage(language === 'zh' ? 'en' : 'zh', true);
    });
  }

  window.addEventListener('storage', function (event) {
    if (event.key === storageKey) {
      applyLanguage(event.newValue === null ? browserLanguage() : event.newValue, false);
    }
  });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
}());
