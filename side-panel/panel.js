// ============================================================
// side-panel/panel.js — v4.4
// ============================================================
// تغییرات v4.4:
//   1. checkbox "Color tab bar" per container (دیفالت خاموش)
//   2. کلیک روی container name = ویرایش (نه prompt!)
//   3. بخش Info با ایمیل و آدرس ولت
//   4. نمایش وضعیت showTabColor در لیست container
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
var alwaysOpen = {};
var selColor = COLORS[0].hex;
var selIcon = ICONS_LIST[0];
var selShowTabColor = false;
var isEdit = false;

function msg(d) {
  return new Promise(function(r) {
    try {
      chrome.runtime.sendMessage(d, function(resp) {
        if (chrome.runtime.lastError) { r({ error: chrome.runtime.lastError.message }); }
        else { r(resp || null); }
      });
    } catch (e) { r({ error: e.message }); }
  });
}
function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function em(ic) { return ICON_MAP[ic] || '\u2B55'; }

document.addEventListener('DOMContentLoaded', async function() {
  try {
    containers = (await msg({ action: 'getContainers' })) || [];
    alwaysOpen = (await msg({ action: 'getAlwaysOpen' })) || {};
    renderList(); renderRules(); renderSelects(); loadTabInfo(); bind();

    // Copy wallet address on click
    var walletEl = document.getElementById('wallet-addr');
    if (walletEl) {
      walletEl.addEventListener('click', function() {
        navigator.clipboard.writeText('UQAykVgirxEyv8cgHAgpPGXwzUYFwviRZWS1QMGwx3KDHrsV').then(function() {
          toast('Wallet address copied!');
        }).catch(function() {
          toast('Copy failed');
        });
      });
    }
  } catch (e) { console.error('[Panel] Error:', e); }
});

async function loadTabInfo() {
  var sec = document.getElementById('tab-info');
  try {
    var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs[0] || !tabs[0].url || tabs[0].url.startsWith('chrome://')) { sec.style.display = 'none'; return; }
    var tab = tabs[0];
    sec.style.display = 'block';
    document.getElementById('info-url').textContent = tab.url;
    var domain = new URL(tab.url).hostname;
    var cid = await msg({ action: 'getTabContainer', tabId: tab.id });
    var el = document.getElementById('info-cname');
    if (cid) {
      var c = containers.find(function(x) { return x.id === cid; });
      el.textContent = c ? c.name : cid;
      el.style.color = c ? c.color : '';
    } else { el.textContent = 'None'; el.style.color = ''; }
    var aoEl = document.getElementById('info-always');
    if (alwaysOpen[domain]) {
      var ac = containers.find(function(x) { return x.id === alwaysOpen[domain]; });
      aoEl.textContent = ac ? ac.name : alwaysOpen[domain];
      aoEl.style.color = ac ? ac.color : '';
    } else { aoEl.textContent = 'None'; aoEl.style.color = ''; }
  } catch { sec.style.display = 'none'; }
}

function renderList() {
  var el = document.getElementById('container-list');
  if (!containers.length) {
    el.innerHTML = '<div class="empty"><div style="font-size:32px">\u{1F4E6}</div><p>No containers. Click + to create one.</p></div>';
    return;
  }
  var h = '';
  for (var i = 0; i < containers.length; i++) {
    var c = containers[i];
    h += '<div class="container-item" data-id="' + c.id + '" style="border-left-color:' + c.color + '">';
    h += '<div class="c-dot" style="background:' + c.color + '"></div>';
    h += '<div class="c-emoji">' + em(c.icon) + '</div>';
    h += '<div class="c-info"><div class="c-name">' + esc(c.name) + '</div>';
    // نمایش وضعیت Color tab bar
    if (c.showTabColor) {
      h += '<div class="c-tabcolor"><span class="c-tabcolor-dot" style="background:' + c.color + '"></span>Tab color ON</div>';
    }
    h += '</div>';
    h += '<div class="c-actions">';
    h += '<button class="editbtn" data-id="' + c.id + '">\u270F</button>';
    h += '<button class="del" data-id="' + c.id + '">\u{1F5D1}</button>';
    h += '</div></div>';
  }
  el.innerHTML = h;
  // کلیک روی container item = ویرایش (نه prompt!)
  el.querySelectorAll('.container-item').forEach(function(item) {
    item.addEventListener('click', function(e) {
      if (e.target.closest('.c-actions')) return;
      openEdit(item.getAttribute('data-id'));
    });
  });
  el.querySelectorAll('.editbtn').forEach(function(b) {
    b.addEventListener('click', function(e) { e.stopPropagation(); openEdit(b.getAttribute('data-id')); });
  });
  el.querySelectorAll('.del').forEach(function(b) {
    b.addEventListener('click', async function(e) {
      e.stopPropagation();
      var c = containers.find(function(x) { return x.id === b.getAttribute('data-id'); });
      if (confirm('Delete "' + (c ? c.name : '') + '"?')) {
        await msg({ action: 'deleteContainer', containerId: b.getAttribute('data-id') });
        containers = (await msg({ action: 'getContainers' })) || [];
        alwaysOpen = (await msg({ action: 'getAlwaysOpen' })) || {};
        renderList(); renderRules(); renderSelects(); toast('Deleted');
      }
    });
  });
}

