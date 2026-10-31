/* ============================================================
   Jusour - Admin Dashboard Configuration
   ============================================================ */

'use strict';

// ============================================================
// 👇 ضع رابط سيرفر Render الخاص بك هنا بدلاً من الرابط التجريبي 👇
// ============================================================
var RENDER_SERVER_URL = 'https://jssoor.onrender.com';

window.SERVER_URL = (
  RENDER_SERVER_URL &&
  RENDER_SERVER_URL !== 'https://jssoor.onrender.com'
) ? RENDER_SERVER_URL : '';

window.DASHBOARD_CONFIG = window.DASHBOARD_CONFIG || {
  apiBaseUrl: window.SERVER_URL
};

