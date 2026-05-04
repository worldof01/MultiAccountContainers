import { STORAGE_KEYS, DEFAULT_CONTAINERS } from './constants.js';
class ContainerManager {
  constructor() { this._cache = null; }
  async init() {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.CONTAINERS);
    if (!stored[STORAGE_KEYS.CONTAINERS]) {
      const defaults = {};
      for (const c of DEFAULT_CONTAINERS) defaults[c.id] = c;
      await chrome.storage.local.set({ [STORAGE_KEYS.CONTAINERS]: defaults });
      this._cache = defaults;
    } else { this._cache = stored[STORAGE_KEYS.CONTAINERS]; }
    return this._cache;
  }
  async getAll() { if (!this._cache) await this.init(); return this._cache; }
  async get(id) { if (!this._cache) await this.init(); return this._cache[id] || null; }
  async create({ id, name, color = '#7c7c7d', icon = 'circle', showTabColor = false }) {
    if (!this._cache) await this.init();
    const cid = id || 'c-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const maxOrder = Object.values(this._cache).reduce((m, c) => Math.max(m, c.order || 0), -1);
    const container = { id: cid, name: name || 'Unnamed', color, icon, showTabColor, order: maxOrder + 1, createdAt: Date.now() };
    this._cache[cid] = container;
    await chrome.storage.local.set({ [STORAGE_KEYS.CONTAINERS]: this._cache });
    return container;
  }
  async update(id, updates) {
    if (!this._cache) await this.init();
    if (!this._cache[id]) throw new Error('Not found');
    this._cache[id] = { ...this._cache[id], ...updates };
    await chrome.storage.local.set({ [STORAGE_KEYS.CONTAINERS]: this._cache });
    return this._cache[id];
  }
  async delete(id) {
    if (!this._cache) await this.init();
    if (!this._cache[id]) return;
    await chrome.storage.local.remove(STORAGE_KEYS.CONTAINER_COOKIES + id);
    const { [STORAGE_KEYS.TAB_CONTAINER_MAP]: tabMap } = await chrome.storage.local.get(STORAGE_KEYS.TAB_CONTAINER_MAP);
    if (tabMap) { const u = {}; for (const [t, c] of Object.entries(tabMap)) { if (c !== id) u[t] = c; } await chrome.storage.local.set({ [STORAGE_KEYS.TAB_CONTAINER_MAP]: u }); }
    delete this._cache[id];
    await chrome.storage.local.set({ [STORAGE_KEYS.CONTAINERS]: this._cache });
  }
  async getSorted() { const all = await this.getAll(); return Object.values(all).sort((a, b) => (a.order || 0) - (b.order || 0)); }
}
export default ContainerManager;
