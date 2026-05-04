// ============================================================
// lib/constants.js — v4.3
// ============================================================

export const CONTAINER_COLORS = [
  { id: 'blue',      hex: '#37adff', name: 'Blue' },
  { id: 'turquoise', hex: '#51c4d3', name: 'Turquoise' },
  { id: 'green',     hex: '#7bc962', name: 'Green' },
  { id: 'yellow',    hex: '#ffcb3e', name: 'Yellow' },
  { id: 'orange',    hex: '#fb9349', name: 'Orange' },
  { id: 'red',       hex: '#f25c54', name: 'Red' },
  { id: 'pink',      hex: '#e861a5', name: 'Pink' },
  { id: 'purple',    hex: '#a87bda', name: 'Purple' },
  { id: 'toolbar',   hex: '#7c7c7d', name: 'Gray' },
];
export const CONTAINER_ICONS = [
  'briefcase','cart','circle','dollar','fingerprint','globe','gift','heart','key','leaf',
  'login','music','palette','phone','shield','star','travel','work','school','home',
];
export const DEFAULT_CONTAINERS = [
  { id: 'personal', name: 'Personal', color: '#37adff', icon: 'fingerprint', order: 0, showTabColor: false },
  { id: 'work',     name: 'Work',     color: '#7bc962', icon: 'briefcase',   order: 1, showTabColor: false },
  { id: 'shopping', name: 'Shopping', color: '#fb9349', icon: 'cart',        order: 2, showTabColor: false },
  { id: 'banking',  name: 'Banking',  color: '#f25c54', icon: 'dollar',      order: 3, showTabColor: false },
];
export const STORAGE_KEYS = {
  CONTAINERS: 'containers',
  TAB_CONTAINER_MAP: 'tab_container_map',
  CONTAINER_COOKIES: 'container_cookies_',
  ALWAYS_OPEN: 'always_open',
  SETTINGS: 'settings',
};
export const SITE_COOKIE_PATTERNS = {
  'web.whatsapp.com':    ['.whatsapp.com', '.facebook.com'],
  'mail.google.com':     ['.google.com'],
  'gmail.com':           ['.google.com'],
  'accounts.google.com': ['.google.com'],
  'twitter.com':         ['.twitter.com', '.x.com', '.twimg.com'],
  'x.com':               ['.twitter.com', '.x.com', '.twimg.com'],
  'facebook.com':        ['.facebook.com', '.fbcdn.net'],
  'instagram.com':       ['.instagram.com', '.fbcdn.net'],
  'discord.com':         ['.discord.com'],
  'linkedin.com':        ['.linkedin.com'],
  'github.com':          ['.github.com'],
  'outlook.live.com':    ['.live.com', '.outlook.com', '.microsoft.com'],
};
export function getCookieDomainsForUrl(url) {
  try {
    const hostname = new URL(url).hostname;
    for (const [siteKey, domains] of Object.entries(SITE_COOKIE_PATTERNS)) {
      if (hostname === siteKey || hostname.endsWith('.' + siteKey)) return domains;
    }
    return [hostname, '.' + hostname];
  } catch { return []; }
}
export const ICON_MAP = {
  briefcase: '\u{1F4BC}', cart: '\u{1F6D2}', circle: '\u2B55', dollar: '\u{1F4B0}',
  fingerprint: '\u{1F464}', globe: '\u{1F310}', gift: '\u{1F381}', heart: '\u{2764}\u{FE0F}',
  key: '\u{1F511}', leaf: '\u{1F343}', login: '\u{1F510}', music: '\u{1F3B5}',
  palette: '\u{1F3A8}', phone: '\u{1F4F1}', shield: '\u{1F6E1}\u{FE0F}', star: '\u{2B50}',
  travel: '\u{2708}\u{FE0F}', work: '\u{1F527}', school: '\u{1F4DA}', home: '\u{1F3E0}',
};
