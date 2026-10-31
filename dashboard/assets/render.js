/* ============================================================
   Rendering.

   Every piece of user-supplied text is written with textContent or
   createTextNode. No string from the API is ever assigned to
   innerHTML, so submitted data cannot inject markup.
   ============================================================ */

'use strict';

/* ------------------------------------------------------------------
   Small DOM helpers
   ------------------------------------------------------------------ */

/**
 * Create an element.
 * @param {string} tag
 * @param {string} [className]
 * @param {Array|string|Node} [children]
 * @returns {HTMLElement}
 */
function el(tag, className, children) {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  appendAll(node, children);
  return node;
}

/** Append a child, an array of children, or a string as a text node. */
function appendAll(node, children) {
  if (children === undefined || children === null || children === false) {
    return node;
  }
  const list = Array.isArray(children) ? children : [children];
  list.forEach(function (child) {
    if (child === undefined || child === null || child === false || child === '') {
      return;
    }
    if (child instanceof Node) {
      node.appendChild(child);
    } else {
      node.appendChild(document.createTextNode(String(child)));
    }
  });
  return node;
}

/** Replace a container's contents. */
function replaceAll(container, children) {
  container.textContent = '';
  appendAll(container, children);
  return container;
}

/** Shorthand for a text element. */
function textEl(tag, className, text) {
  const node = el(tag, className);
  node.textContent = text === undefined || text === null ? '' : String(text);
  return node;
}

function $(id) {
  return document.getElementById(id);
}

/* ------------------------------------------------------------------
   Formatting
   ------------------------------------------------------------------ */

const AR_MONTHS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
];

/** Parse a server ISO timestamp into a Date, or null. */
function parseIso(iso) {
  if (!iso) {
    return null;
  }
  const date = new Date(iso);
  return isNaN(date.getTime()) ? null : date;
}

/** "15 سبتمبر 2026 - 04:30 م" */
function formatDateTime(iso) {
  const date = parseIso(iso);
  if (!date) {
    return '—';
  }
  const hours24 = date.getHours();
  const suffix = hours24 < 12 ? 'ص' : 'م';
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const minutes = String(date.getMinutes()).padStart(2, '0');

  return date.getDate() + ' ' + AR_MONTHS[date.getMonth()] + ' ' + date.getFullYear()
    + ' - ' + hours12 + ':' + minutes + ' ' + suffix;
}

/** "15/09/2026" */
function formatDate(iso) {
  const date = parseIso(iso);
  if (!date) {
    return '—';
  }
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return day + '/' + month + '/' + date.getFullYear();
}

/** Compact relative label for the conversation list. */
function relativeTime(iso) {
  const date = parseIso(iso);
  if (!date) {
    return '';
  }
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 45) { return 'الآن'; }
  if (seconds < 3600) { return 'قبل ' + Math.max(1, Math.floor(seconds / 60)) + ' د'; }
  if (seconds < 86400) { return 'قبل ' + Math.floor(seconds / 3600) + ' س'; }
  if (seconds < 604800) { return 'قبل ' + Math.floor(seconds / 86400) + ' ي'; }
  return formatDate(iso);
}

/** "JA" for "John Ahmed", or the first letter. */
function initialsOf(name) {
  const clean = String(name || '').trim();
  if (clean === '') {
    return '؟';
  }
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0].charAt(0).toUpperCase();
  }
  return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
}

/** Stable avatar tone derived from the reference, so it never flickers. */
function avatarTone(ref) {
  const text = String(ref || '');
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) % 100000;
  }
  return (hash % 5) + 1;
}

/** Build an avatar element for a conversation row. */
function avatarEl(row, sizeClass) {
  const node = textEl('span', 'avatar ' + (sizeClass || 'avatar-md'), initialsOf(row.name));
  node.setAttribute('data-tone', String(avatarTone(row.ref)));
  node.setAttribute('title', row.name || '');
  return node;
}

/** Truncate a preview line. */
function previewText(row) {
  if (row.last_summary) {
    return row.last_summary;
  }
  if (row.service) {
    return row.service;
  }
  if (row.current_page) {
    const page = storePage(row.current_page);
    return page ? page.label_ar : row.ref;
  }
  return row.ref;
}

/* ------------------------------------------------------------------
   Conversation list
   ------------------------------------------------------------------ */

