// ============================================================
// background/service-worker.js — v4.4
// ============================================================
// تغییرات v4.4:
//   🐛 رفع باگ TypeError: origHeaders.map is not a function
//      — CDP headers ممکن است به صورت Object باشد (نه Array)
//      — حالا هر دو فرمت (Array و Object) پشتیبانی می‌شود
//   🐛 رفع مشکل Debug popup (inline style override)
//   🎨 حذف badge رنگی کوچک کنار تب وقتی showTabColor فعال باشد
//   🎨 مخفی کردن container indicator (نشانگر شناور) وقتی showTabColor فعال باشد
//   ☑️ checkbox "Color tab bar" per container (دیفالت خاموش)
//   ✏️ کلیک روی container name در side-panel = ویرایش (نه prompt)
//   ℹ️ بخش Info با ایمیل و آدرس ولت
// ============================================================
// تغییرات v4.3 (حفظ شده):
//   ☑️ Opt-in colored tabs per container
// ============================================================
// تغییرات v4.2 (حفظ شده):
//   🎨 تب‌های هر container با رنگ container نمایش داده می‌شوند
//      از طریق chrome.tabGroups API
// ============================================================
// تغییرات v4.1 (حفظ شده):
//   - Debugger-based cookie isolation (CDP Fetch + Network)
//   - Set-Cookie capture از Network.responseReceived
//   - حذف خودکار کوکی از shared jar
//   - Service Worker blocking
//   - Storage isolation (localStorage, IndexedDB, CacheStorage)
// ============================================================

import ContainerManager from '../lib/container-manager.js';
import CookieManager from '../lib/cookie-manager.js';
import TabManager from '../lib/tab-manager.js';
import DebuggerManager from '../lib/debugger-manager.js';
import { STORAGE_KEYS, ICON_MAP } from '../lib/constants.js';

const containerMgr = new ContainerManager();
const cookieMgr = new CookieManager(chrome.storage.local);
const tabMgr = new TabManager();
const debuggerMgr = new DebuggerManager();
let lastActiveContainer = null;
let lastError = null;

// Guard against infinite reload loops
const _reloadingTabs = new Set();

// ============================================================
// TAB GROUP MANAGEMENT — v4.4 (Opt-in per container!)
// ============================================================
// Map: "windowId:containerId" -> groupId
let _groupMap = {};

// رنگ‌های Tab Group در Chromium: فقط ۹ رنگ ثابت
const CHROME_GROUP_COLORS = {
  '#37adff': 'blue', '#51c4d3': 'cyan', '#7bc962': 'green',
  '#ffcb3e': 'yellow', '#fb9349': 'orange', '#f25c54': 'red',
  '#e861a5': 'pink', '#a87bda': 'purple', '#7c7c7d': 'grey'
};

// تبدیل hex color به نزدیک‌ترین رنگ Chrome Tab Group
function _toGroupColor(hexColor) {
  if (CHROME_GROUP_COLORS[hexColor]) return CHROME_GROUP_COLORS[hexColor];

  const predefined = {
    blue: [55,173,255], cyan: [81,196,211], green: [123,201,98],
    yellow: [255,203,62], orange: [251,147,73], red: [242,92,84],
    pink: [232,97,165], purple: [168,123,218], grey: [124,124,125]
  };
  const r = parseInt(hexColor.slice(1,3),16);
  const g = parseInt(hexColor.slice(3,5),16);
  const b = parseInt(hexColor.slice(5,7),16);
  let best = 'grey', minD = Infinity;
  for (const [name, [pr,pg,pb]] of Object.entries(predefined)) {
    const d = (r-pr)**2 + (g-pg)**2 + (b-pb)**2;
    if (d < minD) { minD = d; best = name; }
  }
  return best;
}

