// ============================================================
// content/storage-isolator.js — v4.1 (MAIN world, document_start)
// ============================================================
// این اسکریپت در context صفحه (MAIN world) اجرا می‌شود و:
//   1. localStorage را ایزوله می‌کند (prefix per container)
//   2. IndexedDB را ایزوله می‌کند (prefix database names)
//   3. CacheStorage را ایزوله می‌کند
//   4. Service Worker ثبت را مسدود می‌کند (!)
//   5. document.cookie را بازنویسی می‌کند
//
// ⚠️ v4.1 تغییر:
//   fetch/XHR interception حذف شد! چون:
//   - response.headers.get('set-cookie') یک "forbidden header" است
//     و مرورگر خطای "Refused to get unsafe header" می‌دهد
//   - در v4.1 Set-Cookie از طریق CDP Network events گرفته می‌شود
//     که بالاتر از Fetch API است و این محدودیت را ندارد
// ============================================================

(function() {
  'use strict';
  if (!location.protocol.startsWith('http')) return;

  // ============================================================
  // STEP 1: خواندن container ID از cookie
  // ============================================================
  let containerId = '';
  try {
    const _origGetter = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie') ||
                        Object.getOwnPropertyDescriptor(HTMLDocument.prototype, 'cookie');
    if (_origGetter) {
      const rawCookie = _origGetter.get.call(document);
      const match = rawCookie.match(/__mc_container__=([^;]+)/);
      if (match) containerId = decodeURIComponent(match[1]);
    }
  } catch (e) {
    // Fallback: parse document.cookie directly
    try {
      const cookies = document.cookie.split(';');
      for (let i = 0; i < cookies.length; i++) {
        const parts = cookies[i].trim().split('=');
        if (parts[0].trim() === '__mc_container__') {
          containerId = decodeURIComponent(parts.slice(1).join('='));
          break;
        }
      }
    } catch (e2) {}
  }

  if (!containerId) return; // Not in a container

  const P = '__mc_' + containerId + '__';

  // ============================================================
  // STEP 2: localStorage isolation (فوری!)
  // ============================================================
  const _origGetItem = Storage.prototype.getItem;
  const _origSetItem = Storage.prototype.setItem;
  const _origRemoveItem = Storage.prototype.removeItem;
  const _origClear = Storage.prototype.clear;
  const _origKey = Storage.prototype.key;
  const _origLengthDesc = Object.getOwnPropertyDescriptor(Storage.prototype, 'length');

  function _realKeys(storage) {
    const keys = [];
    const len = _origLengthDesc.get.call(storage);
    for (let i = 0; i < len; i++) {
      try { keys.push(_origKey.call(storage, i)); } catch (e) {}
    }
    return keys;
  }

  function _ourKeys(storage) {
    return _realKeys(storage).filter(function(k) { return k.startsWith(P); });
  }

  Storage.prototype.getItem = function(key) {
    return _origGetItem.call(this, P + key);
  };
  Storage.prototype.setItem = function(key, value) {
    return _origSetItem.call(this, P + key, String(value));
  };
  Storage.prototype.removeItem = function(key) {
    return _origRemoveItem.call(this, P + key);
  };
  Storage.prototype.clear = function() {
    const ours = _ourKeys(this);
    for (let i = 0; i < ours.length; i++) {
      _origRemoveItem.call(this, ours[i]);
    }
  };
  Storage.prototype.key = function(index) {
    const ours = _ourKeys(this);
    if (index < 0 || index >= ours.length) return null;
    return ours[index].substring(P.length);
  };
  Object.defineProperty(Storage.prototype, 'length', {
    get: function() { return _ourKeys(this).length; },
    configurable: true
  });

  // ============================================================
  // STEP 3: IndexedDB isolation (فوری!)
  // ============================================================
  const _origIDBOpen = IDBFactory.prototype.open;
  const _origIDBDelete = IDBFactory.prototype.deleteDatabase;
  const _origIDBDatabases = IDBFactory.prototype.databases;

  IDBFactory.prototype.open = function(name, version) {
    return _origIDBOpen.call(this, P + name, version);
  };
  IDBFactory.prototype.deleteDatabase = function(name) {
    return _origIDBDelete.call(this, P + name);
  };
  if (_origIDBDatabases) {
    IDBFactory.prototype.databases = function() {
      return _origIDBDatabases.call(this).then(function(dbs) {
        return dbs
          .filter(function(db) { return db.name && db.name.startsWith(P); })
          .map(function(db) {
            return { name: db.name.substring(P.length), version: db.version };
          });
      });
    };
  }
  if (IDBDatabase.prototype) {
    const _origDBName = Object.getOwnPropertyDescriptor(IDBDatabase.prototype, 'name');
    if (_origDBName) {
      Object.defineProperty(IDBDatabase.prototype, 'name', {
        get: function() {
          const realName = _origDBName.get.call(this);
          if (realName && realName.startsWith(P)) return realName.substring(P.length);
          return realName;
        },
        configurable: true
      });
    }
  }

  // ============================================================
  // STEP 4: CacheStorage isolation (فوری!)
  // ============================================================
  if (window.caches) {
    const _origCacheOpen = CacheStorage.prototype.open;
    const _origCacheHas = CacheStorage.prototype.has;
    const _origCacheDelete = CacheStorage.prototype.delete;
    const _origCacheKeys = CacheStorage.prototype.keys;

    CacheStorage.prototype.open = function(cacheName, options) {
      return _origCacheOpen.call(this, P + cacheName, options);
    };
    CacheStorage.prototype.has = function(cacheName, options) {
      return _origCacheHas.call(this, P + cacheName, options);
    };
    CacheStorage.prototype.delete = function(cacheName, options) {
      return _origCacheDelete.call(this, P + cacheName, options);
    };
    CacheStorage.prototype.keys = function(request, options) {
      return _origCacheKeys.call(this, request, options).then(function(names) {
        return names.filter(function(n) { return n.startsWith(P); }).map(function(n) { return n.substring(P.length); });
      });
    };
  }

  // ============================================================
  // STEP 5: Block Service Worker registration (!)
  // ============================================================
  // این بخش CRITICAL است! Service Worker واتساپ مشترک بین همه
  // تب‌هاست. با مسدود کردن آن، هر تب مستقل می‌شود.
  // ============================================================
  if (navigator.serviceWorker) {
    // Fake registration object
    const _fakeRegistration = {
      active: null,
      installing: null,
      waiting: null,
      scope: '/',
      unregister: function() { return Promise.resolve(false); },
      update: function() { return Promise.resolve(); },
      addEventListener: function() {},
      removeEventListener: function() {},
      dispatchEvent: function() { return false; }
    };

    // Block register()
    navigator.serviceWorker.register = function() {
      console.log('[MC v4.1] Service Worker registration BLOCKED for container:', containerId);
      return Promise.resolve(_fakeRegistration);
    };

    // Block getRegistrations()
    navigator.serviceWorker.getRegistrations = function() {
      return Promise.resolve([]);
    };

    // Block getRegistration()
    navigator.serviceWorker.getRegistration = function() {
      return Promise.resolve(undefined);
    };

    // Override 'ready' to resolve immediately
    Object.defineProperty(navigator.serviceWorker, 'ready', {
      get: function() {
        return Promise.resolve(_fakeRegistration);
      },
      configurable: true
    });

    // Override 'controller' to return null
    Object.defineProperty(navigator.serviceWorker, 'controller', {
      get: function() { return null; },
      configurable: true
    });
  }

  // ============================================================
  // STEP 6: document.cookie override
  // ============================================================
  // صفحه از طریق document.cookie هم کوکی‌ها را می‌خواند.
  // ما آن را بازنویسی می‌کنیم تا فقط کوکی‌های container را ببیند.
  // ============================================================
  let _ourCookieString = '';

  // Get the original property descriptor
  const _docCookieProto = Document.prototype;
  let _origDocCookieDesc = null;
  try {
    _origDocCookieDesc = Object.getOwnPropertyDescriptor(_docCookieProto, 'cookie');
  } catch (e) {}

  // Set our cookie string when received from background
  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'mc-cookie-response') {
      _ourCookieString = e.data.cookieString || '';
    }
  });

  if (_origDocCookieDesc) {
    Object.defineProperty(_docCookieProto, 'cookie', {
      get: function() {
        // Return our container's cookies (if available), else original
        if (_ourCookieString) return _ourCookieString;
        return _origDocCookieDesc.get.call(this);
      },
      set: function(value) {
        // When WhatsApp sets a cookie, pass it to the bridge
        if (value) {
          window.dispatchEvent(new CustomEvent('mc-set-cookie', {
            detail: { raw: value, containerId: containerId }
          }));
        }
        // Also set in real storage (for compatibility)
        try { _origDocCookieDesc.set.call(this, value); } catch (e) {}
        return value;
      },
      configurable: true
    });
  }

  // ============================================================
  // STEP 7: Request cookies from background
  // ============================================================
  // پس از document_start، کوکی‌های container را از background می‌گیریم
  // و به cookie-bridge می‌فرستیم تا به document.cookie اضافه شود
  // ============================================================
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', requestCookies);
  } else {
    requestCookies();
  }

  function requestCookies() {
    window.postMessage({
      type: 'mc-get-cookies',
      containerId: containerId,
      url: location.href
    }, '*');
  }

  // Also request cookies when URL changes (SPA navigation)
  let _lastUrl = location.href;
  const _origPushState = history.pushState;
  const _origReplaceState = history.replaceState;

  history.pushState = function() {
    _origPushState.apply(this, arguments);
    setTimeout(function() {
      if (location.href !== _lastUrl) {
        _lastUrl = location.href;
        requestCookies();
      }
    }, 100);
  };

  history.replaceState = function() {
    _origReplaceState.apply(this, arguments);
    setTimeout(function() {
      if (location.href !== _lastUrl) {
        _lastUrl = location.href;
        requestCookies();
      }
    }, 100);
  };

  console.log('[MC v4.1] FULLY ISOLATED for container:', containerId, '(SW blocked, storage isolated, no fetch intercept)');

})();
