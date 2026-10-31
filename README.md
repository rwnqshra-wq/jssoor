# مشروع جسور — نسخة Render + MongoDB (مفصولة بالكامل)

تم فصل المشروع بالكامل إلى **3 أقسام مستقلة** مع دعم تشغيل **عدة نسخ متزامنة (Multi-Instance)** بعزل كامل للبيانات في **MongoDB**:

```text
jusourqrr/
├── frontend/       # ملفات الموقع العام (ترفع على أي استضافة أو Static Site)
├── dashboard/      # ملفات لوحة التحكم للمشرف (ترفع على أي استضافة أو Static Site)
├── server/         # سيرفر الـ API والـ SSE (Node.js + Express + MongoDB) مخصص لـ Render
├── render.yaml     # ملف إعداد النشر السريع على Render
└── package.json    # يدعم تشغيل السيرفر مباشرة من الجذر أو من داخل مجلد server/
```

---

## 1. المتغيرات البيئية في Render (Environment Variables)

عند رفع السيرفر (`server/`) كـ **Web Service** على منصة **Render**، قم بإضافة المتغيرات التالية في قسم **Environment**:

| اسم المتغير (Key) | الوصف | مثال (Value) |
|---|---|---|
| `MONGODB_URI` | رابط قاعدة بيانات MongoDB Atlas | `mongodb+srv://user:pass@cluster0.xxx.mongodb.net/jusour?retryWrites=true&w=majority` |
| `FRONTEND_URL` | رابط استضافة الفرونت اند الخاص بهذه النسخة | `https://frontend-domain-1.com` |
| `DASHBOARD_URL` | رابط استضافة الداشبورد الخاص بهذه النسخة | `https://dashboard-domain-1.com` |
| `ADMIN_USER` | اسم المستخدم للدخول إلى لوحة التحكم | `admin` |
| `ADMIN_PASS` | كلمة المرور للدخول إلى لوحة التحكم | `StrongPass123!` |
| `INSTANCE_ID` | *(اختياري)* اسم مميز للنسخة؛ إذا تُرك فارغاً يتم توليده تلقائياً من روابط الفرونت والداشبورد | `copy_1` |

---

## 2. ربط الفرونت اند والداشبورد بالسيرفر

بعد تشغيل السيرفر على Render والحصول على رابطه (مثال: `https://jusour-server-1.onrender.com`):

### أ) في حال رفع `frontend/` و `dashboard/` على استضافة خارجية (مثل cPanel أو Hostinger):
1. افتح الملف `frontend/config.js` وضع رابط سيرفر Render في السطر 10:
   ```js
   window.SERVER_URL = 'https://jusour-server-1.onrender.com';
   ```
2. افتح الملف `dashboard/config.js` وضع رابط سيرفر Render في السطر 10:
   ```js
   window.SERVER_URL = 'https://jusour-server-1.onrender.com';
   ```

### ب) في حال رفع `frontend/` و `dashboard/` كـ Static Sites على Render / Netlify / Vercel:
- لا تحتاج حتى لتعديل ملفات الكود يدويًا! فقط أضف متغير بيئة `SERVER_URL` بقيمة رابط سيرفر Render، واجعل أمر البناء (Build Command):
  ```bash
  npm run build
  ```
  وسيقوم السكربت `build.js` بحقن رابط السيرفر داخل `config.js` تلقائيًا أثناء الرفع.

---

## 3. كيف يعمل عزل النسخ المتعددة (Multi-Instance Isolation)؟

إذا قمت برفع **عدة نسخ** (مثلاً 3 مواقع فرونت اند + 3 لوحات تحكم + 3 سيرفرات Render) واستخدمت **نفس رابط `MONGODB_URI`** في جميعها:
1. يقوم كل سيرفر Render تلقائيًا بتوليد بادئة معزولة خاصة به (`inst_<hash>`) بناءً على قيمة `FRONTEND_URL` و `DASHBOARD_URL` (أو `INSTANCE_ID` / `RENDER_SERVICE_NAME`).
2. يتم إنشاء جداول (Collections) مستقلة لكل نسخة داخل MongoDB تلقائيًا:
   - `inst_xxx_users`
   - `inst_xxx_submissions`
   - `inst_xxx_messages`
   - `inst_xxx_commands`
   - `inst_xxx_events`
   - `inst_xxx_admins`
   - `inst_xxx_sessions`
3. كذلك في المتصفح (`localStorage` و `Cookies`) يتم عزل الجلسات ومعرّفات الزوار لكل نسخة حسب الرابط، فلا تؤثر أي نسخة على الأخرى إطلاقًا.