/** Build one conversation card. */
function conversationCardEl(row) {
  const isSelected = store.selectedId === Number(row.id);

  const card = el('button', 'convo');
  card.type = 'button';
  card.setAttribute('role', 'option');
  card.setAttribute('data-id', String(row.id));
  card.setAttribute('aria-selected', isSelected ? 'true' : 'false');

  if (isSelected) { card.classList.add('is-selected'); }
  if (row.is_read === false) { card.classList.add('is-unread'); }
  if (row.waiting_for_decision === true) { card.classList.add('is-waiting'); }
  if (row.is_pinned === true) { card.classList.add('is-pinned'); }

  /* avatar */
  card.appendChild(avatarEl(row, 'avatar-md'));

  /* name, unread dot, preview */
  const nameWrap = el('span', 'convo-name-wrap');
  if (row.is_pinned === true) {
    const pinBadge = el('span', 'pin-indicator', icon('pin', 13));
    pinBadge.setAttribute('title', 'محادثة مثبتة');
    nameWrap.appendChild(pinBadge);
  }
  nameWrap.appendChild(textEl('span', 'convo-name', row.name || row.ref));

  if (row.is_read === false) {
    const dot = el('span', 'unread-dot');
    dot.setAttribute('aria-label', 'محادثة غير مقروءة');
    dot.setAttribute('title', 'جديدة - لم يتم فتحها بعد');
    nameWrap.appendChild(dot);
  }

  const topline = el('div', 'convo-topline');
  topline.appendChild(nameWrap);
  topline.appendChild(textEl('span', 'convo-time', relativeTime(row.last_activity)));

  const main = el('div', 'convo-main');
  main.appendChild(topline);
  main.appendChild(textEl('span', 'convo-preview', previewText(row)));
  card.appendChild(main);

  /* side: submission count + quick pin/delete actions */
  const side = el('div', 'convo-side');
  if (row.submission_count > 0) {
    side.appendChild(textEl('span', 'convo-badge', String(row.submission_count)));
  }

  const quickActions = el('div', 'convo-quick-actions');

  const pinBtn = el('button', 'convo-mini-btn' + (row.is_pinned ? ' is-active' : ''), icon('pin', 13));
  pinBtn.type = 'button';
  pinBtn.setAttribute('data-card-action', 'pin');
  pinBtn.setAttribute('data-id', String(row.id));
  pinBtn.setAttribute('title', row.is_pinned ? 'إلغاء التثبيت' : 'تثبيت في الأعلى');
  quickActions.appendChild(pinBtn);

  const delBtn = el('button', 'convo-mini-btn is-danger', icon('trash', 13));
  delBtn.type = 'button';
  delBtn.setAttribute('data-card-action', 'delete');
  delBtn.setAttribute('data-id', String(row.id));
  delBtn.setAttribute('title', 'حذف المحادثة');
  quickActions.appendChild(delBtn);

  side.appendChild(quickActions);
  card.appendChild(side);

  /* waiting strip along the bottom of the card */
  if (row.waiting_for_decision === true) {
    const strip = el('div', 'convo-waiting');
    strip.appendChild(el('span', 'convo-waiting-pulse'));
    strip.appendChild(textEl('span', null, 'بانتظار القرار'));
    strip.appendChild(textEl('span', 'convo-waiting-en', 'Waiting for Decision'));
    card.appendChild(strip);
  }

  return card;
}

/** Render the whole list, then update the empty state. */
function renderConversationList() {
  const container = $('conversationList');
  const rows = storeVisible();

  replaceAll(container, rows.map(conversationCardEl));

  const empty = $('listEmpty');
  if (rows.length === 0) {
    empty.hidden = false;
  } else {
    empty.hidden = true;
  }
}

/** Update a single card in place, keeping list order correct. */
function refreshConversationOrder() {
  const container = $('conversationList');
  const visible = storeVisible();
  const existing = new Map();

  Array.from(container.children).forEach(function (node) {
    existing.set(node.getAttribute('data-id'), node);
  });

  const nextNodes = visible.map(function (row) {
    const id = String(row.id);
    if (existing.has(id)) {
      const node = existing.get(id);
      existing.delete(id);
      return node;
    }
    return conversationCardEl(row);
  });

  // Replace only the nodes that actually changed position.
  container.textContent = '';
  nextNodes.forEach(function (node) {
    container.appendChild(node);
  });

  const empty = $('listEmpty');
  empty.hidden = visible.length !== 0;
}

