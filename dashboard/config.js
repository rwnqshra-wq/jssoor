/* ============================================================
   Jusour - Admin Dashboard Configuration
   ============================================================ */

'use strict';

// ============================================================
// 👇 رابط سيرفر Render الخاص بك 👇
// ============================================================
var RENDER_SERVER_URL = 'https://jssoor.onrender.com';

var isLocalhost = /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname);
window.SERVER_URL = isLocalhost ? '' : RENDER_SERVER_URL;

window.DASHBOARD_CONFIG = window.DASHBOARD_CONFIG || {
  apiBaseUrl: window.SERVER_URL
};

