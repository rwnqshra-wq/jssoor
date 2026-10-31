/* ============================================================
   API client.
   Thin wrapper over fetch that keeps the CSRF token, sends both
   the session cookie and Bearer token (for cross-domain Render
   compatibility), and normalises error handling.
   ============================================================ */

'use strict';

/** Resolve the backend API base URL from config.js or query string. */
function getDashboardApiBase() {
  var fromQuery = '';
  try {
    fromQuery = new URLSearchParams(window.location.search).get('api') || '';
    if (fromQuery) {
      sessionStorage.setItem('jusour_dashboard_api', fromQuery);
    } else {
      fromQuery = sessionStorage.getItem('jusour_dashboard_api') || '';
    }
  } catch (e) {}

  var configured =
    fromQuery ||
    (window.DASHBOARD_CONFIG && window.DASHBOARD_CONFIG.apiBaseUrl) ||
    window.SERVER_URL ||
    '';

  configured = String(configured).trim().replace(/\/+$/, '');

  if (!configured) {
    return window.location.origin + '/api';
  }

  if (/\/api$/i.test(configured)) {
    return configured;
  }

  return configured + '/api';
}

/** Instance-scoped storage key for the session token & CSRF token. */
function getSessionStorageKey(suffix) {
  var scope = (getDashboardApiBase() + '|' + window.location.host).replace(/[^a-zA-Z0-9]/g, '_');
  return 'jusour_admin_' + suffix + '_' + scope;
}

/** CSRF token bound to the current session. Set after login or bootstrap. */
let apiCsrfToken = '';
try {
  apiCsrfToken = localStorage.getItem(getSessionStorageKey('csrf')) || '';
} catch (e) {}

/** Store the CSRF token returned by login/bootstrap. */
function apiSetCsrf(token) {
  apiCsrfToken = typeof token === 'string' ? token : '';
  try {
    if (apiCsrfToken) {
      localStorage.setItem(getSessionStorageKey('csrf'), apiCsrfToken);
    } else {
      localStorage.removeItem(getSessionStorageKey('csrf'));
    }
  } catch (e) {}
}

/** Current CSRF token. */
function apiGetCsrf() {
  return apiCsrfToken;
}

/** Store the session token for cross-origin authentication. */
function apiSetToken(token) {
  try {
    if (token) {
      localStorage.setItem(getSessionStorageKey('token'), token);
    } else {
      localStorage.removeItem(getSessionStorageKey('token'));
    }
  } catch (e) {}
}

/** Read the stored session token. */
function apiGetToken() {
  try {
    return localStorage.getItem(getSessionStorageKey('token')) || '';
  } catch (e) {
    return '';
  }
}

/**
 * Perform a request against the backend.
 *
 * @param {string} path      endpoint file name, e.g. 'conversations.php'
 * @param {object} [options] { method, body, query }
 * @returns {Promise<object>} the parsed success payload
 * @throws {Error} with a `.status` property on failure
 */
async function apiRequest(path, options) {
  const opts = options || {};
  const method = opts.method || 'GET';

  const base = getDashboardApiBase();
  const url = new URL(base + '/' + path.replace(/^\/+/, ''), window.location.href);

  if (opts.query) {
    Object.keys(opts.query).forEach(function (key) {
      const value = opts.query[key];
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    });
  }

  const headers = {};
  if (opts.body !== undefined && opts.body !== null) {
    headers['Content-Type'] = 'application/json';
  }
  if (method !== 'GET' && apiCsrfToken) {
    headers['X-CSRF-Token'] = apiCsrfToken;
  }

  const sessionToken = apiGetToken();
  if (sessionToken) {
    headers['Authorization'] = 'Bearer ' + sessionToken;
    headers['X-Session-Token'] = sessionToken;
  }

  let response;
  try {
    response = await fetch(url.toString(), {
      method: method,
      mode: 'cors',
      headers: headers,
      credentials: 'include',
      body: opts.body !== undefined && opts.body !== null
        ? JSON.stringify(opts.body)
        : undefined
    });
  } catch (networkError) {
    const error = new Error('NETWORK');
    error.status = 0;
    error.cause = networkError;
    throw error;
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch (parseError) {
    payload = null;
  }

  if (!response.ok || !payload || payload.ok !== true) {
    if (response.status === 401) {
      apiSetToken('');
      apiSetCsrf('');
    }
    const message = (payload && payload.error) ? payload.error : ('HTTP ' + response.status);
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  if (payload.token) {
    apiSetToken(payload.token);
  }
  if (payload.csrf) {
    apiSetCsrf(payload.csrf);
  }

  return payload;
}

/* ------------------------------------------------------------------
   Endpoints
   ------------------------------------------------------------------ */

const api = {
  /** Exchange credentials for a session. */
  login: function (username, password) {
    return apiRequest('login.php', {
      method: 'POST',
      body: { username: username, password: password }
    });
  },

  /** Destroy the current session server-side. */
  logout: function () {
    return apiRequest('logout.php', { method: 'POST', body: {} }).finally(function () {
      apiSetToken('');
      apiSetCsrf('');
    });
  },

  /** Current auth state, used to decide between login and dashboard. */
  session: function () {
    return apiRequest('session.php');
  },

  /** Everything needed for the first paint of the dashboard. */
  bootstrap: function () {
    return apiRequest('bootstrap.php');
  },

  /** Conversation list only. */
  conversations: function (limit) {
    return apiRequest('conversations.php', { query: { limit: limit } });
  },

  /** One full conversation: profile, navigation, submissions, commands. */
  conversation: function (id) {
    return apiRequest('conversation.php', { query: { id: id } });
  },

  /** Fast incremental event poll fallback. */
  pollEvents: function (lastEventId) {
    return apiRequest('poll_events.php', { query: { last_id: lastEventId || 0 } });
  },

  /** Mark one conversation read, or all of them. */
  markRead: function (id, isRead) {
    const body = { read: isRead === false ? 0 : 1 };
    if (id === 'all') {
      body.all = 1;
    } else {
      body.id = id;
    }
    return apiRequest('mark_read.php', { method: 'POST', body: body });
  },

  /** Delete all users, submissions, messages, and commands. */
  clearAll: function () {
    return apiRequest('clear_all.php', { method: 'POST', body: { confirm: true } });
  },

  /** Pin or unpin a single conversation. */
  pinUser: function (id, isPinned) {
    const body = { id: id };
    if (isPinned !== undefined && isPinned !== null) {
      body.pinned = isPinned ? 1 : 0;
    }
    return apiRequest('pin_user.php', { method: 'POST', body: body });
  },

  /** Delete a single conversation and all its submissions. */
  deleteUser: function (id) {
    return apiRequest('delete_user.php', { method: 'POST', body: { id: id } });
  },

  /** Move a conversation into a different status. */
  setStatus: function (id, status) {
    return apiRequest('set_status.php', {
      method: 'POST',
      body: { id: id, status: status }
    });
  },

  /** Send a remote-control command to the visitor's browser. */
  issueCommand: function (id, command) {
    return apiRequest('issue_command.php', {
      method: 'POST',
      body: { id: id, command: command }
    });
  },

  /** URL of the realtime event stream. */
  streamUrl: function (lastEventId) {
    const base = getDashboardApiBase();
    const url = new URL(base + '/stream.php', window.location.href);
    if (lastEventId) {
      url.searchParams.set('last_id', String(lastEventId));
    }
    const sessionToken = apiGetToken();
    if (sessionToken) {
      url.searchParams.set('token', sessionToken);
    }
    return url.toString();
  }
};