// بارگذاری group map از storage
async function _loadGroupMap() {
  try {
    const data = await chrome.storage.local.get('mc_group_map');
    const saved = data.mc_group_map || {};

    if (chrome.tabGroups) {
      try {
        const groups = await chrome.tabGroups.query({});
        const validIds = new Set(groups.map(g => String(g.id)));
        for (const [key, gid] of Object.entries(saved)) {
          if (validIds.has(String(gid))) {
            _groupMap[key] = gid;
          }
        }
      } catch (e) {
        console.warn('[TabGroup] Query failed:', e.message);
        _groupMap = saved;
      }
    } else {
      _groupMap = saved;
    }
    console.log('[TabGroup] Loaded map:', Object.keys(_groupMap).length, 'groups');
  } catch (e) {
    console.warn('[TabGroup] Load error:', e.message);
    _groupMap = {};
  }
}

// ذخیره group map در storage
async function _saveGroupMap() {
  try {
    await chrome.storage.local.set({ mc_group_map: _groupMap });
  } catch (e) {}
}

// v4.3+: بررسی آیا container باید نوار رنگی داشته باشد
async function shouldShowTabColor(container) {
  if (!container) return false;
  return !!container.showTabColor;
}

// اضافه کردن تب به گروه container (فقط اگر showTabColor فعال باشد)
async function addToContainerGroup(tabId, container) {
  if (!chrome.tabGroups) return;
  // فقط اگر کاربر تیک زده باشد
  if (!await shouldShowTabColor(container)) return;

  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab) return;

    const key = tab.windowId + ':' + container.id;
    const groupColor = _toGroupColor(container.color);

    // بررسی آیا گروه قبلاً وجود دارد
    if (_groupMap[key]) {
      try {
        const groupId = _groupMap[key];
        await chrome.tabGroups.get(groupId);
        // گروه وجود دارد — اضافه کردن تب
        await chrome.tabs.group({ tabIds: [tabId], groupId });
        console.log('[TabGroup] Added tab', tabId, 'to existing group', groupId);
        return;
      } catch (e) {
        // گروه حذف شده — ساختن گروه جدید
        delete _groupMap[key];
      }
    }

    // ساختن گروه جدید
    const groupId = await chrome.tabs.group({ tabIds: [tabId] });
    await chrome.tabGroups.update(groupId, {
      title: '',
      color: groupColor,
      collapsed: false
    });
    _groupMap[key] = groupId;
    await _saveGroupMap();
    console.log('[TabGroup] Created group', groupId, 'for container', container.name, 'color:', groupColor);
  } catch (e) {
    console.warn('[TabGroup] addToGroup error:', e.message);
  }
}

// حذف تب از گروه
async function removeFromContainerGroup(tabId) {
  if (!chrome.tabGroups) return;
  try {
    await chrome.tabs.ungroup(tabId);
  } catch (e) {}
}

// وقتی گروه به صورت خودکار حذف می‌شود (تب‌هایش صفر شد)
function onTabGroupRemoved(groupId) {
  for (const [key, gid] of Object.entries(_groupMap)) {
    if (String(gid) === String(groupId)) {
      delete _groupMap[key];
      _saveGroupMap();
      console.log('[TabGroup] Group', groupId, 'removed (empty), cleaned map');
      break;
    }
  }
}

// بازیابی گروه‌ها هنگام شروع (service worker restart)
async function recoverTabGroups() {
  if (!chrome.tabGroups) return;
  try {
    const tabMap = tabMgr.getMap();
    for (const [tidStr, cid] of Object.entries(tabMap)) {
      const tabId = parseInt(tidStr);
      const container = await containerMgr.get(cid);
      if (!container) continue;
      if (!await shouldShowTabColor(container)) continue;

      try {
        const tab = await chrome.tabs.get(tabId);
        if (!tab || !tab.url || tab.url.startsWith('chrome://') || tab.url === 'about:blank') continue;

        const key = tab.windowId + ':' + cid;

        if (_groupMap[key]) {
          try {
            const g = await chrome.tabGroups.get(_groupMap[key]);
            continue;
          } catch (e) {
            delete _groupMap[key];
          }
        }

        await addToContainerGroup(tabId, container);
      } catch (e) {}
    }
    console.log('[TabGroup] Recovery complete');
  } catch (e) {
    console.warn('[TabGroup] Recovery error:', e.message);
  }
}

