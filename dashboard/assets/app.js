/* ============================================================
   Dashboard controller.

   Bootstraps from a single API call, then keeps itself current from
   the SSE stream. Every event updates exactly one conversation, so a
   new submission never triggers a full list reload.
   ============================================================ */

'use strict';

/** Detail for the conversation currently open on the left. */
const openConversation = {
  id: null,
  submissions: [],
  navigation: []
};

/** EventSource handle. */
let eventSource = null;

/** Watchdog timer that flags a silent stream as offline. */
let streamWatchdog = null;

/* ------------------------------------------------------------------
   Startup
   ------------------------------------------------------------------ */

/** Entry point. */
async function startDashboard() {
  renderConnection('connecting');

  let boot;
  try {
    boot = await api.bootstrap();
  } catch (error) {
    if (error.status === 401) {
      window.location.replace('login.html');
      return;
    }
    renderConnection('offline');
    showToast('تعذّر تحميل البيانات. يُرجى إعادة تحميل الصفحة.', 'error');
    return;
  }

  store.pages    = boot.pages || [];
  store.statuses = boot.statuses || [];
  store.commands = boot.commands || [];

  apiSetCsrf(boot.csrf);
  renderAdmin(boot.admin);

  storeReplaceConversations(boot.conversations || []);
  store.lastEventId = boot.last_event_id || 0;

  renderConversationList();
  renderStats();

  subscribeToEvents();
  renderChatPlaceholder();
}

/* ------------------------------------------------------------------
   Realtime stream
   ------------------------------------------------------------------ */

/** Open the event stream and keep it alive. */
function subscribeToEvents() {
  if (eventSource) {
    eventSource.close();
  }

  renderConnection('connecting');

  eventSource = new EventSource(api.streamUrl(store.lastEventId));

  eventSource.addEventListener('ready', function (event) {
    const data = safeJson(event.data);
    if (data && typeof data.cursor === 'number') {
      store.lastEventId = data.cursor;
    }
    renderConnection('live');
    armWatchdog();
  });

  // The server ends each bounded stream deliberately; reconnect at once.
  eventSource.addEventListener('bye', function () {
    renderConnection('connecting');
    eventSource.close();
    window.setTimeout(subscribeToEvents, 400);
  });

  REALTIME_EVENTS.forEach(function (name) {
    eventSource.addEventListener(name, function (event) {
      armWatchdog();
      const payload = safeJson(event.data);
      if (!payload) {
        return;
      }
      if (typeof payload._event_id === 'number') {
        store.lastEventId = payload._event_id;
      }
      handleRealtimeEvent(name, payload);
    });
  });

  eventSource.onopen = function () {
    renderConnection('live');
    armWatchdog();
  };

  eventSource.onerror = function () {
    // EventSource reconnects on its own; reflect the gap in the UI.
    if (store.connection !== 'offline') {
      renderConnection('connecting');
    }
  };
}

/** Event names the server emits. */
const REALTIME_EVENTS = [
  'user.created',
  'user.updated',
  'user.renamed',
  'user.read',
  'user.status',
  'submission.created',
  'command.issued',
  'conversations.read_all'
];

/** Reset the watchdog so a silent stream is reported as offline. */
function armWatchdog() {
  if (streamWatchdog) {
    window.clearTimeout(streamWatchdog);
  }
  streamWatchdog = window.setTimeout(function () {
    renderConnection('offline');
    if (eventSource) {
      eventSource.close();
    }
    window.setTimeout(subscribeToEvents, 1500);
  }, 70000);
}

/** Parse a JSON frame, tolerating anything unexpected. */
function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}
/* ------------------------------------------------------------------
   Realtime event handling
   ------------------------------------------------------------------ */

/**
 * Apply one realtime event.
 * Each branch touches a single conversation, never the whole list.
 */
