#!/bin/bash
# سكريبت تشغيل نفق كلاودفلير لمشروع صقر (Saqr Cloudflare Tunnel)

CLOUDFLARED_BIN="/home/essam/.config/laramonster/tools/cloudflared/cloudflared"

if [ ! -f "$CLOUDFLARED_BIN" ]; then
    echo "خطأ: لم يتم العثور على أداة cloudflared في المسار: $CLOUDFLARED_BIN"
    exit 1
fi

echo "========================================================"
echo "🚀 جاري تشغيل نفق Cloudflare Tunnel للوحة تحكم صقر..."
echo "========================================================"

# التأكد من عدم وجود نفق قديم معلق
pkill -f "cloudflared tunnel --url http://localhost:3000" 2>/dev/null

# تشغيل النفق وعرض الرابط مباشرة
"$CLOUDFLARED_BIN" tunnel --url http://localhost:3000
