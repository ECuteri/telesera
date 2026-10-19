(function () {
  'use strict';
  var i18n = window.TeleseraI18n;
  var retry = document.getElementById('retry');
  var label = document.getElementById('state');
  var tries = 0, ready = false, localeReady = false, leaving = false, bridge;

  function labels() {
    document.documentElement.lang = i18n.language;
    label.textContent = i18n.t(tries >= 20 ? 'The service is not ready yet. Try again in a moment.' : 'Starting Telesera…');
    retry.textContent = i18n.t('Retry');
  }
  function enter() {
    if (!ready || !localeReady || leaving) return;
    leaving = true;
    var target = new URL(window.TeleseraTarget);
    target.searchParams.set('lang', i18n.locale);
    location.replace(target.href);
  }
  function finishLocale(tag) {
    if (localeReady) return;
    clearTimeout(localeTimeout);
    if (tag) i18n.setLocale(tag);
    localeReady = true;
    if (bridge) { try { bridge.cancel(); } catch (_) {} }
    labels();
    enter();
  }
  function openApp() {
    var image = new Image();
    image.onload = function () { ready = true; enter(); };
    image.onerror = function () {
      if (++tries < 20) setTimeout(openApp, 1000);
      else { labels(); retry.hidden = false; }
    };
    image.src = 'http://127.0.0.1:3190/icon.svg?ready=' + Date.now();
  }
  labels();
  // Resolve the LG UI locale in the wrapper before redirecting to the local HTTP UI.
  var localeTimeout = setTimeout(function () { finishLocale(); }, 800);
  try {
    if (typeof PalmServiceBridge === 'function') {
      bridge = new PalmServiceBridge();
      bridge.onservicecallback = function (raw) {
        try {
          var result = JSON.parse(raw);
          var info = result.returnValue && result.settings && result.settings.localeInfo;
          finishLocale(info && info.locales && info.locales.UI);
        } catch (_) { finishLocale(); }
      };
      bridge.call('luna://com.webos.settingsservice/getSystemSettings', JSON.stringify({ keys: ['localeInfo'] }));
    } else finishLocale();
  } catch (_) { finishLocale(); }
  retry.onclick = function () { tries = 0; retry.hidden = true; labels(); openApp(); };
  openApp();
})();
