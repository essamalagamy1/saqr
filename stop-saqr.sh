#!/bin/bash
# ==============================================================================
# سكريبت إيقاف منظومة صَقْر بالكامل (Saqr Complete Shutdown)
# يقوم بإغلاق جميع العمليات والحاويات المرتبطة بالمشروع لتحرير كامل موارد الجهاز
# مع الحفاظ على بيانات قاعدة البيانات (Docker Volumes) بدون حذف.
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "========================================================================"
echo "🛑 منظومة صَـــــقْر • جاري إيقاف جميع الخدمات والعمليات..."
echo "========================================================================"

stop_pattern() {
    local label="$1"
    local pattern="$2"
    if pgrep -f "$pattern" >/dev/null 2>&1; then
        echo "⏳ إيقاف $label..."
        pkill -TERM -f "$pattern" 2>/dev/null || true
        sleep 1
        if pgrep -f "$pattern" >/dev/null 2>&1; then
            pkill -KILL -f "$pattern" 2>/dev/null || true
        fi
        echo "✅ تم إيقاف $label."
    else
        echo "ℹ️  $label غير مشغّل."
    fi
}

# 1. إيقاف نفق Cloudflare وسكربت start-tunnel
stop_pattern "نفق Cloudflare" "cloudflared tunnel.*localhost:3000"
stop_pattern "سكربت start-tunnel.sh" "start-tunnel\.sh"
pkill -f "tail -f /tmp/saqr_cloudflared\.log" 2>/dev/null || true

# 2. إيقاف محرك الرصد بالذكاء الاصطناعي (server-detector.js)
stop_pattern "محرك الرصد (server-detector)" "server-detector\.js"

# 3. إيقاف أي تدريب نشط في مختبر التدريب المخصص وتنظيف القفل
stop_pattern "تدريب GPU (train_custom_studio)" "train_custom_studio\.py"
stop_pattern "مساعد الاستدلال (studio_infer)" "studio_infer\.js"
rm -f "$SCRIPT_DIR/storage/training_studio/active.lock"

# 4. إيقاف خادم الويب (Next.js)
stop_pattern "خادم الويب (Next.js)" "$SCRIPT_DIR/apps/web/node_modules/.bin/next"
stop_pattern "عملية next-server" "next-server"
stop_pattern "خادم التطوير next dev" "next dev -p 3000"

# تحرير المنفذ 3000 إذا بقي مشغولاً
if command -v fuser >/dev/null 2>&1; then
    fuser -k 3000/tcp >/dev/null 2>&1 || true
fi

# 5. إيقاف حاويات Docker الخاصة بالمشروع (مع حفظ البيانات)
if command -v docker >/dev/null 2>&1; then
    if docker ps --format '{{.Names}}' 2>/dev/null | grep -qE '^rased-'; then
        echo "⏳ إيقاف حاويات Docker (rased)..."
        cd "$SCRIPT_DIR" && docker compose -p rased stop
        echo "✅ تم إيقاف جميع حاويات Docker."
    else
        echo "ℹ️  حاويات Docker (rased) متوقفة بالفعل."
    fi
fi

echo ""
echo "========================================================================"
echo "✅ تم إيقاف جميع خدمات صَقْر وتحرير موارد الجهاز بالكامل."
echo "========================================================================"