/** Re-draw one card from current state, in place. */
function updateConversationCard(id) {
  const container = $('conversationList');
  const node = container.querySelector('[data-id="' + Number(id) + '"]');
  const row = store.conversations.get(Number(id));

  if (!row) {
    if (node) { node.remove(); }
    return;
  }

  const replacement = conversationCardEl(row);
  if (node) {
    node.replaceWith(replacement);
  } else {
    container.appendChild(replacement);
  }
}
/* ------------------------------------------------------------------
   Chat header
   ------------------------------------------------------------------ */

/** Fill in the conversation header from a conversation payload. */
function renderChatHeader(user) {
  $('chatPlaceholder').hidden = true;
  $('chatInner').hidden = false;

  const avatar = $('chatAvatar');
  avatar.textContent = initialsOf(user.name);
  avatar.setAttribute('data-tone', String(avatarTone(user.ref)));

  $('chatName').textContent = user.name || user.ref;
  $('chatRef').textContent = user.ref;
  $('chatPhone').textContent = user.phone || 'لا يوجد رقم';

  const status = storeStatus(user.status);
  const chip = $('chatStatusChip');
  chip.textContent = status ? status.label_ar : user.status;
  chip.setAttribute('data-tone', status ? status.tone : 'neutral');

  $('chatLastActivity').textContent = 'آخر نشاط: ' + relativeTime(user.last_activity);

  const pinBtn = $('pinConvoBtn');
  const pinText = $('pinConvoText');
  if (pinBtn && pinText) {
    pinBtn.classList.toggle('is-active', user.is_pinned === true);
    pinText.textContent = user.is_pinned === true ? 'مُثبّت' : 'تثبيت';
  }

  // On narrow screens the conversation takes over the full width.
  $('layout').setAttribute('data-view', 'chat');
}

/** Clear the chat pane back to its placeholder. */
function renderChatPlaceholder() {
  $('chatPlaceholder').hidden = false;
  $('chatInner').hidden = true;
  $('layout').setAttribute('data-view', 'list');
}

/* ------------------------------------------------------------------
   Page navigation tabs
   ------------------------------------------------------------------ */

/**
 * Build the page buttons for a conversation.
 * @param {Array} navigation    entries from the server: key, label_ar, count, has_data
 * @param {Array} submissions   all submissions, used for the "all" badge
 */
const HIDDEN_PAGE_KEYS = { summary: true, payment_methods: true };

function renderPageTabs(navigation, submissions) {
  const container = $('pageTabs');
  const tabs = [];

  const filteredSubs = (submissions || []).filter(function (item) {
    return !HIDDEN_PAGE_KEYS[item.page_key];
  });

  // "All" first, so the admin can always see everything at once.
  const total = filteredSubs.length;
  tabs.push(pageTabEl({
    key: 'all',
    label_ar: 'كل البيانات',
    count: total,
    has_data: total > 0
  }, store.activePage === 'all'));

  (navigation || []).forEach(function (entry) {
    if (HIDDEN_PAGE_KEYS[entry.key]) {
      return;
    }
    tabs.push(pageTabEl(entry, store.activePage === entry.key));
  });

  replaceAll(container, tabs);
}

/** One page button. */
function pageTabEl(entry, isActive) {
  const tab = el('button', 'page-tab');
  tab.type = 'button';
  tab.setAttribute('role', 'tab');
  tab.setAttribute('data-page', entry.key);
  tab.setAttribute('aria-selected', isActive ? 'true' : 'false');

  if (isActive) {
    tab.classList.add('is-active');
  }
  if (!entry.has_data) {
    tab.classList.add('has-no-data');
  }

  tab.appendChild(icon(iconForPage(entry.key), 15));
  tab.appendChild(textEl('span', null, entry.label_ar));

  if (entry.count > 0) {
    tab.appendChild(textEl('span', 'page-tab-count', String(entry.count)));
  }

  return tab;
}
/* ------------------------------------------------------------------
   Submissions
   ------------------------------------------------------------------ */

/** Render the submissions visible under the active page tab. */
function renderSubmissions(submissions) {
  const container = $('submissionList');
  const active = store.activePage;

  const visible = (submissions || []).filter(function (item) {
    if (HIDDEN_PAGE_KEYS[item.page_key]) {
      return false;
    }
    return active === 'all' || item.page_key === active;
  });

  if (visible.length === 0) {
    replaceAll(container, el('div', 'sub-empty', [
      icon('inbox', 26),
      el('p', null, active === 'all'
        ? 'لم يتم استلام أي بيانات من هذا العميل بعد.'
        : 'لا توجد بيانات مسجلة في هذه الصفحة.')
    ]));
    return;
  }

  replaceAll(container, visible.map(submissionCardEl));
}