// حذف تمام تب‌ها از گروه یک container (وقتی container حذف می‌شود)
async function ungroupAllContainerTabs(containerId) {
  if (!chrome.tabGroups) return;
  try {
    const tabMap = tabMgr.getMap();
    for (const [tidStr, cid] of Object.entries(tabMap)) {
      if (cid !== containerId) continue;
      const tabId = parseInt(tidStr);
      await removeFromContainerGroup(tabId);
    }
    for (const [key] of Object.entries(_groupMap)) {
      if (key.endsWith(':' + containerId)) {
        delete _groupMap[key];
      }
    }
    await _saveGroupMap();
  } catch (e) {}
}

// ============================================================
// INIT
// ============================================================
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[Containers v4.4] Installed:', details.reason);
  try {
    await containerMgr.init();
    await tabMgr.init();
    await _loadGroupMap();
    await rebuildContextMenu();
    await recoverTabGroups();
    console.log('[Containers v4.4] Init OK — All bugs fixed!');
  } catch (e) {
    lastError = 'Init failed: ' + e.message;
    console.error('[Containers v4.4] Init failed:', e);
  }
});

chrome.runtime.onStartup.addListener(async () => {
  try {
    await containerMgr.init();
    await tabMgr.init();
    await _loadGroupMap();
    await rebuildContextMenu();
    await recoverTabGroups();
    console.log('[Containers v4.4] Startup OK');
  } catch (e) {
    lastError = 'Startup failed: ' + e.message;
    console.error('[Containers v4.4] Startup failed:', e);
  }
});

// ============================================================
// CONTEXT MENU
// ============================================================
async function rebuildContextMenu() {
  await chrome.contextMenus.removeAll();
  const containers = await containerMgr.getSorted();

  chrome.contextMenus.create({ id: 'mc-parent', title: 'Multi Account Containers', contexts: ['page', 'link'] });

  chrome.contextMenus.create({ id: 'mc-newtab-parent', parentId: 'mc-parent', title: 'Open in Container...', contexts: ['page'] });
  for (const c of containers) {
    chrome.contextMenus.create({ id: 'mc-newtab-' + c.id, parentId: 'mc-newtab-parent', title: (ICON_MAP[c.icon] || '') + ' ' + c.name, contexts: ['page'] });
  }

  chrome.contextMenus.create({ id: 'mc-reopen-parent', parentId: 'mc-parent', title: 'Reopen in Container...', contexts: ['page'] });
  for (const c of containers) {
    chrome.contextMenus.create({ id: 'mc-reopen-' + c.id, parentId: 'mc-reopen-parent', title: (ICON_MAP[c.icon] || '') + ' ' + c.name, contexts: ['page'] });
  }

  chrome.contextMenus.create({ id: 'mc-link-parent', parentId: 'mc-parent', title: 'Open Link in Container...', contexts: ['link'] });
  for (const c of containers) {
    chrome.contextMenus.create({ id: 'mc-link-' + c.id, parentId: 'mc-link-parent', title: (ICON_MAP[c.icon] || '') + ' ' + c.name, contexts: ['link'] });
  }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    const all = await containerMgr.getAll();
    for (const cId of Object.keys(all)) {
      if (info.menuItemId === 'mc-newtab-' + cId && tab) {
        if (tab.url && tab.url.startsWith('http')) await openInContainer(tab.url, cId, true);
        else await openNewTabInContainer(cId);
        return;
      }
      if (info.menuItemId === 'mc-reopen-' + cId && tab) {
        await reopenTabInContainer(tab.id, cId);
        return;
      }
      if (info.menuItemId === 'mc-link-' + cId && info.linkUrl) {
        await openInContainer(info.linkUrl, cId, false);
        return;
      }
    }
  } catch (e) {
    lastError = 'ContextMenu error: ' + e.message;
    console.error('[Containers] ContextMenu error:', e);
  }
});

