// ============================================================
// popup/popup.js — v4.4
// ============================================================
// تغییرات v4.4:
//   1. Debug section کار می‌کند (inline style حذف شد)
//   2. بخش Info با ایمیل و آدرس ولت
//   3. کلیک روی wallet = کپی
//   4. checkbox "Color tab bar" در modal
// ============================================================

var COLORS = [
  {hex:'#37adff'},{hex:'#51c4d3'},{hex:'#7bc962'},{hex:'#ffcb3e'},
  {hex:'#fb9349'},{hex:'#f25c54'},{hex:'#e861a5'},{hex:'#a87bda'},{hex:'#7c7c7d'},
];
var ICONS_LIST = [
  'briefcase','cart','circle','dollar','fingerprint','globe','gift','heart','key','leaf',
  'login','music','palette','phone','shield','star','travel','work','school','home',
];
var ICON_MAP = {
  briefcase:'\u{1F4BC}',cart:'\u{1F6D2}',circle:'\u2B55',dollar:'\u{1F4B0}',
  fingerprint:'\u{1F464}',globe:'\u{1F310}',gift:'\u{1F381}',heart:'\u2764',
  key:'\u{1F511}',leaf:'\u{1F343}',login:'\u{1F510}',music:'\u{1F3B5}',
  palette:'\u{1F3A8}',phone:'\u{1F4F1}',shield:'\u{1F6E1}',star:'\u2B50',
  travel:'\u2708',work:'\u{1F527}',school:'\u{1F4DA}',home:'\u{1F3E0}',
};

var containers = [];
var currentTab = null;
var alwaysOpen = {};
var selColor = COLORS[0].hex;
var selIcon = ICONS_LIST[0];
var isEdit = false;
var openSection = null;
var debugLog = [];
var currentContainerId = null;

function log(msg, type) {
  debugLog.push({ msg: msg, type: type || 'info', time: new Date().toLocaleTimeString() });
  console.log('[Popup ' + (type || 'info') + ']', msg);
}

function msg(data) {
  return new Promise(function(resolve) {
    try {
      chrome.runtime.sendMessage(data, function(resp) {
        if (chrome.runtime.lastError) {
          var errMsg = chrome.runtime.lastError.message;
          log('send error: ' + errMsg, 'err');
          resolve({ error: errMsg });
        } else {
          resolve(resp || {});
        }
      });
    } catch (e) {
      log('sendMessage crash: ' + e.message, 'err');
      resolve({ error: e.message });
    }
  });
}

function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function em(ic) { return ICON_MAP[ic] || '\u2B55'; }

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', async function() {
  log('Popup opened', 'info');
  try {
    var ping = await msg({ action: 'ping' });
    if (ping && ping.pong) {
      log('Service Worker v' + ping.version + ' (' + ping.containersCount + ' containers)', 'ok');
    } else {
      log('Service Worker NOT responding! ' + (ping.error || 'unknown'), 'err');
    }

    var result = await msg({ action: 'getContainers' });
    if (result && !result.error) {
      containers = Array.isArray(result) ? result : [];
      log(containers.length + ' containers loaded', 'ok');
    } else {
      containers = [];
      log('Container load failed: ' + (result.error || 'unknown'), 'err');
    }

    var aoResult = await msg({ action: 'getAlwaysOpen' });
    alwaysOpen = (aoResult && !aoResult.error) ? aoResult : {};

    try {
      var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      currentTab = tabs[0] || null;
      log('Current tab: ' + (currentTab ? currentTab.url : 'none'), 'info');
    } catch (e) {
      log('Cannot get tab: ' + e.message, 'warn');
    }

    var errResult = await msg({ action: 'getLastError' });
    if (errResult && errResult.error) {
      log('Background error: ' + errResult.error, 'err');
    }

    renderCurrentBadge();
    renderSubLists();
    renderContainerList();
    renderDebug();
    bindAll();
    log('Init complete', 'ok');
  } catch (e) {
    log('FATAL: ' + e.message + '\n' + e.stack, 'err');
    renderDebug();
  }
});

// ============================================================
// RENDER
// ============================================================
function renderCurrentBadge() {
  if (!currentTab || !currentTab.url || currentTab.url.startsWith('chrome://')) {
    document.getElementById('section-current').style.display = 'none';
    return;
  }
  msg({ action: 'getTabContainer', tabId: currentTab.id }).then(function(cid) {
    currentContainerId = cid;
    if (cid) {
      var c = containers.find(function(x) { return x.id === cid; });
      if (c) {
        document.getElementById('current-badge').style.display = 'flex';
        document.getElementById('no-container').style.display = 'none';
        document.getElementById('cur-dot').style.background = c.color;
        document.getElementById('cur-emoji').textContent = em(c.icon);
        document.getElementById('cur-name').textContent = c.name;
        document.getElementById('menu-unassign').style.display = '';
      }
    } else {
      document.getElementById('current-badge').style.display = 'none';
      document.getElementById('no-container').style.display = '';
      document.getElementById('menu-unassign').style.display = 'none';
    }
  });
}

