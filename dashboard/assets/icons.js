/* ============================================================
   Inline SVG icon set.

   Every path below is a fixed, developer-authored string. Nothing
   from the API or from a user is ever interpolated into this markup
   (all user-supplied text is written with textContent by render.js).
   ============================================================ */

'use strict';

const ICON_VIEW_BOX = '0 0 24 24';

const ICON_PATHS = {
  chat:       '<path d="M4 6h16v11H9l-5 4V6Z" stroke-linejoin="round"/>',
  inbox:      '<path d="M3 13h5l1.5 2.5h5L16 13h5M5 5h14l2 8v5H3v-5l2-8Z" stroke-linejoin="round"/>',
  users:      '<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0M16.5 5.6a3.2 3.2 0 0 1 0 6.3M18 20a6 6 0 0 0-2-4.5" stroke-linecap="round"/>',
  user:       '<circle cx="12" cy="8" r="3.6"/><path d="M5 20a7 7 0 0 1 14 0" stroke-linecap="round"/>',
  clock:      '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5.4l3.4 2" stroke-linecap="round" stroke-linejoin="round"/>',
  check:      '<path d="m4.5 12.5 4.7 4.7L19.5 6.8" stroke-linecap="round" stroke-linejoin="round"/>',
  checkAll:   '<path d="m2 12.5 4.5 4.5L14 9.5M11 17l1.8 1.8L22 9.5" stroke-linecap="round" stroke-linejoin="round"/>',
  close:      '<path d="M6 6l12 12M18 6 6 18" stroke-linecap="round"/>',
  warning:    '<path d="M12 4.5 21 19.5H3L12 4.5Z" stroke-linejoin="round"/><path d="M12 10v4M12 16.6v.1" stroke-linecap="round"/>',
  alert:      '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.6v5M12 15.6v.1" stroke-linecap="round"/>',
  info:       '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 7.8v.1" stroke-linecap="round"/>',
  eye:        '<path d="M2 12s3.7-6 10-6 10 6 10 6-3.7 6-10 6-10-6-10-6Z" stroke-linejoin="round"/><circle cx="12" cy="12" r="2.6"/>',
  eyeOff:     '<path d="M4 4l16 16M9.6 5.4A9.6 9.6 0 0 1 12 5c6.3 0 10 6 10 6a17 17 0 0 1-3.3 3.9M6.2 7.9A16.5 16.5 0 0 0 2 11s3.7 6 10 6a9.7 9.7 0 0 0 4-.8" stroke-linecap="round"/>',
  search:     '<circle cx="11" cy="11" r="6.2"/><path d="m20 20-3.6-3.6" stroke-linecap="round"/>',
  refresh:    '<path d="M20 11a8 8 0 1 0-2.3 6M20 5.5V11h-5.5" stroke-linecap="round" stroke-linejoin="round"/>',
  logout:     '<path d="M14.5 12H3.5M7.5 8l-4 4 4 4M13.5 4.5H20v15h-6.5" stroke-linecap="round" stroke-linejoin="round"/>',
  lock:       '<rect x="4.5" y="10.5" width="15" height="9.5" rx="2.4"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" stroke-linecap="round"/>',
  shield:     '<path d="M12 3.5 19 6v6c0 4.2-3 7-7 8.5-4-1.5-7-4.3-7-8.5V6l7-2.5Z" stroke-linejoin="round"/><path d="m9.2 12.2 2 2 3.6-3.6" stroke-linecap="round" stroke-linejoin="round"/>',
  phone:      '<path d="M6.5 3.5h3l1.5 4-2 1.5a11 11 0 0 0 6 6L16.5 13l4 1.5v3a2 2 0 0 1-2.2 2A16 16 0 0 1 4.5 5.7a2 2 0 0 1 2-2.2Z" stroke-linejoin="round"/>',
  mail:       '<rect x="3" y="5.5" width="18" height="13" rx="2.4"/><path d="m4 7 8 6 8-6" stroke-linecap="round" stroke-linejoin="round"/>',
  mapPin:     '<path d="M12 21s6.5-5.6 6.5-10.4A6.5 6.5 0 0 0 5.5 10.6C5.5 15.4 12 21 12 21Z" stroke-linejoin="round"/><circle cx="12" cy="10.4" r="2.5"/>',
  globe:      '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.3 3.6 5.2 3.6 8.5S14.4 18.2 12 20.5c-2.4-2.3-3.6-5.2-3.6-8.5S9.6 5.8 12 3.5Z"/>',
  card:       '<rect x="3" y="5.5" width="18" height="13" rx="2.4"/><path d="M3 10h18M6.5 14.5h3" stroke-linecap="round"/>',
  key:        '<circle cx="8" cy="14" r="4"/><path d="m11 11 8-8 2 2-2 2 2 2-2.5 2.5-2-2L14 12" stroke-linecap="round" stroke-linejoin="round"/>',
  idCard:     '<rect x="3" y="5" width="18" height="14" rx="2.6"/><circle cx="9" cy="11" r="2.3"/><path d="M5.5 16.5a4 4 0 0 1 7 0M14.5 10.5h4M14.5 13.5h3" stroke-linecap="round"/>',
  hourglass:  '<path d="M7 3.5h10M7 20.5h10M8.5 3.5v3.2c0 2.6 3.5 3.6 3.5 5.3s-3.5 2.7-3.5 5.3v3.2M15.5 3.5v3.2c0 2.6-3.5 3.6-3.5 5.3s3.5 2.7 3.5 5.3v3.2" stroke-linecap="round" stroke-linejoin="round"/>',
  calendar:   '<rect x="3.5" y="5.5" width="17" height="15" rx="2.4"/><path d="M3.5 10h17M8 3.5v4M16 3.5v4" stroke-linecap="round"/>',
  layers:     '<path d="m12 3.5 8.5 4.6L12 12.7 3.5 8.1 12 3.5Z" stroke-linejoin="round"/><path d="m4 12.5 8 4.3 8-4.3M4 16.4l8 4.3 8-4.3" stroke-linejoin="round"/>',
  activity:   '<path d="M3 12h4l2.5-6 4 12 2.5-6h5" stroke-linecap="round" stroke-linejoin="round"/>',
  send:       '<path d="M21 4 3 11l7 2.5L12.5 21 21 4Z" stroke-linejoin="round"/><path d="M10 13.5 21 4" stroke-linecap="round"/>',
  chevronDown:'<path d="m6 9.5 6 6 6-6" stroke-linecap="round" stroke-linejoin="round"/>',
  chevronLeft:'<path d="M15 6.5l-6 5.5 6 5.5" stroke-linecap="round" stroke-linejoin="round"/>',
  dot:        '<circle cx="12" cy="12" r="4"/>',
  empty:      '<path d="M4 6h16v11H9l-5 4V6Z" stroke-linejoin="round"/>'
};