function renderRules() {
  var el = document.getElementById('always-rules');
  var entries = Object.entries(alwaysOpen);
  if (!entries.length) {
    el.innerHTML = '<div style="padding:4px 16px;color:var(--dim);font-size:11px;">No rules. Use popup "Always Open This Site in..." to add.</div>';
    return;
  }
  var h = '';
  for (var i = 0; i < entries.length; i++) {
    var domain = entries[i][0]; var cid = entries[i][1];
    var c = containers.find(function(x) { return x.id === cid; });
    h += '<div class="rule-item"><span class="rule-domain">' + esc(domain) + '</span><span class="rule-arrow">\u27A1</span>';
    h += '<span class="rule-container" style="color:' + (c ? c.color : '') + '">' + esc(c ? c.name : cid) + '</span>';
    h += '<button class="rule-del" data-domain="' + esc(domain) + '" title="Remove">\u2715</button></div>';
  }
  el.innerHTML = h;
  el.querySelectorAll('.rule-del').forEach(function(b) {
    b.addEventListener('click', async function() {
      await msg({ action: 'removeAlwaysOpen', domain: b.getAttribute('data-domain') });
      alwaysOpen = (await msg({ action: 'getAlwaysOpen' })) || {};
      renderRules(); toast('Rule removed');
    });
  });
}

function renderSelects() {
  var opts = '';
  for (var i = 0; i < containers.length; i++) opts += '<option value="' + containers[i].id + '">' + esc(containers[i].name) + '</option>';
  document.getElementById('q-container').innerHTML = opts;
}

function bind() {
  document.getElementById('btn-add').addEventListener('click', function() { openCreate(); });
  document.getElementById('m-cancel').addEventListener('click', closeModal);
  document.getElementById('m-ok').addEventListener('click', doSave);
  document.getElementById('m-delete').addEventListener('click', doDelete);
  document.getElementById('modal').addEventListener('click', function(e) { if (e.target === e.currentTarget) closeModal(); });
  document.getElementById('btn-q-open').addEventListener('click', doQuickOpen);
  document.getElementById('q-url').addEventListener('keypress', function(e) { if (e.key === 'Enter') doQuickOpen(); });
  document.getElementById('btn-clear-always').addEventListener('click', async function() {
    try {
      var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0] && tabs[0].url) {
        var domain = new URL(tabs[0].url).hostname;
        await msg({ action: 'removeAlwaysOpen', domain: domain });
        alwaysOpen = (await msg({ action: 'getAlwaysOpen' })) || {};
        loadTabInfo(); renderRules(); toast('Rule cleared');
      }
    } catch {}
  });
  document.getElementById('btn-remove-tab').addEventListener('click', async function() {
    try {
      var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]) {
        await msg({ action: 'unassignTab', tabId: tabs[0].id });
        loadTabInfo(); toast('Removed from container');
      }
    } catch {}
  });
}

