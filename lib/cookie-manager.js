import { STORAGE_KEYS, getCookieDomainsForUrl } from './constants.js';

class CookieManager {
  constructor(storage) { this.storage = storage; }

  // ============================================================
  // Save all cookies for a container/domain to extension storage
  // ⚠️ v4.1: این تابع فقط برای تب‌هایی بدون debugger استفاده می‌شود!
  // تب‌هایی که debugger دارند، کوکی‌ها را از طریق CDP events دریافت می‌کنند.
  // ============================================================
  async saveContainerCookies(containerId, url) {
    const domains = getCookieDomainsForUrl(url);
    const all = [];
    for (const domain of domains) {
      try {
        const cookies = await chrome.cookies.getAll({ domain });
        for (const c of cookies) {
          if (c.name === '__mc_container__') continue; // Don't save our marker
          all.push({
            name: c.name, value: c.value, domain: c.domain, path: c.path,
            secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite,
            expirationDate: c.expirationDate, hostOnly: c.hostOnly,
            session: c.session, storeId: c.storeId
          });
        }
      } catch (e) {}
    }
    const key = STORAGE_KEYS.CONTAINER_COOKIES + containerId;
    const stored = await this.storage.get(key);
    const dc = { ...((stored[key] || {})) };
    for (const d of domains) dc[d] = [];
    for (const c of all) {
      const d = c.domain || '';
      if (!dc[d]) dc[d] = [];
      dc[d] = dc[d].filter(x => !(x.name === c.name && x.domain === c.domain && x.path === c.path));
      dc[d].push(c);
    }
    await this.storage.set({ [key]: dc });
    return all;
  }

  // ============================================================
  // Restore cookies from extension storage to browser jar
  // ============================================================
  async restoreContainerCookies(containerId, url) {
    const key = STORAGE_KEYS.CONTAINER_COOKIES + containerId;
    const stored = await this.storage.get(key);
    const dc = stored[key] || {};
    const domains = getCookieDomainsForUrl(url);
    let count = 0;
    for (const domain of domains) {
      for (const c of (dc[domain] || [])) {
        try {
          await chrome.cookies.set({
            url: 'https://' + c.domain.replace(/^\./, '') + c.path,
            name: c.name, value: c.value, domain: c.domain, path: c.path,
            secure: c.secure !== false, httpOnly: c.httpOnly || false,
            sameSite: c.sameSite || 'lax', expirationDate: c.expirationDate
          });
          count++;
        } catch (e) {}
      }
    }
    return count;
  }

  // ============================================================
  // Get cookie string for a container (for CDP header injection)
  // ============================================================
  async getCookieString(containerId, url) {
    const key = STORAGE_KEYS.CONTAINER_COOKIES + containerId;
    const stored = await this.storage.get(key);
    const dc = stored[key] || {};
    const domains = getCookieDomainsForUrl(url);
    const parts = [];

    for (const domain of domains) {
      const cookies = dc[domain] || [];
      for (const c of cookies) {
        parts.push(c.name + '=' + c.value);
      }
    }
    return parts.join('; ');
  }

  // ============================================================
  // v4.1: Capture Set-Cookie from CDP Network.responseReceived
  // این تابع کوکی‌هایی که سرور در پاسخ HTTP ارسال می‌کند را
  // در storage جداگانه هر container ذخیره می‌کند.
  // ============================================================
  async captureResponseSetCookie(containerId, responseUrl, setCookieHeaders) {
    if (!setCookieHeaders || !Array.isArray(setCookieHeaders) || setCookieHeaders.length === 0) return;

    const key = STORAGE_KEYS.CONTAINER_COOKIES + containerId;
    const stored = await this.storage.get(key);
    const dc = { ...((stored[key] || {})) };

    const cookiesToRemove = []; // کوکی‌هایی که باید از shared jar حذف شوند

    for (const rawHeader of setCookieHeaders) {
      // هر Set-Cookie header ممکن است شامل چند کوکی باشد
      const cookieStrings = this._splitSetCookieHeader(rawHeader);

      for (const cookieStr of cookieStrings) {
        const parsed = this._parseSetCookie(cookieStr, responseUrl);
        if (!parsed) continue;

        const domain = parsed.domain;
        if (!dc[domain]) dc[domain] = [];

        // حذف کوکی قبلی با همین name+domain+path
        dc[domain] = dc[domain].filter(x =>
          !(x.name === parsed.name && x.path === parsed.path)
        );

        // اضافه کردن کوکی جدید
        dc[domain].push({
          name: parsed.name,
          value: parsed.value,
          domain: parsed.domain,
          path: parsed.path,
          secure: parsed.secure,
          httpOnly: parsed.httpOnly,
          sameSite: parsed.sameSite
        });

        // اضافه به لیست حذف از shared jar
        cookiesToRemove.push({
          name: parsed.name,
          domain: parsed.domain,
          path: parsed.path,
          secure: parsed.secure
        });
      }
    }

    // ذخیره در extension storage
    await this.storage.set({ [key]: dc });

    // حذف از shared cookie jar — CRITICAL!
    // این کار باعث می‌شود کوکی‌های یک container در shared jar باقی نماند
    // و container دیگر آن‌ها را نخواند.
    for (const cookie of cookiesToRemove) {
      await this._removeFromJar(cookie);
    }

    return cookiesToRemove.length;
  }