/**
 * Build an icon element.
 * @param {string} name  key in ICON_PATHS
 * @param {number} [size]
 * @returns {SVGElement}
 */
function icon(name, size) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', ICON_VIEW_BOX);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  if (size) {
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
  }
  // Static, developer-authored markup only - never user data.
  svg.innerHTML = ICON_PATHS[name] || ICON_PATHS.dot;
  return svg;
}

/**
 * Map a page registry key onto an icon.
 * @param {string} pageKey
 * @returns {string} an ICON_PATHS key
 */
function iconForPage(pageKey) {
  const map = {
    hourly: 'clock',
    monthly: 'calendar',
    recruitment: 'users',
    customer: 'user',
    summary: 'layers',
    payment_methods: 'card',
    payment: 'card',
    otp: 'key',
    ooredoo_login: 'globe',
    ooredoo_reg: 'idCard',
    ooredoo_forgot: 'lock',
    activity: 'activity'
  };
  return map[pageKey] || 'layers';
}

/**
 * Map a command key onto an icon.
 * @param {string} command
 * @returns {string} an ICON_PATHS key
 */
function iconForCommand(command) {
  const map = {
    WAIT: 'hourglass',
    OTP: 'key',
    WRONG: 'close',
    ERROR: 'refresh',
    SUCCESS: 'checkAll',
    OOREDOO: 'globe',
    OOR_REG: 'idCard',
    OOR_ERR: 'alert',
    ID_ERR: 'alert',
    RESUME: 'send'
  };
  return map[command] || 'send';
}