function doQuickOpen() {
  var url = document.getElementById('q-url').value.trim();
  var cid = document.getElementById('q-container').value;
  if (!url) { toast('Enter a URL'); return; }
  if (!cid) { toast('Select a container'); return; }
  if (!url.match(/^https?:\/\//)) url = 'https://' + url;
  msg({ action: 'openInContainer', url: url, containerId: cid });
  var c = containers.find(function(x) { return x.id === cid; });
  toast('Opened in "' + (c ? c.name : '') + '"');
  document.getElementById('q-url').value = '';
}

function openCreate() {
  isEdit = false;
  document.getElementById('modal-title').textContent = 'New Container';
  document.getElementById('m-id').value = '';
  document.getElementById('m-name').value = '';
  selColor = COLORS[0].hex; selIcon = ICONS_LIST[0]; selShowTabColor = false;
  document.getElementById('m-show-tab-color').checked = false;
  buildCP(); buildIP();
  document.getElementById('m-delete').style.display = 'none';
  document.getElementById('m-ok').textContent = 'Create';
  document.getElementById('modal').style.display = 'flex';
  setTimeout(function() { document.getElementById('m-name').focus(); }, 100);
}

function openEdit(id) {
  isEdit = true;
  var c = containers.find(function(x) { return x.id === id; });
  if (!c) return;
  document.getElementById('modal-title').textContent = 'Edit Container';
  document.getElementById('m-id').value = id;
  document.getElementById('m-name').value = c.name;
  selColor = c.color; selIcon = c.icon; selShowTabColor = !!c.showTabColor;
  document.getElementById('m-show-tab-color').checked = selShowTabColor;
  buildCP(); buildIP();
  document.getElementById('m-delete').style.display = 'inline-block';
  document.getElementById('m-ok').textContent = 'Save';
  document.getElementById('modal').style.display = 'flex';
  setTimeout(function() { document.getElementById('m-name').focus(); }, 100);
}

function closeModal() { document.getElementById('modal').style.display = 'none'; }

async function doSave() {
  var id = document.getElementById('m-id').value;
  var name = document.getElementById('m-name').value.trim();
  if (!name) { toast('Enter a name'); return; }
  var showTabColor = document.getElementById('m-show-tab-color').checked;
  if (isEdit) {
    await msg({ action: 'updateContainer', containerId: id, updates: { name: name, color: selColor, icon: selIcon, showTabColor: showTabColor } });
  } else {
    await msg({ action: 'createContainer', data: { name: name, color: selColor, icon: selIcon, showTabColor: showTabColor } });
  }
  containers = (await msg({ action: 'getContainers' })) || [];
  renderList(); renderRules(); renderSelects(); loadTabInfo(); closeModal();
  toast(isEdit ? 'Updated' : 'Created');
}

async function doDelete() {
  var id = document.getElementById('m-id').value;
  if (confirm('Delete this container?')) {
    await msg({ action: 'deleteContainer', containerId: id });
    containers = (await msg({ action: 'getContainers' })) || [];
    alwaysOpen = (await msg({ action: 'getAlwaysOpen' })) || {};
    renderList(); renderRules(); renderSelects(); loadTabInfo(); closeModal(); toast('Deleted');
  }
}

function buildCP() {
  var el = document.getElementById('m-colors');
  var h = '';
  for (var i = 0; i < COLORS.length; i++) h += '<div class="csw' + (COLORS[i].hex === selColor ? ' sel' : '') + '" style="background:' + COLORS[i].hex + '" data-c="' + COLORS[i].hex + '"></div>';
  el.innerHTML = h;
  el.querySelectorAll('.csw').forEach(function(sw) {
    sw.addEventListener('click', function() { el.querySelectorAll('.csw').forEach(function(s) { s.classList.remove('sel'); }); sw.classList.add('sel'); selColor = sw.getAttribute('data-c'); });
  });
}

function buildIP() {
  var el = document.getElementById('m-icons');
  var h = '';
  for (var i = 0; i < ICONS_LIST.length; i++) h += '<div class="isw' + (ICONS_LIST[i] === selIcon ? ' sel' : '') + '" data-i="' + ICONS_LIST[i] + '">' + em(ICONS_LIST[i]) + '</div>';
  el.innerHTML = h;
  el.querySelectorAll('.isw').forEach(function(sw) {
    sw.addEventListener('click', function() { el.querySelectorAll('.isw').forEach(function(s) { s.classList.remove('sel'); }); sw.classList.add('sel'); selIcon = sw.getAttribute('data-i'); });
  });
}

function toast(m) {
  document.querySelectorAll('.toast').forEach(function(t) { t.remove(); });
  var el = document.createElement('div'); el.className = 'toast'; el.textContent = m;
  document.body.appendChild(el);
  setTimeout(function() { el.remove(); }, 2500);
}
