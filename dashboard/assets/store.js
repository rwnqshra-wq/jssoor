/* ============================================================
   Client-side state.

   Held in a Map keyed by conversation id so a realtime event can
   update a single conversation in place. The list order is derived
   from last_activity, so the newest or most recently active user
   always sorts to the top without a full reload.
   ============================================================ */

'use strict';

const store = {
  /** Signed-in admin, or null. */
  admin: null,

  /** Catalogues from the server. */
  pages: [],
  statuses: [],
  commands: [],

  /** id -> conversation row */
  conversations: new Map(),

  /** Currently open conversation id, or null. */
  selectedId: null,

  /** Page tab selected inside the open conversation. */
  activePage: 'all',

  /** 'all' | 'unread' | 'waiting' */
  filter: 'all',

  /** Free-text list filter. */
  search: '',

  /** Cursor for the realtime stream. */
  lastEventId: 0,

  /** 'connecting' | 'live' | 'offline' */
  connection: 'connecting'
};

/* ------------------------------------------------------------------
   Catalogues
   ------------------------------------------------------------------ */

/** Look up a status definition. */
function storeStatus(key) {
  return store.statuses.find(function (s) { return s.key === key; }) || null;
}

/** Look up a page definition. */
function storePage(key) {
  return store.pages.find(function (p) { return p.key === key; }) || null;
}

/* ------------------------------------------------------------------
   Conversation collection
   ------------------------------------------------------------------ */

/** Insert or replace one conversation, without touching the others. */
function storeUpsertConversation(row) {
  if (!row || row.id === undefined || row.id === null) {
    return;
  }
  const id = Number(row.id);

  if (store.conversations.has(id) && store.selectedId === id) {
    // Preserve locally known read state while the server catches up.
    const existing = store.conversations.get(id);
    row.is_read = existing.is_read && row.is_read;
  }

  store.conversations.set(id, row);
}

/** Remove one conversation. */
function storeRemoveConversation(id) {
  store.conversations.delete(Number(id));
}

/** Replace the whole collection (used by bootstrap and manual refresh). */
function storeReplaceConversations(rows) {
  store.conversations = new Map();
  (rows || []).forEach(function (row) {
    storeUpsertConversation(row);
  });
}

/* ------------------------------------------------------------------
   Derived views
   ------------------------------------------------------------------ */

/** All conversations, most recent activity first. */
function storeSorted() {
  const rows = Array.from(store.conversations.values());
  rows.sort(function (a, b) {
    if (a.last_activity !== b.last_activity) {
      return a.last_activity < b.last_activity ? 1 : -1;
    }
    return Number(b.id) - Number(a.id);
  });
  return rows;
}

/** True when a conversation matches the current search text. */
function storeMatchesSearch(row) {
  const query = store.search.trim().toLowerCase();
  if (query === '') {
    return true;
  }
  const haystack = [row.name, row.ref, row.phone, row.service, row.last_summary]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.indexOf(query) !== -1;
}

/** True when a conversation matches the active filter chip. */
function storeMatchesFilter(row) {
  if (store.filter === 'unread') {
    return row.is_read === false;
  }
  if (store.filter === 'waiting') {
    return row.waiting_for_decision === true;
  }
  return true;
}

/** The rows the list should currently display. */
function storeVisible() {
  return storeSorted().filter(function (row) {
    return storeMatchesFilter(row) && storeMatchesSearch(row);
  });
}

/** Counters shown in the top bar. */
function storeTotals() {
  let unread = 0;
  let waiting = 0;
  store.conversations.forEach(function (row) {
    if (row.is_read === false) { unread += 1; }
    if (row.waiting_for_decision === true) { waiting += 1; }
  });
  return { total: store.conversations.size, unread: unread, waiting: waiting };
}

/** The currently open conversation row, or null. */
function storeSelected() {
  if (store.selectedId === null) {
    return null;
  }
  return store.conversations.get(store.selectedId) || null;
}

/* ------------------------------------------------------------------
   Mutations
   ------------------------------------------------------------------ */

/** Set the open conversation. */
function storeSelect(id) {
  store.selectedId = id === null ? null : Number(id);
  store.activePage = 'all';
}

/** Set the list filter. */
function storeSetFilter(filter) {
  store.filter = filter;
}

/** Set the search text. */
function storeSetSearch(text) {
  store.search = typeof text === 'string' ? text : '';
}

/** Mark one conversation read or unread in local state. */
function storeSetRead(id, isRead) {
  const row = store.conversations.get(Number(id));
  if (row) {
    row.is_read = isRead === true;
  }
}

/** Mark every conversation read or unread in local state. */
function storeSetReadAll(isRead) {
  store.conversations.forEach(function (row) {
    row.is_read = isRead === true;
  });
}

/** Recompute the waiting flag for a status, matching the server rule. */
function storeStatusIsWaiting(statusKey) {
  const definition = storeStatus(statusKey);
  return definition ? definition.waiting === true : false;
}
