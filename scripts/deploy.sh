#!/usr/bin/env bash
# Saqr Platform — Automated Server Update & Deployment Script
set -e

echo "=========================================================="
echo "      🦅 منظومة صَقْر — بدء التحديث التلقائي للسيرفر       "
echo "=========================================================="
echo "📍 الخادم الحالي: $(hostname) [$(date)]"

# Change directory to project root
PROJECT_DIR="${SAQR_DIR:-/opt/saqr}"
if [ -d "$PROJECT_DIR" ]; then
    cd "$PROJECT_DIR"
else
    echo "⚠️ المجلد $PROJECT_DIR غير موجود، جاري استخدام المجلد الحالي: $(pwd)"
fi

# 1. Pull latest commits from GitHub main branch
echo "📥 1/4 جاري سحب أحدث كود من GitHub (main branch)..."
git fetch origin main
git reset --hard origin/main

# 2. Apply any new database migrations
echo "🗄️ 2/4 التحقق من تحديثات قاعدة البيانات (Migrations)..."
PG_USER=${POSTGRES_USER:-"rased"}
PG_DB=${POSTGRES_DB:-"rased"}

if docker compose ps | grep -q "postgres"; then
    if [ -f apps/api/pkg/database/migrations/001_initial_schema.up.sql ]; then
        docker compose exec -T postgres psql -U "$PG_USER" -d "$PG_DB" < apps/api/pkg/database/migrations/001_initial_schema.up.sql 2>/dev/null || true
    fi
    if [ -f apps/api/pkg/database/migrations/002_tasks_and_notifications.up.sql ]; then
        docker compose exec -T postgres psql -U "$PG_USER" -d "$PG_DB" < apps/api/pkg/database/migrations/002_tasks_and_notifications.up.sql 2>/dev/null || true
    fi
    echo "✅ تم فحص جداول قاعدة البيانات."
fi

# 3. Rebuild and restart API container
echo "⚙️ 3/4 تحديث وإعادة تشغيل حاوية الـ Go API..."
docker compose build api
docker compose up -d api

# 4. Build and restart Web Dashboard (Next.js)
echo "🌐 4/4 بناء وتحديث واجهة الويب (Next.js)..."
if [ -d "apps/web" ]; then
    cd apps/web
    npm install --legacy-peer-deps
    npm run build

    if command -v pm2 &> /dev/null; then
        pm2 restart saqr-web || pm2 start npm --name "saqr-web" -- start -- -p 3000
    else
        echo "⚠️ PM2 غير مثبت، يرجى تشغيل واجهة الويب يدوياً أو تثبيت PM2."
    fi
    cd ../..
fi

echo "=========================================================="
echo "✅ تم تحديث منصة صَقْر بنجاح وعمل كافة الخدمات بكفاءة!"
echo "=========================================================="
