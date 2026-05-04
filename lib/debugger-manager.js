// ============================================================
// lib/debugger-manager.js — v4.1 (FIXED!)
// ============================================================
// تغییرات v4.1:
//   1. اضافه شدن appendToCache — بروزرسانی فوری cache بدون خواندن از storage
//   2. اضافه شدن captureAndRemoveResponseCookies — گرفتن Set-Cookie از
//      پاسخ‌های شبکه و حذف فوری از shared jar
//   3. بهبود rebuild cookie cache
// ============================================================

import { getCookieDomainsForUrl, STORAGE_KEYS } from './constants.js';

class DebuggerManager {
  constructor() {
    // Map of tabId → { containerId, cookieCache, url }
    this._attachedTabs = new Map();
  }

  isAttached(tabId) {
    return this._attachedTabs.has(tabId);
  }

  // ============================================================
  // Attach debugger to a tab and set up request interception
  // ============================================================
  async attach(tabId, containerId) {
    if (this._attachedTabs.has(tabId)) {
      const info = this._attachedTabs.get(tabId);
      info.containerId = containerId;
      await this._rebuildCookieCache(tabId, containerId);
      return;
    }

    try {
      // Step 1: Attach debugger
      await chrome.debugger.attach({ tabId }, '1.3');
      console.log('[Debugger v4.1] Attached to tab', tabId, 'for container', containerId);

      // Step 2: Enable Fetch domain to intercept ALL requests (including WebSocket)
      await chrome.debugger.sendCommand({ tabId }, 'Fetch.enable', {
        patterns: [
          { urlPattern: 'http*', requestStage: 'Request' }
        ]
      });

      // Step 3: Enable Network domain to capture Set-Cookie from responses
      await chrome.debugger.sendCommand({ tabId }, 'Network.enable', {
        maxTotalBufferSize: 0,
        maxResourceBufferSize: 0,
        maxPostDataSize: 0
      });

      // Store attachment info
      this._attachedTabs.set(tabId, {
        containerId: containerId,
        cookieCache: '',
        url: ''
      });

      // Build cookie cache for this container
      await this._rebuildCookieCache(tabId, containerId);

    } catch (e) {
      console.error('[Debugger v4.1] Failed to attach to tab', tabId, ':', e.message);
    }
  }

  // ============================================================
  // Detach debugger from a tab
  // ============================================================
  async detach(tabId) {
    if (!this._attachedTabs.has(tabId)) return;

    try {
      try { await chrome.debugger.sendCommand({ tabId }, 'Fetch.disable'); } catch {}
      try { await chrome.debugger.sendCommand({ tabId }, 'Network.disable'); } catch {}
      await chrome.debugger.detach({ tabId });
    } catch (e) {}

    this._attachedTabs.delete(tabId);
    console.log('[Debugger v4.1] Detached from tab', tabId);
  }

  // ============================================================
  // Update cookie cache for a tab
  // ============================================================
  updateCookieCache(tabId, containerId) {
    const info = this._attachedTabs.get(tabId);
    if (info) {
      info.containerId = containerId;
    }
    this._rebuildCookieCache(tabId, containerId).catch(e => {
      console.warn('[Debugger v4.1] Failed to rebuild cookie cache:', e.message);
    });
  }

  // ============================================================
  // v4.1: Append cookies to cache immediately (without storage read!)
  // وقتی سرور Set-Cookie می‌فرستد، این تابع فوری cache را بروزرسانی می‌کند
  // ============================================================
  appendToCache(tabId, cookieName, cookieValue) {
    const info = this._attachedTabs.get(tabId);
    if (!info) return;

    // حذف کوکی قبلی با همین نام از cache
    const parts = info.cookieCache
      ? info.cookieCache.split('; ').filter(part => {
        const name = part.split('=')[0].trim();
        return name !== cookieName;
      })
      : [];

    // اضافه کردن کوکی جدید
    parts.push(cookieName + '=' + cookieValue);
    info.cookieCache = parts.join('; ');

    console.log('[Debugger v4.1] Cache updated (append):', cookieName, '=',
      cookieValue.substring(0, 20) + '...');
  }

  // ============================================================
  // v4.1: Update the stored URL for a tab
  // ============================================================
  setTabUrl(tabId, url) {
    const info = this._attachedTabs.get(tabId);
    if (info) {
      info.url = url;
    }
  }

  // ============================================================
  // Rebuild cookie string for a container
  // ============================================================
  async _rebuildCookieCache(tabId, containerId) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (!tab || !tab.url || !tab.url.startsWith('http')) return;

      const url = tab.url;
      const key = STORAGE_KEYS.CONTAINER_COOKIES + containerId;
      const stored = await chrome.storage.local.get(key);
      const dc = stored[key] || {};

      // Build cookie string from all domains related to this URL
      const domains = getCookieDomainsForUrl(url);
      const cookieParts = [];

      for (const domain of domains) {
        const cookies = dc[domain] || [];
        for (const c of cookies) {
          if (this._cookieMatchesUrl(c, url)) {
            cookieParts.push(c.name + '=' + c.value);
          }
        }
      }

      const cookieString = cookieParts.join('; ');

      const info = this._attachedTabs.get(tabId);
      if (info) {
        info.cookieCache = cookieString;
        info.url = url;
      }

      console.log('[Debugger v4.1] Cookie cache rebuilt for tab', tabId,
        ':', cookieString ? (cookieString.substring(0, 60) + '...') : '(empty)');
    } catch (e) {
      console.warn('[Debugger v4.1] Rebuild cache error:', e.message);
    }
  }

  // ============================================================
  // Check if a cookie matches a URL
  // ============================================================
  _cookieMatchesUrl(cookie, url) {
    try {
      const urlObj = new URL(url);
      const cookieDomain = cookie.domain || '';
      const domainToCheck = cookieDomain.startsWith('.') ? cookieDomain.substring(1) : cookieDomain;

      if (!urlObj.hostname.endsWith(domainToCheck) && urlObj.hostname !== domainToCheck) {
        return false;
      }

      const cookiePath = cookie.path || '/';
      if (!urlObj.pathname.startsWith(cookiePath)) {
        return false;
      }

      if (cookie.secure && urlObj.protocol !== 'https:') {
        return false;
      }

      return true;
    } catch {
      return true;
    }
  }

  // ============================================================
  // Get cookie cache for a tab
  // ============================================================
  getCookieCache(tabId) {
    const info = this._attachedTabs.get(tabId);
    return info ? info.cookieCache : '';
  }

  // ============================================================
  // Get container ID for a tab
  // ============================================================
  getContainerId(tabId) {
    const info = this._attachedTabs.get(tabId);
    return info ? info.containerId : null;
  }

  // ============================================================
  // Get all attached tab IDs
  // ============================================================
  getAttachedTabs() {
    return Array.from(this._attachedTabs.keys());
  }
}

export default DebuggerManager;
