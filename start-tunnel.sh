#!/bin/bash
# ==============================================================================
# سكريبت تشغيل نفق كلاودفلير لمنظومة صَقْر (Saqr Cloudflare Tunnel Launcher)
# يقوم بالتحقق من تشغيل Docker، وتشغيل ويب صقر (Next.js) تلقائياً، وتوليد الرابط المباشر
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLOUDFLARED_BIN="/home/essam/.config/laramonster/tools/cloudflared/cloudflared"

if [ ! -f "$CLOUDFLARED_BIN" ]; then
    CLOUDFLARED_BIN="$(which cloudflared 2>/dev/null)"
fi

if [ -z "$CLOUDFLARED_BIN" ] || [ ! -x "$CLOUDFLARED_BIN" ]; then
    echo "❌ خطأ: لم يتم العثور على أداة cloudflared في النظام."
    exit 1
fi

echo "========================================================================"
echo "🦅 منظومة صَـــــقْر للرصد الذكي • جاري فحص الخدمات وتجهيز النفق السحابي..."
echo "========================================================================"

# 1. فحص وتشغيل خدمات Docker (قاعدة البيانات والـ API)
if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q "rased-api"; then
    echo "⏳ جاري تشغيل خدمات قاعدة البيانات وواجهة البرمجة (Docker)..."
    cd "$SCRIPT_DIR" && docker compose -p rased up -d --no-recreate 2>/dev/null
    sleep 2
fi

# 2. فحص وتشغيل خادم Next.js على المنفذ 3000 إذا لم يكن يعمل
if ! curl -s -f -o /dev/null "http://localhost:3000/" --max-time 2 2>/dev/null; then
    echo "⏳ خادم الويب (Next.js) ليس قيد التشغيل، جاري بدء تشغيله في الخلفية..."
    cd "$SCRIPT_DIR/apps/web" && nohup npm run dev > /tmp/saqr-web.log 2>&1 &
    
    echo -n "⏳ بانتظار استجابة خادم الويب على المنفذ 3000"
    READY=false
    for i in $(seq 1 30); do
        if curl -s -f -o /dev/null "http://localhost:3000/" --max-time 1 2>/dev/null; then
            READY=true
            echo " [تم ✅]"
            break
        fi
        echo -n "."
        sleep 1
    done

    if [ "$READY" = false ]; then
        echo ""
        echo "⚠️ تحذير: خادم Next.js يستغرق وقتاً أطول للبدء. سيستمر النفق في المحاولة..."
    fi
else
    echo "✅ خادم الويب (Next.js) يعمل بالفعل وجاهز على المنفذ 3000."
fi

# 3. إنهاء أي نفق قديم متصل بنفس المنفذ لتجنب التعارض
pkill -f "cloudflared tunnel.*http://localhost:3000" 2>/dev/null
sleep 1

# 4. تشغيل النفق واستخراج الرابط وعرضه بشكل واضح
LOG_FILE="/tmp/saqr_cloudflared.log"
rm -f "$LOG_FILE"

"$CLOUDFLARED_BIN" tunnel --url http://localhost:3000 > "$LOG_FILE" 2>&1 &
TUNNEL_PID=$!

trap "kill $TUNNEL_PID 2>/dev/null; exit 0" SIGINT SIGTERM

echo "⏳ جاري طلب رابط النفق من Cloudflare..."

TUNNEL_URL=""
for i in $(seq 1 25); do
    if [ -f "$LOG_FILE" ]; then
        TUNNEL_URL=$(grep -o 'https://[-a-zA-Z0-9@:%._\+~#=]\+\.trycloudflare\.com' "$LOG_FILE" | head -n 1)
        if [ -n "$TUNNEL_URL" ]; then
            break
        fi
    fi
    sleep 1
done

if [ -n "$TUNNEL_URL" ]; then
    echo "$TUNNEL_URL" > "$SCRIPT_DIR/.tunnel-url"
    echo ""
    echo "========================================================================"
    echo "🎉 تم إنشاء وتشغيل نفق صقر السحابي بنجاح!"
    echo "========================================================================"
    echo "🌐 رابط المنصة الرئيسي:   $TUNNEL_URL"
    echo "📸 صفحة الكاميرات المباشرة: $TUNNEL_URL/cameras"
    echo "📥 تحميل تطبيق الويندوز:   $TUNNEL_URL/downloads/Saqr-Edge-Agent-Win64.zip"
    echo "📦 التحديث السريع للتطبيق:  $TUNNEL_URL/downloads/app.asar"
    echo "========================================================================"
    echo "💡 النفق يعمل الآن في هذه النافذة (اضغط Ctrl+C للإيقاف)."
    echo ""
else
    echo "⚠️ لم نتمكن من التقاط الرابط سريعاً. مخرجات cloudflared الأخيرة:"
    tail -n 10 "$LOG_FILE"
fi

# إبقاء السكريبت يعمل مع تصفية رسائل التحذير غير الهامة
tail -f "$LOG_FILE" 2>/dev/null | grep --line-buffered -v -E "ping_group_range|ICMP proxy|Cannot determine default configuration|curve preferences"