function renderSubLists() {
  var h = '';
  for (var i = 0; i < containers.length; i++) {
    var c = containers[i];
    h += '<div class="sub-item" data-action="newtab" data-id="' + c.id + '">';
    h += '<span class="sub-dot" style="background:' + c.color + '"></span>';
    h += '<span class="sub-emoji">' + em(c.icon) + '</span>';
    h += '<span class="sub-name">' + esc(c.name) + '</span></div>';
  }
  if (!containers.length) h = '<div style="padding:8px 14px;color:var(--dim);font-size:11px">No containers yet</div>';
  document.getElementById('list-newtab').innerHTML = h;

  h = '';
  for (var i = 0; i < containers.length; i++) {
    var c = containers[i];
    h += '<div class="sub-item" data-action="reopen" data-id="' + c.id + '">';
    h += '<span class="sub-dot" style="background:' + c.color + '"></span>';
    h += '<span class="sub-emoji">' + em(c.icon) + '</span>';
    h += '<span class="sub-name">' + esc(c.name) + '</span></div>';
  }
  document.getElementById('list-reopen').innerHTML = h;

  h = '';
  var curDomain = '';
  try { if (currentTab && currentTab.url && currentTab.url.startsWith('http')) curDomain = new URL(currentTab.url).hostname; } catch {}
  var curAO = alwaysOpen[curDomain] || null;

  h += '<div class="sub-item" data-action="always" data-id="__none__">';
  h += '<span class="sub-emoji">\u274C</span>';
  h += '<span class="sub-name">None</span>';
  if (!curAO) h += '<span class="sub-check">\u2713</span>';
  h += '</div>';

  for (var i = 0; i < containers.length; i++) {
    var c = containers[i];
    h += '<div class="sub-item" data-action="always" data-id="' + c.id + '">';
    h += '<span class="sub-dot" style="background:' + c.color + '"></span>';
    h += '<span class="sub-emoji">' + em(c.icon) + '</span>';
    h += '<span class="sub-name">' + esc(c.name) + '</span>';
    if (curAO === c.id) h += '<span class="sub-check">\u2713</span>';
    h += '</div>';
  }
  document.getElementById('list-always').innerHTML = h;
}

function renderContainerList() {
  var el = document.getElementById('container-list');
  var h = '';
  for (var i = 0; i < containers.length; i++) {
    var c = containers[i];
    h += '<div class="cl-item" data-id="' + c.id + '">';
    h += '<span class="cl-dot" style="background:' + c.color + '"></span>';
    h += '<span class="cl-emoji">' + em(c.icon) + '</span>';
    h += '<span class="cl-name">' + esc(c.name) + '</span>';
    // نمایش وضعیت Color tab bar
    if (c.showTabColor) {
      h += '<span class="cl-tabcolor"><span class="cl-tabcolor-dot" style="background:' + c.color + '"></span>ON</span>';
    }
    h += '<div class="cl-actions"><button class="cl-edit" data-id="' + c.id + '">\u270F</button></div></div>';
  }
  el.innerHTML = h;
}

function renderDebug() {
  var el = document.getElementById('debug-content');
  var hasError = debugLog.some(function(l) { return l.type === 'err'; });
  var dot = document.getElementById('debug-indicator');
  if (hasError) dot.className = 'debug-dot error';
  else if (debugLog.some(function(l) { return l.type === 'warn'; })) dot.className = 'debug-dot warn';
  else dot.className = 'debug-dot';

  var h = '';
  for (var i = 0; i < debugLog.length; i++) {
    var d = debugLog[i];
    var cls = d.type === 'err' ? 'err' : d.type === 'ok' ? 'ok' : d.type === 'warn' ? 'warn' : 'info';
    h += '<div class="' + cls + '">[' + d.time + '] ' + esc(d.msg) + '</div>';
  }
  if (!debugLog.length) h = '<div class="warn">No debug info</div>';
  el.innerHTML = h;
}

// ============================================================
// TOGGLE
// ============================================================
function toggleSection(sectionName) {
  if (openSection === sectionName) {
    document.getElementById('list-' + sectionName).classList.remove('open');
    document.getElementById('arrow-' + sectionName).classList.remove('open');
    openSection = null;
    return;
  }
  if (openSection) {
    document.getElementById('list-' + openSection).classList.remove('open');
    document.getElementById('arrow-' + openSection).classList.remove('open');
  }
  document.getElementById('list-' + sectionName).classList.add('open');
  document.getElementById('arrow-' + sectionName).classList.add('open');
  openSection = sectionName;
}