// ============================================================
// OMNIBOX
// ============================================================
chrome.omnibox.onInputChanged.addListener(async (text, suggest) => {
  try {
    const containers = await containerMgr.getSorted();
    const suggestions = containers.map(c => ({
      content: text,
      deletable: false,
      description: (ICON_MAP[c.icon] || '') + ' Open "' + text + '" in ' + c.name,
    }));
    chrome.omnibox.setDefaultSuggestion({ description: 'Open "' + text + '" in a container...' });
    suggest(suggestions);
  } catch (e) {}
});

chrome.omnibox.onInputEntered.addListener(async (text, disposition) => {
  try {
    if (!text.trim()) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) await chrome.sidePanel.open({ windowId: tab.windowId });
      return;
    }
    let url = text.trim();
    let containerId = null;
    if (text.includes('|')) {
      const parts = text.split('|').map(s => s.trim());
      url = parts[0];
      const name = parts[1].toLowerCase();
      const all = await containerMgr.getAll();
      for (const [id, c] of Object.entries(all)) {
        if (c.name.toLowerCase() === name) { containerId = id; break; }
      }
    }
    if (!containerId) { const s = await containerMgr.getSorted(); if (s.length) containerId = s[0].id; }
    if (!containerId) return;
    if (!url.match(/^https?:\/\//)) url = 'https://' + url;
    await openInContainer(url, containerId, disposition === 'currentTab');
  } catch (e) {
    lastError = 'Omnibox error: ' + e.message;
  }
});

// ============================================================
// MESSAGE HANDLER
// ============================================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch(err => {
    lastError = err.message;
    console.error('[Containers] Error:', err);
    sendResponse({ error: err.message });
  });
  return true;
});