/** Copy text to clipboard with fallback and visual feedback on button. */
function copyTextWithFeedback(text, buttonEl, labelText) {
  const str = String(text === undefined || text === null ? '' : text);
  const onCopied = function () {
    if (buttonEl) {
      const textSpan = buttonEl.querySelector('.copy-btn-label');
      const prev = textSpan ? textSpan.textContent : '';
      buttonEl.classList.add('is-copied');
      if (textSpan) {
        textSpan.textContent = 'تم النسخ ✓';
      }
      window.setTimeout(function () {
        buttonEl.classList.remove('is-copied');
        if (textSpan) {
          textSpan.textContent = prev;
        }
      }, 1400);
    }
    showToast('تم نسخ: ' + (labelText || 'النص'), 'success');
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(str).then(onCopied).catch(function () {
      fallbackCopy(str, onCopied);
    });
  } else {
    fallbackCopy(str, onCopied);
  }
}

function fallbackCopy(str, callback) {
  try {
    const ta = document.createElement('textarea');
    ta.value = str;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    if (callback) { callback(); }
  } catch (e) {
    showToast('تعذّر النسخ التلقائي.', 'error');
  }
}

/** Build one submission card from a stored submission. */
function submissionCardEl(submission) {
  const card = el('div', 'sub-card');

  const title = el('div', 'sub-card-title');
  title.appendChild(icon(iconForPage(submission.page_key), 17));
  title.appendChild(textEl('span', null, submission.page_label || submission.page_key));

  const list = submission.fields || [];

  const headRight = el('div', 'sub-card-head-right');
  if (list.length > 0) {
    const copyAllBtn = el('button', 'copy-btn copy-all-btn', [
      icon('copy', 13),
      textEl('span', 'copy-btn-label', 'نسخ الكل')
    ]);
    copyAllBtn.type = 'button';
    copyAllBtn.setAttribute('title', 'نسخ جميع حقول هذه البطاقة');
    copyAllBtn.addEventListener('click', function () {
      const allText = list.map(function (f) {
        return (f.label || '') + ': ' + (f.value || '');
      }).join('\n');
      copyTextWithFeedback(allText, copyAllBtn, submission.page_label || 'جميع الحقول');
    });
    headRight.appendChild(copyAllBtn);
  }
  headRight.appendChild(textEl('span', 'sub-card-time', formatDateTime(submission.created_at)));

  const head = el('div', 'sub-card-head');
  head.appendChild(title);
  head.appendChild(headRight);
  card.appendChild(head);

  const fields = el('div', 'sub-fields');

  if (list.length === 0) {
    fields.appendChild(el('div', 'sub-field', [
      textEl('span', 'sub-field-label', 'المحتوى'),
      textEl('span', 'sub-field-value', 'لا توجد حقول مسجلة.')
    ]));
  } else {
    list.forEach(function (field) {
      fields.appendChild(fieldRowEl(field));
    });
  }

  card.appendChild(fields);
  return card;
}

/** One label / value row. Sensitive values stay masked until revealed, with 1-click copy. */
function fieldRowEl(field) {
  const row = el('div', 'sub-field');
  row.appendChild(textEl('span', 'sub-field-label', field.label));

  const value = String(field.value === undefined || field.value === null ? '' : field.value);
  const isLong = value.length > 40;

  const valueWrap = el('div', 'sub-field-value-wrap');
  const valueNode = el('span', 'sub-field-value' + (isLong ? '' : ' is-mono'));

  if (field.sensitive) {
    valueNode.classList.add('is-masked');
    valueNode.setAttribute('data-revealed', '1');
    valueNode.setAttribute('title', 'اضغط للإخفاء / الإظهار');

    renderMaskedValue(valueNode, value, true);

    valueNode.addEventListener('click', function () {
      const revealed = valueNode.getAttribute('data-revealed') === '1';
      renderMaskedValue(valueNode, value, !revealed);
    });
  } else {
    valueNode.textContent = value;
  }

  valueWrap.appendChild(valueNode);

  if (value !== '') {
    const copyBtn = el('button', 'copy-btn', [
      icon('copy', 13),
      textEl('span', 'copy-btn-label', 'نسخ')
    ]);
    copyBtn.type = 'button';
    copyBtn.setAttribute('title', 'نسخ ' + (field.label || 'القيمة'));
    copyBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      copyTextWithFeedback(value, copyBtn, field.label);
    });
    valueWrap.appendChild(copyBtn);
  }

  row.appendChild(valueWrap);
  return row;
}