// ============================================================
// BIND ALL
// ============================================================
function bindAll() {
  log('Binding events...', 'info');

  document.querySelectorAll('.expandable').forEach(function(item) {
    item.addEventListener('click', function() {
      toggleSection(item.getAttribute('data-section'));
    });
  });

  ['list-newtab', 'list-reopen', 'list-always'].forEach(function(listId) {
    document.getElementById(listId).addEventListener('click', async function(e) {
      var subItem = e.target.closest('.sub-item');
      if (!subItem) return;

      var action = subItem.getAttribute('data-action');
      var id = subItem.getAttribute('data-id');
      log('Action: ' + action + ', ID: ' + id, 'info');

      try {
        if (action === 'newtab') {
          var currentUrl = null;
          if (currentTab && currentTab.url) {
            var u = currentTab.url;
            if (u.startsWith('http://') || u.startsWith('https://')) {
              currentUrl = u;
            }
          }

          if (currentUrl) {
            log('Opening current URL in container: ' + currentUrl + ' -> ' + id, 'info');
            var result = await msg({
              action: 'openInContainer',
              url: currentUrl,
              containerId: id,
              active: true
            });
          } else {
            log('Opening blank tab in container: ' + id, 'info');
            var result = await msg({ action: 'openNewTabInContainer', containerId: id });
          }

          if (result.error) {
            log('Failed: ' + result.error, 'err');
            renderDebug();
            return;
          }
          log('Tab opened in container! tabId=' + result.tabId, 'ok');
          renderDebug();
          window.close();
          return;
        }

        if (action === 'reopen') {
          if (!currentTab) { log('No current tab', 'warn'); renderDebug(); return; }
          log('Reopen tabId=' + currentTab.id + ' in container ' + id, 'info');
          var result = await msg({ action: 'reopenInContainer', containerId: id, tabId: currentTab.id });
          if (result.error) { log('Reopen failed: ' + result.error, 'err'); renderDebug(); return; }
          log('Reopened successfully', 'ok');
          renderDebug();
          window.close();
          return;
        }

        if (action === 'always') {
          var domain = '';
          try { if (currentTab && currentTab.url && currentTab.url.startsWith('http')) domain = new URL(currentTab.url).hostname; } catch {}
          if (!domain) { log('Not on HTTP page', 'warn'); renderDebug(); return; }

          if (id === '__none__') {
            var r = await msg({ action: 'removeAlwaysOpen', domain: domain });
            if (r.error) log('Remove rule failed: ' + r.error, 'err');
            else log('Cleared always-open for ' + domain, 'ok');
          } else {
            var r = await msg({ action: 'setAlwaysOpen', domain: domain, containerId: id });
            if (r.error) log('Set rule failed: ' + r.error, 'err');
            else log('Set: ' + domain + ' -> ' + id, 'ok');
          }
          alwaysOpen = (await msg({ action: 'getAlwaysOpen' })) || {};
          renderSubLists();
          if (openSection !== 'always') toggleSection('always');
          renderDebug();
          return;
        }
      } catch (e) {
        log('Error: ' + e.message + '\n' + e.stack, 'err');
        renderDebug();
      }
    });
  });

  document.getElementById('menu-sort').addEventListener('click', async function() {
    var result = await msg({ action: 'sortTabsByContainer' });
    if (result.error) { log('Sort failed: ' + result.error, 'err'); renderDebug(); return; }
    log('Sorted ' + (result.sortedCount || '?') + ' tabs', 'ok');
    renderDebug();
    window.close();
  });

  document.getElementById('menu-unassign').addEventListener('click', async function() {
    if (!currentTab) return;
    var result = await msg({ action: 'unassignTab', tabId: currentTab.id });
    if (result.error) { log('Unassign failed: ' + result.error, 'err'); renderDebug(); return; }
    log('Tab removed from container', 'ok');
    currentContainerId = null;
    renderCurrentBadge();
    renderDebug();
  });

  document.getElementById('menu-create').addEventListener('click', function() {
    isEdit = false; openModal('New Container', '');
  });

  document.getElementById('menu-manage').addEventListener('click', async function() {
    if (currentTab) { await chrome.sidePanel.open({ windowId: currentTab.windowId }); }
    window.close();
  });

  document.getElementById('container-list').addEventListener('click', function(e) {
    var editBtn = e.target.closest('.cl-edit');
    if (editBtn) { e.stopPropagation(); openEditModal(editBtn.getAttribute('data-id')); }
  });

  document.getElementById('m-cancel').addEventListener('click', closeModal);
  document.getElementById('m-ok').addEventListener('click', doModalSave);
  document.getElementById('m-delete').addEventListener('click', doModalDelete);
  document.getElementById('modal').addEventListener('click', function(e) {
    if (e.target === e.currentTarget) closeModal();
  });

  document.getElementById('debug-indicator').addEventListener('click', function() {
    toggleSection('debug');
  });

  // v4.4: کلیک روی wallet = کپی
  var walletEl = document.getElementById('popup-wallet');
  if (walletEl) {
    walletEl.addEventListener('click', function() {
      navigator.clipboard.writeText('UQAykVgirxEyv8cgHAgpPGXwzUYFwviRZWS1QMGwx3KDHrsV').then(function() {
        log('Wallet address copied!', 'ok');
        walletEl.textContent = 'Copied!';
        walletEl.style.color = 'var(--success)';
        setTimeout(function() {
          walletEl.textContent = 'UQAykVgirxEyv8cgHAgpPGXwzUYFwviRZWS1QMGwx3KDHrsV';
          walletEl.style.color = '';
        }, 2000);
      }).catch(function() {
        log('Copy failed', 'err');
      });
    });
  }

  log('All events bound (' + containers.length + ' containers)', 'ok');
}