  // ============================================================
  // v4.1: Capture Set-Cookie from content script (document.cookie setter)
  // ============================================================
  async captureSetCookie(containerId, url, rawCookieString) {
    if (!rawCookieString) return;
    return await this.captureResponseSetCookie(containerId, url, [rawCookieString]);
  }

  // ============================================================
  // v4.1: Parse a single Set-Cookie string
  // ============================================================
  _parseSetCookie(cookieStr, responseUrl) {
    const parts = cookieStr.split(';').map(s => s.trim());
    if (parts.length === 0) return null;

    const nv = parts[0].split('=');
    const name = (nv[0] || '').trim();
    const value = nv.slice(1).join('=').trim();
    if (!name || !value) return null;

    let path = '/';
    let domain = '';
    let secure = false;
    let httpOnly = false;
    let sameSite = 'lax';

    for (let i = 1; i < parts.length; i++) {
      const attr = parts[i].toLowerCase();
      if (attr.startsWith('path=')) path = parts[i].substring(5).trim();
      else if (attr.startsWith('domain=')) domain = parts[i].substring(7).trim();
      else if (attr === 'secure') secure = true;
      else if (attr === 'httponly') httpOnly = true;
      else if (attr.startsWith('samesite=')) sameSite = parts[i].substring(9).trim().toLowerCase();
    }

    // تعیین domain اگر مشخص نشده
    if (!domain) {
      try {
        domain = '.' + new URL(responseUrl).hostname;
      } catch {
        try { domain = '.' + new URL(responseUrl).hostname; } catch { domain = ''; }
      }
    }

    return { name, value, domain, path, secure, httpOnly, sameSite };
  }

  // ============================================================
  // v4.1: Split Set-Cookie header that might contain multiple cookies
  // Format: "name1=val1; Path=/; Secure, name2=val2; Path=/"
  // ============================================================
  _splitSetCookieHeader(raw) {
    // Split on comma followed by a cookie-name pattern (not attribute)
    return raw.split(/,\s*(?=[a-zA-Z][\w-]*=)/);
  }

  // ============================================================
  // v4.1: Remove a cookie from the shared browser cookie jar
  // ============================================================
  async _removeFromJar(cookie) {
    try {
      const domainForUrl = cookie.domain.replace(/^\./, '');
      const protocol = cookie.secure ? 'https' : 'http';
      const url = protocol + '://' + domainForUrl + cookie.path;

      await chrome.cookies.remove({
        url: url,
        name: cookie.name
      });
      console.log('[CookieMgr] Removed from shared jar:', cookie.name, 'domain:', cookie.domain);
    } catch (e) {
      // کوکی ممکن است از قبل حذف شده باشد
    }
  }

  // ============================================================
  // Clear all cookies for a URL's domains
  // ============================================================
  async clearCookiesForUrl(url) {
    const domains = getCookieDomainsForUrl(url);
    let removed = 0;
    for (const domain of domains) {
      try {
        const cookies = await chrome.cookies.getAll({ domain });
        for (const c of cookies) {
          try {
            await chrome.cookies.remove({
              url: ('http' + (c.secure ? 's' : '') + '://' + c.domain.replace(/^\./, '') + c.path),
              name: c.name, storeId: c.storeId
            });
            removed++;
          } catch (e) {}
        }
      } catch (e) {}
    }
    return removed;
  }
}

export default CookieManager;