async function handleMessage(message, sender) {
  switch (message.action) {
    case 'ping':
      return { pong: true, version: '4.4.0', containersCount: Object.keys(await containerMgr.getAll()).length };

    case 'getLastError':
      return { error: lastError };

    case 'clearError':
      lastError = null;
      return { success: true };

    case 'getContainers':
      return await containerMgr.getSorted();

    case 'createContainer':
      return await containerMgr.create(message.data);

    case 'updateContainer': {
      const updated = await containerMgr.update(message.containerId, message.updates);

      // اگر showTabColor خاموش شد، تب‌ها را از گروه خارج کن
      if (message.updates.showTabColor === false) {
        await ungroupAllContainerTabs(message.containerId);
      }

      // اگر showTabColor روشن شد، تب‌های فعال را به گروه اضافه کن
      if (message.updates.showTabColor === true) {
        const tabMap = tabMgr.getMap();
        for (const [tidStr, cid] of Object.entries(tabMap)) {
          if (cid === message.containerId) {
            const tabId = parseInt(tidStr);
            try {
              const tab = await chrome.tabs.get(tabId);
              if (tab && tab.url && !tab.url.startsWith('chrome://') && tab.url !== 'about:blank') {
                await addToContainerGroup(tabId, updated);
              }
            } catch (e) {}
          }
        }
      }

      // بروزرسانی رنگ/نام گروه اگر تغییر کرد
      if (message.updates.color || message.updates.name) {
        await updateContainerGroupAppearance(message.containerId, updated);
      }
      return updated;
    }

    case 'deleteContainer':
      await ungroupAllContainerTabs(message.containerId);
      await containerMgr.delete(message.containerId);
      await rebuildContextMenu();
      return { success: true };

    case 'openInContainer':
      return await openInContainer(message.url, message.containerId, message.active !== false);

    case 'openNewTabInContainer':
      return await openNewTabInContainer(message.containerId, message.url);

    case 'reopenInContainer': {
      if (!message.tabId) return { error: 'No tabId' };
      return await reopenTabInContainer(message.tabId, message.containerId);
    }

    case 'getTabContainer':
      return tabMgr.getContainer(message.tabId) || tabMgr.getContainer(sender.tab?.id);

    case 'unassignTab': {
      const tId = message.tabId || sender.tab?.id;
      if (!tId) return { error: 'No tab' };
      await removeFromContainerGroup(tId);
      await tabMgr.remove(tId);
      updateBadge(tId, null);
      await debuggerMgr.detach(tId);
      return { success: true };
    }

    case 'getAlwaysOpen': {
      const stored = await chrome.storage.local.get(STORAGE_KEYS.ALWAYS_OPEN);
      return stored[STORAGE_KEYS.ALWAYS_OPEN] || {};
    }
    case 'setAlwaysOpen': {
      const stored = await chrome.storage.local.get(STORAGE_KEYS.ALWAYS_OPEN);
      const ao = { ...(stored[STORAGE_KEYS.ALWAYS_OPEN] || {}), [message.domain]: message.containerId };
      await chrome.storage.local.set({ [STORAGE_KEYS.ALWAYS_OPEN]: ao });
      return { success: true };
    }
    case 'removeAlwaysOpen': {
      const stored = await chrome.storage.local.get(STORAGE_KEYS.ALWAYS_OPEN);
      const ao = stored[STORAGE_KEYS.ALWAYS_OPEN] || {};
      delete ao[message.domain];
      await chrome.storage.local.set({ [STORAGE_KEYS.ALWAYS_OPEN]: ao });
      return { success: true };
    }

    case 'getCookieString':
      return await cookieMgr.getCookieString(message.containerId, message.url);

    case 'captureCookies': {
      if (message.containerId && message.url) {
        await cookieMgr.captureSetCookie(message.containerId, message.url, message.rawCookie);
        if (message.tabId) {
          debuggerMgr.updateCookieCache(message.tabId, message.containerId);
        }
      }
      return { success: true };
    }

    case 'sortTabsByContainer': {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const groups = {};
      for (const t of tabs) {
        const cid = tabMgr.getContainer(t.id) || '__none__';
        if (!groups[cid]) groups[cid] = [];
        groups[cid].push(t);
      }
      const ctrs = await containerMgr.getSorted();
      const sortedTabs = [];
      for (const c of ctrs) { if (groups[c.id]) sortedTabs.push(...groups[c.id]); }
      if (groups['__none__']) sortedTabs.push(...groups['__none__']);
      for (let i = 0; i < sortedTabs.length; i++) {
        await chrome.tabs.move(sortedTabs[i].id, { index: i });
      }
      return { success: true, sortedCount: sortedTabs.length };
    }

    default:
      return { error: 'Unknown action: ' + (message.action || 'null') };
  }
}

// ============================================================
// بروزرسانی ظاهر گروه container (رنگ/نام)
// ============================================================
async function updateContainerGroupAppearance(containerId, container) {
  if (!chrome.tabGroups) return;
  if (!await shouldShowTabColor(container)) return;
  try {
    const groupColor = _toGroupColor(container.color);
    for (const [key, gid] of Object.entries(_groupMap)) {
      if (key.endsWith(':' + containerId)) {
        try {
          await chrome.tabGroups.update(gid, {
            title: '',
            color: groupColor
          });
        } catch (e) {}
      }
    }
  } catch (e) {}
}

// ============================================================
// CORE: Open URL in Container
// ============================================================
async function openInContainer(url, containerId, active = true) {
  const container = await containerMgr.get(containerId);
  if (!container) throw new Error('Container not found: ' + containerId);
  console.log('[v4.4] Opening', url, 'in', container.name);

  // Create the tab
  const tab = await chrome.tabs.create({ url, active });

  // Assign tab to container
  await tabMgr.assign(tab.id, containerId);

  // Badge فقط وقتی showTabColor خاموش است
  updateBadge(tab.id, container);

  // Set the container marker cookie
  await setMarkerCookie(tab.id, url, containerId);

  // Add to colored tab group (فقط اگر showTabColor فعال باشد)
  await addToContainerGroup(tab.id, container);

  // Attach debugger for Cookie header injection
  await debuggerMgr.attach(tab.id, containerId);

  lastActiveContainer = containerId;
  return { tabId: tab.id, containerId, containerName: container.name };
}