function handleRealtimeEvent(type, payload) {
  const row = payload.user || null;

  if (type === 'conversations.read_all') {
    storeSetReadAll(payload.is_read !== false);
    storeSorted().forEach(function (item) { updateConversationCard(item.id); });
    renderStats();
    return;
  }

  if (!row) {
    return;
  }

  const id = Number(row.id);
  const wasKnown = store.conversations.has(id);
  const previous = store.conversations.get(id);

  storeUpsertConversation(row);

  if (type === 'user.created') {
    showToast('عميل جديد: ' + (row.name || row.ref), 'info');
  } else if (type === 'submission.created') {
    const label = payload.page_label || 'بيانات جديدة';
    showToast((row.name || row.ref) + ' - ' + label, 'info');
  }

  const nowSelected = store.selectedId === id;

  if (nowSelected && type === 'submission.created') {
    // Pull the full conversation so the new block is rendered properly.
    reloadConversation(id, true);
  } else if (nowSelected) {
    updateConversationCard(id);
    renderChatHeader(row);
    renderStats();
  } else if (wasKnown) {
    updateConversationCard(id);
    renderStats();
    refreshConversationOrder();
  } else {
    // A brand new conversation: insert it and let it sort to the top.
    updateConversationCard(id);
    refreshConversationOrder();
    renderStats();
  }

  if (!wasKnown && previous === undefined) {
    refreshConversationOrder();
  }
}

/* ------------------------------------------------------------------
   Opening a conversation
   ------------------------------------------------------------------ */

/** Load and display one conversation. */
async function openConversationById(id) {
  storeSelect(id);
  storeSetRead(id, true);

  // Reflect the read state immediately so the dot stops blinking.
  updateConversationCard(id);
  renderStats();
  highlightSelectedCard();

  try {
    await reloadConversation(id, false);
  } catch (error) {
    showToast('تعذّر تحميل المحادثة.', 'error');
    return;
  }

  // Persist the read state; the server broadcasts it to other tabs too.
  api.markRead(id, true).catch(function () {
    /* The conversation is open locally either way. */
  });
}

/** Fetch the full conversation detail. */
async function reloadConversation(id, silent) {
  const response = await api.conversation(id);
  const data = response.conversation;

  openConversation.id          = Number(id);
  openConversation.submissions = data.submissions || [];
  openConversation.navigation  = data.navigation || [];

  // Keep the list row fresh without disturbing scroll position.
  storeUpsertConversation(data.user);
  updateConversationCard(id);

  if (store.selectedId !== Number(id)) {
    return;
  }

  renderChatHeader(data.user);
  renderPageTabs(openConversation.navigation, openConversation.submissions);
  renderSubmissions(openConversation.submissions);
  renderActionBar(data.user);
  renderStats();

  if (silent !== true) {
    $('chatBody').scrollTop = 0;
  }
}

/** Ensure only the selected card carries the selected styling. */
function highlightSelectedCard() {
  const container = $('conversationList');
  Array.from(container.children).forEach(function (node) {
    const isSelected = Number(node.getAttribute('data-id')) === store.selectedId;
    node.classList.toggle('is-selected', isSelected);
    node.setAttribute('aria-selected', isSelected ? 'true' : 'false');
  });
}

/** Switch the page tab and re-render the submission list. */
function selectPageTab(pageKey) {
  store.activePage = pageKey;
  renderPageTabs(openConversation.navigation, openConversation.submissions);
  renderSubmissions(openConversation.submissions);
}

/** Re-render the list and stats after a filter or search change. */
function refreshListView() {
  renderConversationList();
  renderStats();
}
/* ------------------------------------------------------------------
   User actions
   ------------------------------------------------------------------ */

/** Change the status of the open conversation. */
async function changeStatus(statusKey) {
  const id = openConversation.id;
  if (!id) {
    return;
  }

  try {
    const response = await api.setStatus(id, statusKey);
    storeUpsertConversation(response.user);
    updateConversationCard(id);
    renderChatHeader(response.user);
    renderStats();

    const status = storeStatus(statusKey);
    showToast('تم تحديث الحالة إلى: ' + (status ? status.label_ar : statusKey), 'success');
  } catch (error) {
    showToast('تعذّر تحديث الحالة.', 'error');
    renderStats();
  }
}

/** Send a remote-control command to the visitor. */
async function sendCommand(command, button) {
  const id = openConversation.id;
  if (!id) {
    return;
  }

  if (button) {
    button.disabled = true;
  }

  try {
    const response = await api.issueCommand(id, command);
    storeUpsertConversation(response.user);
    updateConversationCard(id);
    renderChatHeader(response.user);
    renderStats();

    const definition = (store.commands || []).find(function (item) {
      return item.key === command;
    });
    showToast('تم إرسال الأمر: ' + (definition ? definition.label_ar : command), 'success');
  } catch (error) {
    showToast('تعذّر إرسال الأمر.', 'error');
  } finally {
    if (button) {
      button.disabled = false;
    }
  }
}