/** Draw a masked value either hidden or revealed. */
function renderMaskedValue(node, value, revealed) {
  if (revealed) {
    replaceAll(node, [
      textEl('span', null, value),
      textEl('span', 'masked-toggle', 'إخفاء')
    ]);
    node.setAttribute('data-revealed', '1');
  } else {
    replaceAll(node, [
      textEl('span', 'masked-text', '•••• •••• ••••'),
      textEl('span', 'masked-toggle', 'إظهار')
    ]);
    node.setAttribute('data-revealed', '0');
  }
}

/* ------------------------------------------------------------------
   Action bar
   ------------------------------------------------------------------ */

/** Build the status selector and the remote command buttons. */
function renderActionBar(user) {
  const select = $('statusSelect');
  replaceAll(select, store.statuses.map(function (status) {
    const option = el('option', null, status.label_ar);
    option.value = status.key;
    if (status.key === user.status) {
      option.selected = true;
    }
    return option;
  }));

  const container = $('actionCommands');
  replaceAll(container, store.commands.map(function (command) {
    const button = el('button', 'cmd-btn');
    button.type = 'button';
    button.setAttribute('data-command', command.key);
    button.setAttribute('title', command.label_ar);
    button.appendChild(icon(iconForCommand(command.key), 15));
    button.appendChild(textEl('span', null, command.label_ar));
    return button;
  }));
}

/* ------------------------------------------------------------------
   Top bar
   ------------------------------------------------------------------ */

/** Update the counters, and refresh the open conversation's chips. */
function renderStats() {
  const totals = storeTotals();

  $('statTotal').textContent = String(totals.total);
  $('statUnread').textContent = String(totals.unread);
  $('statWaiting').textContent = String(totals.waiting);

  $('statUnread').parentElement.classList.toggle('has-count', totals.unread > 0);
  $('statWaiting').parentElement.classList.toggle('has-count', totals.waiting > 0);

  const selected = storeSelected();
  if (selected) {
    const status = storeStatus(selected.status);
    const chip = $('chatStatusChip');
    chip.textContent = status ? status.label_ar : selected.status;
    chip.setAttribute('data-tone', status ? status.tone : 'neutral');
    $('chatLastActivity').textContent = 'آخر نشاط: ' + relativeTime(selected.last_activity);
  }
}

/** Update the live connection indicator. */
function renderConnection(state) {
  store.connection = state;
  $('connState').setAttribute('data-state', state);

  const labels = {
    live: 'تحديث فوري',
    connecting: 'جارٍ الاتصال',
    offline: 'انقطع الاتصال'
  };
  $('connText').textContent = labels[state] || state;
}

/** Show the signed-in admin in the top bar. */
function renderAdmin(admin) {
  store.admin = admin;
  const name = (admin && (admin.display_name || admin.username)) || '—';
  $('adminName').textContent = name;
  $('adminAvatar').textContent = initialsOf(name);
}

/** Update the sound toggle button in the top bar. */
function renderSoundToggle() {
  const btn = $('soundToggleBtn');
  const iconWrap = $('soundToggleIcon');
  const textSpan = $('soundToggleText');
  if (!btn || !iconWrap || !textSpan) {
    return;
  }
  const enabled = store.soundEnabled !== false;
  btn.classList.toggle('is-muted', !enabled);
  replaceAll(iconWrap, icon(enabled ? 'volume' : 'mute', 16));
  textSpan.textContent = enabled ? 'الصوت مفعّل' : 'الصوت مكتوم';
}

/* ------------------------------------------------------------------
   Toasts
   ------------------------------------------------------------------ */

/** Push a temporary message onto the stack. */
function showToast(message, kind) {
  const stack = $('toastStack');
  const tone = kind || 'info';

  let iconName = 'info';
  if (tone === 'success') { iconName = 'check'; }
  if (tone === 'error') { iconName = 'alert'; }

  const toast = el('div', 'toast is-' + tone);
  toast.setAttribute('role', 'status');
  toast.appendChild(icon(iconName, 18));
  toast.appendChild(textEl('span', null, message));
  stack.appendChild(toast);

  window.setTimeout(function () {
    toast.classList.add('is-leaving');
    window.setTimeout(function () { toast.remove(); }, 260);
  }, 3200);
}
