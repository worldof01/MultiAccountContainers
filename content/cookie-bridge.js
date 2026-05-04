// ============================================================
// content/cookie-bridge.js — v4.0 (ISOLATED world, document_start)
// ============================================================
// این اسکریپت پلی بین MAIN world و Background Service Worker است.
// MAIN world نمی‌تواند از chrome.* API استفاده کند، پس:
//   MAIN → (postMessage) → ISOLATED → (chrome.runtime.sendMessage) → Background
//   Background → (chrome.runtime.sendMessage) → ISOLATED → (postMessage) → MAIN
// ============================================================

(function() {
  'use strict';

  if (!location.protocol.startsWith('http')) return;

  // ============================================================
  // Listen for messages from MAIN world
  // ============================================================
  window.addEventListener('message', function(event) {
    // Only accept messages from our extension
    if (!event.data || !event.data.type) return;

    // MAIN world wants cookie string for this container
    if (event.data.type === 'mc-get-cookies') {
      const containerId = event.data.containerId;
      const url = event.data.url;

      if (!containerId) return;

      // Ask background for cookie string
      chrome.runtime.sendMessage({
        action: 'getCookieString',
        containerId: containerId,
        url: url
      }, function(response) {
        if (response && !response.error && response.cookieString) {
          // Send cookie string back to MAIN world
          window.postMessage({
            type: 'mc-cookie-response',
            cookieString: response.cookieString,
            containerId: containerId
          }, '*');
        }
      });
    }
  });

  // ============================================================
  // Listen for CustomEvents from MAIN world (cookie capture)
  // ============================================================

  // WhatsApp sets a cookie via document.cookie setter
  window.addEventListener('mc-set-cookie', function(event) {
    const detail = event.detail;
    if (!detail || !detail.raw || !detail.containerId) return;

    const tabId = getTabId();
    chrome.runtime.sendMessage({
      action: 'captureCookies',
      containerId: detail.containerId,
      url: location.href,
      rawCookie: detail.raw,
      tabId: tabId
    });
  });

  // HTTP response has Set-Cookie header (from fetch/XHR interception)
  window.addEventListener('mc-http-setcookie', function(event) {
    const detail = event.detail;
    if (!detail || !detail.raw || !detail.containerId) return;

    const tabId = getTabId();
    chrome.runtime.sendMessage({
      action: 'captureCookies',
      containerId: detail.containerId,
      url: detail.url || location.href,
      rawCookie: detail.raw,
      tabId: tabId
    });
  });

  // ============================================================
  // Helper: get current tab ID
  // ============================================================
  function getTabId() {
    // In content scripts, we can't directly get the tab ID
    // We'll let the background infer it from sender.tab
    return undefined;
  }

  console.log('[MC v4.0] Cookie bridge ready');
})();
