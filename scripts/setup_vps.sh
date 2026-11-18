#!/usr/bin/env bash
set -e

# ==============================================================================
# صَقْر (Saqr) — سكريبت التثبيت والتجهيز الشامل لسيرفر VPS الجديد (Google Cloud / Ubuntu)
# ==============================================================================

echo "=========================================================="
echo "      🚀 مرحباً بك في معالج تثبيت منصة صَقْر (Saqr Platform)"
echo "=========================================================="

if [ "$EUID" -ne 0 ]; then
  echo "❌ يرجى تشغيل السكريبت بصلاحيات الـ root: sudo bash setup_vps.sh"
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

# 1. تفعيل ذاكرة المبادلة (Swap Memory 2GB) لدعم السيرفرات المجانية ومحدودة الرام
if [ ! -f /swapfile ]; then
  echo "⚙️ [1/7] تهيئة ذاكرة المبادلة (2GB Swap Memory)..."
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "✅ تم تفعيل Swap بنجاح."
else
  echo "ℹ️ ذاكرة Swap موجودة مسبقاً."
fi

# 2. تحديث الحزم وتثبيت المتطلبات الأساسية
echo "📦 [2/7] تحديث الحزم وتثبيت الأدوات الأساسية..."
apt-get update -y
apt-get install -y git curl wget ufw ca-certificates gnupg lsb-release nginx certbot python3-certbot-nginx

# 3. تثبيت Docker و Docker Compose الحديث
if ! command -v docker &> /dev/null; then
  echo "🐳 [3/7] تثبيت Docker & Docker Compose..."
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg --yes
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
  systemctl enable docker
  systemctl start docker
  echo "✅ تم تثبيت Docker بنجاح."
else
  echo "ℹ️ Docker مثبت مسبقاً."
fi

# 4. تثبيت Node.js 20 و PM2 للوحة التحكم (Next.js)
if ! command -v node &> /dev/null; then
  echo "🟢 [4/7] تثبيت Node.js 20 & PM2..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
  npm install -g pm2
  echo "✅ تم تثبيت Node.js $(node -v) و PM2."
else
  echo "ℹ️ Node.js مثبت مسبقاً ($(node -v))."
  npm install -g pm2 || true
fi

# 5. تنزيل كود المنصة في /opt/saqr
TARGET_DIR="/opt/saqr"
echo "📂 [5/7] سحب كود المشروع إلى $TARGET_DIR..."
if [ ! -d "$TARGET_DIR" ]; then
  mkdir -p "$TARGET_DIR"
  echo "يرجى إدخال رابط مستودع Git (الافتراضي: https://github.com/essamalagamy1/saqr.git):"
  read -r REPO_URL
  REPO_URL="${REPO_URL:-https://github.com/essamalagamy1/saqr.git}"
  git clone "$REPO_URL" "$TARGET_DIR"
else
  echo "المجلد $TARGET_DIR موجود بالفعل، جاري سحب التحديثات..."
  cd "$TARGET_DIR"
  git pull origin main || true
fi

cd "$TARGET_DIR"

# 6. تشغيل حاويات الدوكر (PostgreSQL, Redis, EMQX, MediaMTX, Go API)
echo "🚀 [6/7] تشغيل الحاويات الخلفية..."
docker compose up -d --build

# 7. بناء وتشغيل واجهة الويب عبر PM2
echo "💻 [7/7] بناء وتشغيل لوحة التحكم (Next.js)..."
cd "$TARGET_DIR/apps/web"

# إنشاء .env.local إذا لم يكن موجوداً
if [ ! -f .env.local ]; then
  echo "NEXT_PUBLIC_API_URL=http://127.0.0.1:8080" > .env.local
  echo "NEXT_PUBLIC_WS_URL=ws://127.0.0.1:8080/ws" >> .env.local
fi

npm install --production=false
npm run build
pm2 delete saqr-web 2>/dev/null || true
pm2 start npm --name "saqr-web" -- start
pm2 save
pm2 startup systemd -u root --hp /root || true

# إعداد Nginx
echo "🌐 ضبط خادم Nginx..."
PUBLIC_IP=$(curl -s https://api.ipify.org || hostname -I | awk '{print $1}')

cat > /etc/nginx/sites-available/saqr <<NGINX_CONF
server {
    listen 80;
    server_name _;

    client_max_body_size 50M;

    # 1. لوحة تحكم الويب
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
    }

    # 2. الواجهة البرمجية (API)
    location /api/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # 3. WebSocket للإشعارات اللحظية
    location /ws {
        proxy_pass http://127.0.0.1:8080/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host \$host;
    }

    # 4. بث الكاميرات المباشر (WebRTC & HLS)
    location /cam-stream/ {
        proxy_pass http://127.0.0.1:8888/;
        proxy_set_header Host \$host;
    }
}
NGINX_CONF

ln -sf /etc/nginx/sites-available/saqr /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo "=========================================================="
echo "🎉 تم اكتمال التثبيت وتشغيل المنصة بنجاح على السيرفر!"
echo "=========================================================="
echo "🌐 رابط الدخول للوحة التحكم: http://$PUBLIC_IP"
echo "🔌 عنوان الـ API المباشر:   http://$PUBLIC_IP/api/v1"
echo ""
echo "💡 لإنشاء أول شركة ومستخدم مدير، شغل الأمر:"
echo "   cd /opt/saqr && ./scripts/create_company.sh"
echo "=========================================================="