/** Mark every conversation read. */
async function markEverythingRead() {
  try {
    await api.markRead('all', true);
    storeSetReadAll(true);
    storeSorted().forEach(function (row) { updateConversationCard(row.id); });
    renderStats();
    showToast('تم تحديد جميع المحادثات كمقروءة.', 'success');
  } catch (error) {
    showToast('تعذّر تنفيذ العملية.', 'error');
  }
}

/** Sign out and return to the login screen. */
async function signOut() {
  try {
    await api.logout();
  } catch (error) {
    /* Even if the call fails, drop the local session view. */
  }
  window.location.replace('login.html');
}

/** Reload the list from the server. */
async function manualRefresh() {
  try {
    const response = await api.conversations(300);
    storeReplaceConversations(response.conversations || []);
    store.lastEventId = response.last_event_id || store.lastEventId;
    refreshListView();

    const selected = storeSelected();
    if (selected) {
      await reloadConversation(selected.id, true);
    } else {
      renderChatPlaceholder();
    }

    showToast('تم تحديث القائمة.', 'success');
  } catch (error) {
    showToast('تعذّر التحديث.', 'error');
  }
}

/* ------------------------------------------------------------------
   DOM wiring
   ------------------------------------------------------------------ */

/** Attach every listener. */
function wireEvents() {
  /* Open a conversation from the list. */
  $('conversationList').addEventListener('click', function (event) {
    const card = event.target.closest('.convo');
    if (!card) {
      return;
    }
    openConversationById(Number(card.getAttribute('data-id')));
  });

  /* Page navigation tabs. */
  $('pageTabs').addEventListener('click', function (event) {
    const tab = event.target.closest('.page-tab');
    if (!tab) {
      return;
    }
    selectPageTab(tab.getAttribute('data-page'));
  });

  /* Status selector. */
  $('statusSelect').addEventListener('change', function (event) {
    changeStatus(event.target.value);
  });

  /* Remote command buttons. */
  $('actionCommands').addEventListener('click', function (event) {
    const button = event.target.closest('.cmd-btn');
    if (!button) {
      return;
    }
    sendCommand(button.getAttribute('data-command'), button);
  });

  /* Search, debounced so typing stays smooth with many conversations. */
  let searchTimer = null;
  $('searchInput').addEventListener('input', function (event) {
    const value = event.target.value;
    if (searchTimer) {
      window.clearTimeout(searchTimer);
    }
    searchTimer = window.setTimeout(function () {
      storeSetSearch(value);
      refreshListView();
    }, 140);
  });

  /* Filter chips. */
  $('paneFilters').addEventListener('click', function (event) {
    const chip = event.target.closest('.filter-chip');
    if (!chip) {
      return;
    }
    Array.from($('paneFilters').children).forEach(function (node) {
      node.classList.toggle('is-active', node === chip);
    });
    storeSetFilter(chip.getAttribute('data-filter'));
    refreshListView();
  });

  /* Top bar. */
  $('refreshBtn').addEventListener('click', manualRefresh);
  $('markAllReadBtn').addEventListener('click', markEverythingRead);
  $('logoutBtn').addEventListener('click', signOut);

  /* Admin dropdown. */
  const adminBtn = $('adminBtn');
  const adminDropdown = $('adminDropdown');

  adminBtn.addEventListener('click', function (event) {
    event.stopPropagation();
    const willOpen = adminDropdown.hidden;
    adminDropdown.hidden = !willOpen;
    adminBtn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
  });

  document.addEventListener('click', function (event) {
    if (adminDropdown.hidden) {
      return;
    }
    if (!event.target.closest('.admin-menu')) {
      adminDropdown.hidden = true;
      adminBtn.setAttribute('aria-expanded', 'false');
    }
  });

  /* Mobile back button. */
  $('backBtn').addEventListener('click', function () {
    $('layout').setAttribute('data-view', 'list');
  });

  /* Close an open stream when the tab goes away. */
  window.addEventListener('beforeunload', function () {
    if (eventSource) {
      eventSource.close();
    }
  });
}

/* Boot. */
document.addEventListener('DOMContentLoaded', function () {
  wireEvents();
  startDashboard();
});
