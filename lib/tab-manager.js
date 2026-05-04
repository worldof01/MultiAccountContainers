import { STORAGE_KEYS } from './constants.js';
class TabManager {
  constructor() { this._map = {}; }
  async init() {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.TAB_CONTAINER_MAP);
    this._map = stored[STORAGE_KEYS.TAB_CONTAINER_MAP] || {};
    return this._map;
  }
  async _persist() { await chrome.storage.local.set({ [STORAGE_KEYS.TAB_CONTAINER_MAP]: this._map }); }
  async assign(tabId, containerId) { this._map[tabId] = containerId; await this._persist(); }
  getContainer(tabId) { return this._map[tabId] || null; }
  async remove(tabId) { delete this._map[tabId]; await this._persist(); }
  getMap() { return { ...this._map }; }
}
export default TabManager;
