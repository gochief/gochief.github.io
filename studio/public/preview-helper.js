(function () {
  'use strict';
  document.querySelectorAll('link[rel="stylesheet"][media="print"]').forEach(function (link) {
    if (link.sheet) link.media = 'all';
    else link.addEventListener('load', function () { link.media = 'all'; }, { once: true });
  });
  window.addEventListener('message', function (event) {
    if (event.source !== window.parent || !event.data || event.data.type !== 'studio:language') return;
    var language = event.data.language;
    if (language !== 'zh' && language !== 'en') return;
    window.dispatchEvent(new StorageEvent('storage', { key: 'gochief.language', newValue: language }));
    document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';
    document.querySelectorAll('[data-language]').forEach(function (element) {
      element.hidden = element.getAttribute('data-language') !== language;
    });
    try {
      var data = JSON.parse(document.getElementById('site-translations').textContent);
      document.title = data.page[language].title;
    } catch (error) {}
  });
  window.parent.postMessage({ type: 'studio:ready', url: window.location.pathname }, '*');
}());