// ============================================================
// CORE: Open new tab in Container
// ============================================================
async function openNewTabInContainer(containerId, url) {
  if (url && url.startsWith('http')) {
    return await openInContainer(url, containerId, true);
  }
  const container = await containerMgr.get(containerId);
  if (!container) throw new Error('Container not found');
  const newTab = await chrome.tabs.create({ url: 'about:blank', active: true });
  await tabMgr.assign(newTab.id, containerId);
  updateBadge(newTab.id, container);
  await addToContainerGroup(newTab.id, container);
  lastActiveContainer = containerId;
  return { tabId: newTab.id, containerId, containerName: container.name };
}

// ============================================================
// CORE: Reopen tab in different container
// ============================================================
async function reopenTabInContainer(tabId, containerId) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab || !tab.url || tab.url.startsWith('chrome://') || tab.url === 'about:blank') {
    return { error: 'Cannot reopen this tab' };
  }
  await debuggerMgr.detach(tabId);
  await chrome.tabs.remove(tabId);
  return await openInContainer(tab.url, containerId, true);
}

// ============================================================
// TAB LIFECYCLE
// ============================================================
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab || !tab.url || tab.url.startsWith('chrome://') || tab.url === 'about:blank') return;

    const cid = tabMgr.getContainer(tabId);
    if (!cid) return;

    const container = await containerMgr.get(cid);
    if (!container) return;

    lastActiveContainer = cid;

    // Make sure debugger is attached
    if (!debuggerMgr.isAttached(tabId)) {
      console.log('[v4.4] Re-attaching debugger to tab', tabId);
      await setMarkerCookie(tabId, tab.url, cid);
      await debuggerMgr.attach(tabId, cid);
    }
  } catch (e) {
    console.error('[v4.4] Tab activated error:', e);
  }
});

// When tab URL changes
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!changeInfo.url) return;

  if (_reloadingTabs.has(tabId)) {
    _reloadingTabs.delete(tabId);
    return;
  }

  const cid = tabMgr.getContainer(tabId);
  if (!cid) return;

  const c = await containerMgr.get(cid);
  if (c) updateBadge(tabId, c);

  if (changeInfo.url.startsWith('http')) {
    if (!debuggerMgr.isAttached(tabId)) {
      await setMarkerCookie(tabId, changeInfo.url, cid);
      await debuggerMgr.attach(tabId, cid);
    } else {
      debuggerMgr.updateCookieCache(tabId, cid);
      debuggerMgr.setTabUrl(tabId, changeInfo.url);
    }
  }
});

// When tab is closed
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const cid = tabMgr.getContainer(tabId);
  await debuggerMgr.detach(tabId);
  await tabMgr.remove(tabId);
});

// When tab group is auto-removed
if (chrome.tabGroups) {
  try {
    chrome.tabGroups.onRemoved.addListener((groupId) => {
      onTabGroupRemoved(groupId);
    });
  } catch (e) {}
}

// ============================================================
// HELPER: Set marker cookie
// ============================================================
async function setMarkerCookie(tabId, url, containerId) {
  if (!url || !url.startsWith('http')) return;
  try {
    const urlObj = new URL(url);
    const cookieDomain = urlObj.hostname.startsWith('www.') ? urlObj.hostname.replace('www.', '') : urlObj.hostname;
    await chrome.cookies.set({
      url: url,
      name: '__mc_container__',
      value: containerId,
      domain: cookieDomain,
      path: '/',
      secure: url.startsWith('https'),
      sameSite: 'no_restriction'
    });
  } catch (e) {
    console.warn('[v4.4] Failed to set marker cookie:', e.message);
  }
}

