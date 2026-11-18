# صَقْر Edge Agent — تطبيق ويندوز المكتبي (Windows Desktop App)

تطبيق مكتبي مخصص لأجهزة ويندوز المتصلة على نفس شبكة الواي فاي أو الراوتر المحلي الموجود عليه كاميرات المراقبة (RTSP/IP Cameras).

## مميزات التطبيق

1. **معالج الربط والإعداد الأولي (Setup Wizard):**
   - إمكانية إدخال دومين أو رابط الخادم السحابي (`https://rased.yourdomain.com` أو IP محلي) عند أول تشغيل بعد التثبيت.
   - التحقق من بيانات الدخول ومعرف المنشأة واختبار الاتصال فورياً.
2. **مرونة تغيير الدومين (Dynamic Domain & Settings):**
   - صفحة إعدادات تتيح تحديث وتعديل رابط الخادم السحابي في أي وقت بدون الحاجة لإعادة تثبيت البرنامج.
3. **تحليل ذكي محلي (Local YOLOX AI Inference):**
   - استخدام محرك YOLOX خفيف الوزن (مرخص Apache 2.0).
   - سحب الإطارات ومعالجتها محلياً وترحيل المخالفات والإنذارات عبر الـ API فقط، مما يوفر استهلاك الباندويث والإنترنت.
4. **التكامل مع كاميرات الشبكة (RTSP Stream Capture):**
   - دعم بروتوكول RTSP القياسي عبر TCP/UDP لكاميرات Hikvision, Dahua, Uniview وأي جهاز DVR/NVR.
   - إمكانية سحب الكاميرات المسجلة مسبقاً من الخادم السحابي بضغطة زر واحدة أو إضافتها يدوياً.
5. **التشغيل بالخلفية (System Tray Integration):**
   - تصغير تلقائي بجوار الساعة في شريط مهام ويندوز، مع إمكانية التشغيل التلقائي مع إقلاع النظام (Auto-launch on startup).

---

## بنية الملفات (File Structure)

```
apps/desktop/
├── assets/
│   ├── icon.ico            # أيقونة ويندوز للبرنامج والـ Installer
│   └── icon.png            # أيقونة التطبيق والـ System Tray
├── models/
│   └── yolox_s.onnx        # نموذج YOLOX ONNX للذكاء الاصطناعي
├── renderer/
│   ├── main.html           # واجهة لوحة التحكم وإدارة الكاميرات
│   ├── main-renderer.js    # منطق واجهة التحكم والأحداث
│   ├── setup.html          # معالج الإعداد الأولي وإدخال الدومين
│   ├── setup.js            # منطق التحقق والاتصال
│   └── styles.css          # ثيم داكن احترافي وعصري (Dark Theme)
├── src/
│   ├── main.js             # العملية الرئيسية لـ Electron وإدارة النوافذ والـ Tray
│   ├── preload.js          # جسر IPC الآمن ContextBridge
│   ├── api-client.js       # عميل التواصل مع Cloud API
│   ├── camera-worker.js    # معالج سحب وتفكيك إطارات الـ RTSP عبر FFmpeg
│   ├── ai-engine.js        # محرك الفحص YOLOX ومعالجة NMS والـ Bounding Boxes
│   └── agent-runner.js     # المنسق العام للمراقبة (Orchestrator)
├── package.json
└── README.md
```

---

## أوامر التشغيل والبناء (Commands)

### 1. تثبيت الحزم:
```bash
cd apps/desktop
npm install
```

### 2. تشغيل التطبيق في وضع التطوير (Dev Mode):
```bash
npm start
# أو عبر الـ Makefile الرئيسي:
make desktop
```

### 3. بناء ملف التثبيت المكتبي لنظام ويندوز (`.exe` NSIS Installer):
```bash
npm run build
# سيتم إنشاء ملف التثبيت النهائي داخل:
# apps/desktop/dist/Rased Edge Agent Setup 1.0.0.exe
```
