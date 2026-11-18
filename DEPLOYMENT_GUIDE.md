# 🦅 دليل تثبيت وتشغيل منظومة صَقْر (Saqr) على سيرفر VPS وإعداد عميل جديد

هذا الدليل هو المرجع الشامل والعملي لتشغيل المنصة بالكامل على سيرفر افتراضي (VPS) بنظام Linux (Ubuntu/Debian)، مع شرح كافة الخطوات والمتغيرات المطلوبة لإطلاق النظام لأي منشأة أو شركة جديدة وتغيير بيانات الحساب، النطاق (Domain)، والمنافذ (Ports).

---

## 📑 فهرس المحتويات
1. [معمارية النظام ومكوناته](#1-معمارية-النظام-ومكوناته)
2. [متطلبات السيرفر (VPS Hardware & OS)](#2-متطلبات-السيرفر-vps)
3. [خطوات تثبيت وتشغيل المنظومة على السيرفر (أول مرة)](#3-تثبيت-وتشغيل-المنظومة-على-السيرفر)
4. [تهيئة Nginx وشهادة SSL المجانية](#4-تهيئة-خادم-الويب-nginx-وشهادة-ssl)
5. [دليل إعداد شركة / عميل جديد (Client Onboarding)](#5-دليل-إعداد-شركة--عميل-جديد)
6. [ربط تطبيق الويندوز (Saqr Edge Agent) في موقع العميل](#6-ربط-تطبيق-الويندوز-saqr-edge-agent)
7. [جدول كافة المنافذ والمتغيرات وكيفية تغييرها](#7-جدول-المنافذ-والمتغيرات-وكيفية-تغييرها)
8. [أوامر الصيانة والنسخ الاحتياطي السريع](#8-أوامر-الصيانة-والنسخ-الاحتياطي)
9. [التحديث التلقائي لكافة السيرفرات (CI/CD Multi-Server GitHub Action)](#9-التحديث-التلقائي-لكافة-السيرفرات-cicd-github-actions)

---

## 1. معمارية النظام ومكوناته

تنقسم منظومة **صَقْر** إلى جزأين رئيسيين لضمان الخصوصية وأعلى أداء:

```
[كاميرات المراقبة الميدانية (RTSP)]
               │
               ▼ (شبكة محلية LAN)
┌──────────────────────────────────────────────┐
│  تطبيق الويندوز المكتبي (Saqr Edge Agent)    │
│  • معالجة الإطارات بنموذج YOLOX محلياً      │
│  • تشفير الإنذارات وإرسال الأحداث فقط       │
└──────────────────────┬───────────────────────┘
                       │ (HTTPS / WSS / API)
                       ▼
┌──────────────────────────────────────────────┐
│        سيرفر المنصة السحابي (VPS)            │
│  1. Go Fiber API (المنفذ 8080)               │
│  2. Next.js Dashboard (المنفذ 3000)          │
│  3. MediaMTX RTSP/WebRTC (المنفذ 8554/8889)  │
│  4. PostgreSQL 17 + TimescaleDB (5432)       │
│  5. Redis 7 (المنفذ 6380 / 6379)             │
│  6. EMQX MQTT Broker (المنفذ 1883)           │
└──────────────────────────────────────────────┘
```

---

## 2. متطلبات السيرفر (VPS)

### أ. المواصفات الموصى بها (Recommended Specs):
* **نظام التشغيل:** Ubuntu 22.04 LTS أو Ubuntu 24.04 LTS.
* **المعالج (CPU):** 2 إلى 4 أنوية (Cores).
* **الذاكرة العشوائية (RAM):** 4GB كحد أدنى (يفضل 8GB لتشغيل قواعد البيانات والوسائط بسلاسة).
* **التخزين (Disk):** 40GB SSD / NVMe.

### ب. فتح المنافذ في جدار الحماية (Firewall / UFW):
قم بتسجيل الدخول للسيرفر عبر SSH ونفذ:
```bash
sudo ufw allow 22/tcp      # SSH
sudo ufw allow 80/tcp      # HTTP
sudo ufw allow 443/tcp     # HTTPS
sudo ufw allow 8080/tcp    # Saqr Go API (إذا لم يتم إخفاؤه خلف Nginx)
sudo ufw allow 8554/tcp    # MediaMTX RTSP
sudo ufw allow 8889/tcp    # MediaMTX WebRTC Signalling
sudo ufw allow 8888/tcp    # MediaMTX HLS
sudo ufw enable
```

---

## 3. تثبيت وتشغيل المنظومة على السيرفر

### الخطوة 1: تثبيت Docker و Docker Compose
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git ufw nginx

# تثبيت Docker الرسمي
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
```

### الخطوة 2: استنساخ المشروع عبر Git (SSH)
يتم تنزيل الكود دائماً على أي سيرفر عبر رابط المستودع:
`git@github.com:essamalagamy1/saqr.git`

قم بتجهيز مفتاح SSH على السيرفر لربطه بـ GitHub:
```bash
# 1. توليد مفتاح SSH جديد
ssh-keygen -t ed25519 -C "saqr-vps" -N "" -f ~/.ssh/id_ed25519

# 2. عرض المفتاح العام ونسخه
cat ~/.ssh/id_ed25519.pub
```
* انسخ المفتاح الظاهر واذهب إلى مستودع GitHub:
  `Settings` ➔ `Deploy Keys` ➔ `Add deploy key` ➔ الصق المفتاح وضع علامة على `Allow write access` إذا رغبت.

الآن قم باستنساخ الكود مباشرة إلى المسار المعتمد `/opt/saqr`:
```bash
sudo git clone git@github.com:essamalagamy1/saqr.git /opt/saqr
sudo chown -R $USER:$USER /opt/saqr
cd /opt/saqr
```

### الخطوة 3: إعداد ملف المتغيرات البيئية للمشروع (`docker-compose.yml`)
افتح ملف `docker-compose.yml` وعدل كلمات المرور الافتراضية للإنتاج:
```yaml
services:
  postgres:
    environment:
      POSTGRES_USER: saqr_user
      POSTGRES_PASSWORD: StrongProductionPassword123!
      POSTGRES_DB: saqr_db

  api:
    environment:
      DATABASE_URL: postgres://saqr_user:StrongProductionPassword123!@postgres:5432/saqr_db?sslmode=disable
      REDIS_URL: redis://redis:6379
      JWT_SECRET: your-super-secret-production-jwt-key-256bit
      PORT: "8080"
      MQTT_BROKER: tcp://emqx:1883
```

### الخطوة 4: تشغيل الحاويات وتطبيق جداول قاعدة البيانات
```bash
# تشغيل جميع الحاويات في الخلفية
docker compose up -d

# التأكد من عمل الحاويات وحالتها الصحية
docker compose ps

# تطبيق جداول ومخطط قاعدة البيانات (Migrations)
docker compose exec -T postgres psql -U saqr_user -d saqr_db < apps/api/pkg/database/migrations/001_initial_schema.up.sql
docker compose exec -T postgres psql -U saqr_user -d saqr_db < apps/api/pkg/database/migrations/002_tasks_and_notifications.up.sql
```

### الخطوة 5: تشغيل واجهة الويب (Next.js Dashboard)
لتشغيل واجهة الويب على السيرفر:
```bash
cd /opt/saqr/apps/web

# تثبيت الاعتماديات وبناء النسخة
npm install
npm run build

# تشغيل التطبيق في الخلفية باستخدام PM2
sudo npm install -g pm2
pm2 start npm --name "saqr-web" -- start -- -p 3000
pm2 save
pm2 startup
```

---

## 4. تهيئة خادم الويب Nginx وشهادة SSL

لربط الدومين (مثلاً `saqr.yourcompany.com`) مع تشفير SSL مجاني:

### إعداد Nginx Configuration:
أنشئ ملف الإعداد:
```bash
sudo nano /etc/nginx/sites-available/saqr.conf
```

ضع الإعداد التالي:
```nginx
server {
    server_name saqr.yourdomain.com;

    # 1. لوحة تحكم الويب (Next.js)
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # 2. مسارات واجهة الـ API والـ SSE Events
    location /api/v1/ {
        proxy_pass http://127.0.0.1:8080/api/v1/;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding on;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 24h;
    }

    # 3. بث WebRTC / HLS المباشر للكاميرات
    location /cam-stream/ {
        proxy_pass http://127.0.0.1:8888/;
        proxy_set_header Host $host;
    }
}
```

قم بتفعيل الموقع واستخراج شهادة SSL مجانية عبر Certbot:
```bash
sudo ln -s /etc/nginx/sites-available/saqr.conf /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# استخراج شهادة SSL تلقائياً
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d saqr.yourdomain.com
```

---

## 5. دليل إعداد شركة / عميل جديد

عند تسليم النظام لأي عميل أو شركة جديدة، وفرنا لك طريقتين لإنشاء حساب المنشأة والمدير:

### الطريقة الأولى (الأسرع عبر السكريبت الآلي):
قم بتشغيل السكريبت التفاعلي مباشرة من مجلد المشروع على السيرفر:
```bash
./scripts/create_company.sh
```
سيطلب منك السكريبت:
1. اسم المنشأة (مثال: شركة الصفا للتجارة).
2. اسم المعرف الإنجليزي (Slug: alsafa).
3. اسم الفرع الرئيسي (مثال: فرع المعادي).
4. اسم المشرف وبريده الإلكتروني وكلمة المرور.

سيقوم السكريبت بتشفير كلمة المرور بـ `bcrypt` تلقائياً وحفظ المنشأة وإعطائك معرف الشركة وكلمة المرور فوراً لتسليمها للعميل!

---

### الطريقة الثانية (يدوياً عبر أوامر SQL):
كلمات المرور مشفرة بواسطة `bcrypt`. يمكنك توليد تشفير كلمة المرور عبر الأمر:
```bash
# توليد هاش كلمة مرور (مثال لكلمة السر: CompanySecurePass2026)
python3 -c "import bcrypt; print(bcrypt.hashpw(b'CompanySecurePass2026', bcrypt.gensalt()).decode())"
```
*(أو استخدم هاش جاهز)*.

### الخطوة 2: إدخال الشركة والمستخدم في قاعدة البيانات
ادخل إلى PostgreSQL عبر الأمر:
```bash
docker compose exec -it postgres psql -U saqr_user -d saqr_db
```

قم بتنفيذ الأوامر التالية (مع استبدال البيانات بما يناسب عميلك):
```sql
-- 1. إضافة الشركة الجديدة
INSERT INTO companies (id, name, slug, industry)
VALUES (
    uuid_generate_v4(),
    'شركة الأمل للصناعات الغذائية',
    'alamal-foods',
    'manufacturing'
) RETURNING id;

-- احفظ الـ UUID الظاهر (مثال: 'a1b2c3d4-0000-0000-0000-000000000001')

-- 2. إضافة الفرع الرئيسي للشركة
INSERT INTO branches (id, company_id, name, city)
VALUES (
    uuid_generate_v4(),
    'a1b2c3d4-0000-0000-0000-000000000001',
    'المصنع الرئيسي - فرع العبور',
    'القاهرة'
) RETURNING id;

-- 3. إضافة حساب مدير النظام (Admin) للشركة
INSERT INTO users (name, email, password_hash, role, company_id)
VALUES (
    'المهندس أحمد مصطفى',
    'admin@alamal-foods.com',
    '$2a$12$K8yGk5N4pL... (الهاش الذي ولدته بالخطوة 1)',
    'admin',
    'a1b2c3d4-0000-0000-0000-000000000001'
);
```

---

## 6. ربط تطبيق الويندوز (Saqr Edge Agent)

تطبيق الويندوز يعمل على جهاز كمبيوتر بمقر الشركة متصل بنفس راوتر/شبكة كاميرات المراقبة:

1. انسخ ملف `Saqr Edge Agent 1.0.0.exe` إلى جهاز الويندوز بمقر العميل.
2. شغل التطبيق؛ سيفتح لك تلقائياً معالج التهيئة (Setup Wizard):
   * **الخطوة 1 (رابط الخادم):** أدخل رابط منصتك:
     `https://saqr.yourdomain.com` (أو `http://SERVER_IP:8080`).
   * **الخطوة 2 (بيانات الدخول):** أدخل البريد وكلمة المرور اللذين أنشأتهما للعميل:
     * البريد: `admin@alamal-foods.com`
     * كلمة المرور: `CompanySecurePass2026`
   * اضغط على **"ربط الجهاز والتحقق"**؛ سيتصل التطبيق بالخادم ويجلب معرف المنشأة تلقائياً.
3. في شاشة التطبيق الرئيسية:
   * اضغط على **"سحب الكاميرات من الخادم"** لجلب الكاميرات المسجلة مسبقاً، أو اضغط **"+ إضافة كاميرا RTSP"** لإدخال كاميرا محلية مباشرة.
   * اضغط على **"تشغيل المراقبة"** ليبدأ نموذج YOLOX في قراءة البث ورصد الأحداث فورياً وترحيلها إلى لوحة التحكم السحابية.

---

## 7. جدول المنافذ والمتغيرات وكيفية تغييرها

| الخدمة | المنفذ الافتراضي | المتغير البيئي في Docker / Nginx | مكان التعديل |
| :--- | :--- | :--- | :--- |
| **Next.js Web** | `3000` | `-p 3000` | أمر تشغيل PM2 أو package.json |
| **Go API** | `8080` | `PORT: "8080"` | `docker-compose.yml` قسم `api` |
| **API Endpoint للويب** | `8080` | `NEXT_PUBLIC_API_URL` | ملف `apps/web/.env.local` |
| **PostgreSQL** | `5432` | `POSTGRES_PORT` / `DATABASE_URL` | `docker-compose.yml` قسم `postgres` |
| **Redis** | `6380` (خارجي) | `REDIS_URL` | `docker-compose.yml` قسم `redis` |
| **EMQX MQTT** | `1883` | `MQTT_BROKER` | `docker-compose.yml` قسم `emqx` |
| **MediaMTX RTSP** | `8554` | Ports mapping `8554:8554` | `docker-compose.yml` و `mediamtx.yml` |
| **MediaMTX WebRTC** | `8889` | Ports mapping `8889:8889` | `infrastructure/mediamtx/mediamtx.yml` |
| **MediaMTX HLS** | `8888` | Ports mapping `8888:8888` | `infrastructure/mediamtx/mediamtx.yml` |

---

## 8. أوامر الصيانة والنسخ الاحتياطي

### أ. أخذ نسخة احتياطية من قاعدة البيانات:
```bash
docker compose exec -T postgres pg_dump -U saqr_user saqr_db > backup_$(date +%Y%m%d_%H%M%S).sql
```

### ب. استعادة نسخة احتياطية:
```bash
docker compose exec -T postgres psql -U saqr_user saqr_db < backup_file.sql
```

### ج. متابعة السجلات المباشرة لأي مشكلة:
```bash
# سجلات الـ API
docker compose logs -f api

# سجلات قاعدة البيانات
docker compose logs -f postgres

# سجلات الوسائط والبث المباشر
docker compose logs -f mediamtx
```

---

## 9. التحديث التلقائي لكافة السيرفرات (CI/CD GitHub Actions)

تم تجهيز ملف GitHub Action كامل في المسار:
`.github/workflows/deploy.yml`

وسكريبت التحديث المحلي في:
`scripts/deploy.sh`

### كيف تعمل ميزة التحديث المتعدد (Multi-Tenant Auto-Deploy)؟
عند عمل أي `git push origin main`:
1. يقوم GitHub Action تلقائياً بقراءة قائمة سيرفرات المطاعم المختلفة المسجلة لديك.
2. يتصل بكل سيرفر بالتوازي (In Parallel) عبر SSH.
3. ينفذ سكريبت `deploy.sh` على كل سيرفر لسحب أحدث كود، وتحديث جداول قاعدة البيانات، وإعادة بناء الـ API والـ Web تلقائياً.
4. خاصية `fail-fast: false` تضمن أنه لو كان سيرفر أحد المطاعم مغلقاً أو تحت الصيانة، **لن يتعطل تحديث بقية السيرفرات إطلاقاً**.

---

### خطوات الإعداد والتفعيل على GitHub:

#### 1. إضافة مفتاح الـ SSH الخاص (SSH Private Key):
* ولد مفتاح SSH مخصص للنشر (أو استخدم المفتاح المعتمد للسيرفرات):
  ```bash
  ssh-keygen -t ed25519 -C "github-actions-deploy" -N "" -f ~/.ssh/github_deploy
  ```
* انسخ المفتاح العام `github_deploy.pub` وضعه في ملف `~/.ssh/authorized_keys` على **كل سيرفر مطعم**.
* انسخ المفتاح الخاص `github_deploy` وضعه في GitHub:
  * اذهب لمستودعك على GitHub: `Settings` ➔ `Secrets and variables` ➔ `Actions` ➔ `New repository secret`.
  * الاسم: `SSH_PRIVATE_KEY`
  * القيمة: الصق محتوى المفتاح الخاص كاملاً.

---

#### 2. تحديد قائمة سيرفرات المطاعم (متغير `SERVERS_JSON`):
في نفس صفحة GitHub Settings:
* اضغط على تبويب **Variables** (بجوار Secrets).
* اضغط **New repository variable**.
* الاسم: `SERVERS_JSON`
* القيمة (ضع قائمة الـ VPS الخاصة بكل مطعم في مصفوفة JSON مع تحديد مسار المشروع `path` على كل سيرفر):
```json
[
  {
    "name": "مطعم فرع التجمع (Fit For Less)",
    "host": "159.65.120.10",
    "user": "root",
    "port": 22,
    "path": "/opt/saqr"
  },
  {
    "name": "مطعم فرع المعادي",
    "host": "167.99.85.20",
    "user": "root",
    "port": 22,
    "path": "/var/www/saqr"
  },
  {
    "name": "مطعم فرع الإسكندرية",
    "host": "134.209.40.35",
    "user": "root",
    "port": 22,
    "path": "/opt/saqr"
  }
]
```
> **ملاحظة ذكية حول `path`:** إضافة `"path"` تمنحك مرونة كاملة إذا كان هناك سيرفر تم تثبيت المشروع عليه في مسار مختلف (مثل `/var/www/saqr` أو مجلد مستخدم معين). وإذا تُرك `path` فارغاً، سيعتمد النظام تلقائياً المسار الافتراضي `/opt/saqr`.

---

### ➕ كيف تضيف سيرفر مطعم جديد مستقبلاً؟
كل ما عليك فعله عند انضمام مطعم جديد هو:
1. تجهيز الـ VPS وتثبيت الكود لأول مرة عبر `git clone git@github.com:essamalagamy1/saqr.git /opt/saqr`.
2. إضافة الـ IP الخاص بمطعم العميل الجديد إلى متغير `SERVERS_JSON` في إعدادات GitHub.
3. بمجرد أي `git push origin main`، سيقوم GitHub بتحديث كافة السيرفرات بما فيها السيرفر الجديد تلقائياً دون أي تدخل منك!

---
**صَقْر — منظومة الذكاء الاصطناعي لرصد ومراقبة المنشآت**