// ============================================================
// BADGE — فقط وقتی showTabColor خاموش باشد
// ============================================================
function updateBadge(tabId, container) {
  if (container) {
    // اگر showTabColor فعال باشد، Tab Group رنگی نشان می‌دهد
    // پس badge (مربع کوچک) را خالی می‌کنیم تا دو تا نشانگر رنگی نداشته باشیم
    if (container.showTabColor) {
      chrome.action.setBadgeText({ text: '', tabId });
    } else {
      const emoji = ICON_MAP[container.icon] || '';
      const badgeText = emoji.length > 0 ? emoji.charAt(0) : container.name.charAt(0).toUpperCase();
      chrome.action.setBadgeText({ text: badgeText, tabId });
      chrome.action.setBadgeBackgroundColor({ color: container.color || '#7c7c7d', tabId });
    }
    chrome.action.setTitle({ title: container.name + ' Container', tabId });
  } else {
    chrome.action.setBadgeText({ text: '', tabId });
    chrome.action.setTitle({ title: 'Multi Account Containers', tabId });
  }
}

// ============================================================
// AUTO-SAVE (فقط تب‌های بدون debugger)
// ============================================================
chrome.alarms.create('auto-save', { periodInMinutes: 2 });
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'auto-save') return;
  for (const [tidStr, cid] of Object.entries(tabMgr.getMap())) {
    try {
      const tabId = parseInt(tidStr);
      if (debuggerMgr.isAttached(tabId)) continue;
      const tab = await chrome.tabs.get(tabId);
      if (tab && tab.url && !tab.url.startsWith('chrome://') && tab.status === 'complete') {
        await cookieMgr.saveContainerCookies(cid, tab.url);
      }
    } catch { await tabMgr.remove(parseInt(tidStr)); }
  }
});

// Handle debugger detach events
chrome.debugger.onDetach.addListener((source, reason) => {
  console.log('[v4.4] Debugger detached from tab', source.tabId, 'reason:', reason);
  debuggerMgr._attachedTabs.delete(source.tabId);
});