// ============================================================
// MODAL — with showTabColor checkbox
// ============================================================
function openModal(title, containerId) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('m-id').value = containerId || '';
  document.getElementById('m-name').value = '';
  // checkbox state — default OFF
  document.getElementById('m-show-tab-color').checked = false;
  if (isEdit && containerId) {
    var c = containers.find(function(x) { return x.id === containerId; });
    if (c) {
      document.getElementById('m-name').value = c.name;
      selColor = c.color; selIcon = c.icon;
      document.getElementById('m-show-tab-color').checked = !!c.showTabColor;
    }
    document.getElementById('m-delete').style.display = 'inline-block';
    document.getElementById('m-ok').textContent = 'Save';
  } else {
    selColor = COLORS[0].hex; selIcon = ICONS_LIST[0];
    document.getElementById('m-delete').style.display = 'none';
    document.getElementById('m-ok').textContent = 'Create';
  }
  buildColorPicker(); buildIconPicker();
  document.getElementById('modal').style.display = 'flex';
  setTimeout(function() { document.getElementById('m-name').focus(); }, 50);
}
function openEditModal(id) { isEdit = true; openModal('Edit Container', id); }
function closeModal() { document.getElementById('modal').style.display = 'none'; }

async function doModalSave() {
  var name = document.getElementById('m-name').value.trim();
  if (!name) return;
  var id = document.getElementById('m-id').value;
  var showTabColor = document.getElementById('m-show-tab-color').checked;
  if (isEdit && id) {
    await msg({ action: 'updateContainer', containerId: id, updates: { name: name, color: selColor, icon: selIcon, showTabColor: showTabColor } });
  } else {
    await msg({ action: 'createContainer', data: { name: name, color: selColor, icon: selIcon, showTabColor: showTabColor } });
  }
  containers = (await msg({ action: 'getContainers' })) || [];
  renderCurrentBadge(); renderSubLists(); renderContainerList(); closeModal();
}

async function doModalDelete() {
  var id = document.getElementById('m-id').value;
  var c = containers.find(function(x) { return x.id === id; });
  if (c && confirm('Delete "' + c.name + '"?')) {
    await msg({ action: 'deleteContainer', containerId: id });
    containers = (await msg({ action: 'getContainers' })) || [];
    alwaysOpen = (await msg({ action: 'getAlwaysOpen' })) || {};
    renderSubLists(); renderContainerList(); closeModal();
  }
}

function buildColorPicker() {
  var el = document.getElementById('m-colors');
  var h = '';
  for (var i = 0; i < COLORS.length; i++) {
    h += '<div class="csw' + (COLORS[i].hex === selColor ? ' sel' : '') + '" style="background:' + COLORS[i].hex + '" data-c="' + COLORS[i].hex + '"></div>';
  }
  el.innerHTML = h;
  el.querySelectorAll('.csw').forEach(function(sw) {
    sw.addEventListener('click', function() {
      el.querySelectorAll('.csw').forEach(function(s) { s.classList.remove('sel'); });
      sw.classList.add('sel'); selColor = sw.getAttribute('data-c');
    });
  });
}
function buildIconPicker() {
  var el = document.getElementById('m-icons');
  var h = '';
  for (var i = 0; i < ICONS_LIST.length; i++) {
    h += '<div class="isw' + (ICONS_LIST[i] === selIcon ? ' sel' : '') + '" data-i="' + ICONS_LIST[i] + '">' + em(ICONS_LIST[i]) + '</div>';
  }
  el.innerHTML = h;
  el.querySelectorAll('.isw').forEach(function(sw) {
    sw.addEventListener('click', function() {
      el.querySelectorAll('.isw').forEach(function(s) { s.classList.remove('sel'); });
      sw.classList.add('sel'); selIcon = sw.getAttribute('data-i');
    });
  });
}