// ============================================================
// CDP EVENT HANDLER — Cookie injection + Set-Cookie capture
// ============================================================
chrome.debugger.onEvent.addListener((source, method, params) => {
  const tabId = source.tabId;
  if (!tabId) return;

  // ============================================================
  // Fetch.requestPaused — Cookie header injection
  // ============================================================
  // v4.4 FIX: headers را به فرمت استاندارد تبدیل می‌کنیم
  // CDP ممکن است headers را به صورت Array یا Object بفرستد
  // ============================================================
  if (method === 'Fetch.requestPaused') {
    const containerId = debuggerMgr.getContainerId(tabId) || tabMgr.getContainer(tabId);

    if (!containerId) {
      chrome.debugger.sendCommand({ tabId }, 'Fetch.continueRequest', {
        requestId: params.requestId
      }).catch(() => {});
      return;
    }

    const cookieString = debuggerMgr.getCookieCache(tabId);

    if (!cookieString) {
      chrome.debugger.sendCommand({ tabId }, 'Fetch.continueRequest', {
        requestId: params.requestId
      }).catch(() => {});
      return;
    }

    // ============================================================
    // v4.4 CRITICAL FIX:
    // CDP headers could be:
    //   1. Array of objects: [{name: "Cookie", value: "..."}, ...]
    //   2. Plain object: {"Cookie": "...", "Accept": "...", ...}
    // We MUST handle both formats!
    // ============================================================
    const origHeaders = (params.request && params.request.headers) || [];
    let headers;

    if (Array.isArray(origHeaders)) {
      // فرمت Array — shallow copy هر عنصر
      headers = origHeaders.map(function(h) {
        return { name: h.name, value: h.value };
      });
    } else if (typeof origHeaders === 'object' && origHeaders !== null) {
      // فرمت Object — تبدیل به Array
      headers = [];
      for (var key of Object.keys(origHeaders)) {
        headers.push({ name: key, value: String(origHeaders[key]) });
      }
    } else {
      // فرمت نامعتبر — بدون headers ادامه بده
      chrome.debugger.sendCommand({ tabId }, 'Fetch.continueRequest', {
        requestId: params.requestId
      }).catch(() => {});
      return;
    }

    // Find and replace/add Cookie header
    let cookieFound = false;
    for (let i = 0; i < headers.length; i++) {
      if (headers[i].name.toLowerCase() === 'cookie') {
        headers[i].value = cookieString;
        cookieFound = true;
        break;
      }
    }
    if (!cookieFound) {
      headers.push({ name: 'Cookie', value: cookieString });
    }

    chrome.debugger.sendCommand({ tabId }, 'Fetch.continueRequest', {
      requestId: params.requestId,
      headers: headers
    }).catch((e) => {
      // اگر با headers شکست خورد، بدون headers دوباره تلاش کن
      chrome.debugger.sendCommand({ tabId }, 'Fetch.continueRequest', {
        requestId: params.requestId
      }).catch(() => {});
    });
    return;
  }

  // Fetch.authRequired
  if (method === 'Fetch.authRequired') {
    chrome.debugger.sendCommand({ tabId }, 'Fetch.continueWithAuth', {
      requestId: params.requestId,
      authChallengeResponse: { response: 'Default' }
    }).catch(() => {});
    return;
  }

  // Network.responseReceived — Set-Cookie capture
  if (method === 'Network.responseReceived') {
    const containerId = debuggerMgr.getContainerId(tabId) || tabMgr.getContainer(tabId);
    if (!containerId) return;
    const response = params.response;
    if (!response || !response.url) return;
    const setCookieHeaders = extractSetCookieHeaders(response.headers);
    if (setCookieHeaders.length === 0) return;
    handleCapturedCookies(tabId, containerId, response.url, setCookieHeaders);
    return;
  }

  // Network.responseReceivedExtraInfo
  if (method === 'Network.responseReceivedExtraInfo') {
    const containerId = debuggerMgr.getContainerId(tabId) || tabMgr.getContainer(tabId);
    if (!containerId) return;
    const headers = params.headers;
    if (!headers) return;
    const setCookieHeaders = extractSetCookieHeaders(headers);
    if (setCookieHeaders.length === 0) return;
    handleCapturedCookies(tabId, containerId, '', setCookieHeaders);
    return;
  }
});

// ============================================================
// HELPERS: Set-Cookie extraction & handling
// ============================================================
function extractSetCookieHeaders(headers) {
  const result = [];
  if (!headers) return result;
  if (Array.isArray(headers)) {
    for (const h of headers) {
      if (h.name && h.name.toLowerCase() === 'set-cookie' && h.value) result.push(h.value);
    }
  } else if (typeof headers === 'object') {
    for (const [name, value] of Object.entries(headers)) {
      if (name.toLowerCase() === 'set-cookie' && value) result.push(value);
    }
  }
  return result;
}

async function handleCapturedCookies(tabId, containerId, url, setCookieHeaders) {
  try {
    if (!url) {
      try {
        const tab = await chrome.tabs.get(tabId);
        url = tab ? tab.url : '';
      } catch { return; }
    }
    if (!url) return;

    const count = await cookieMgr.captureResponseSetCookie(containerId, url, setCookieHeaders);
    if (count > 0) {
      console.log('[v4.4] Captured', count, 'cookie(s) for container', containerId);
      for (const raw of setCookieHeaders) {
        const cookieStrings = raw.split(/,\s*(?=[a-zA-Z][\w-]*=)/);
        for (const cs of cookieStrings) {
          const parts = cs.split(';').map(s => s.trim());
          if (parts.length === 0) continue;
          const nv = parts[0].split('=');
          const name = (nv[0] || '').trim();
          const value = nv.slice(1).join('=').trim();
          if (name && value) {
            debuggerMgr.appendToCache(tabId, name, value);
          }
        }
      }
    }
  } catch (e) {
    console.warn('[v4.4] Error handling captured cookies:', e.message);
  }
}

console.log('[Containers v4.4] Service Worker loaded — All bugs fixed!');
