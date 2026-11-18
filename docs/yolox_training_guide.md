# 🧠 دليل تدريب نموذج YOLOX المخصص لمطاعم "رَاصِد"

## 1. لماذا YOLOX بدلاً من YOLO؟

| الخاصية | YOLOX (Megvii) | Ultralytics YOLO (v8 / v11) |
|---|---|---|
| **الترخيص** | **Apache 2.0 (مجاني وتجاري 100%)** | AGPL-3.0 (يلزمك بفتح كود مشروعك أو دفع اشتراك تجاري سنوي باهظ) |
| **التشغيل على Edge** | خفيف جداً، يدعم ONNX Runtime و TensorRT | ثقيل ويتطلب بيئة بايثون كاملة |
| **التشفير وحماية الكود** | تقدر تبيع كودك وتغلقه بدون أي مسؤولية قانونية | مقيد تجارياً |

---

## 2. خطوات التدريب في Google Colab (مجاناً باستخدام T4 GPU)

### الخطوة 1: فتح Colab وتفعيل الـ GPU
1. افتح متصفحك واذهب إلى [Google Colab](https://colab.research.google.com).
2. من القائمة: `Runtime` ← `Change runtime type` ← اختر `T4 GPU`.

### الخطوة 2: تثبيت بيئة YOLOX
انسخ ونفذ الخلية التالية:

```bash
!git clone https://github.com/Megvii-BaseDetection/YOLOX.git
%cd YOLOX
!pip install -U pip && pip install -r requirements.txt
!pip install -v -e .
!pip install roboflow onnx onnxruntime
```

### الخطوة 3: تحميل Dataset معدات سلامة المطاعم (Kitchen PPE)
استخدم منصة Roboflow Universe المجانية لتحميل بيانات:
- `chef_hat` (غطاء رأس الشيف)
- `no_hat` (مخالفة عدم ارتداء غطاء)
- `gloves` (قفازات عمل)
- `no_gloves` (مخالفة بدون قفاز)

```python
from roboflow import Roboflow
rf = Roboflow(api_key="YOUR_FREE_API_KEY")
project = rf.workspace("roboflow-universe").project("kitchen-ppe")
version = project.version(1)
dataset = version.download("coco")
```

### الخطوة 4: تحميل أوزان YOLOX-S المسبقة
```bash
!wget https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_s.pth
```

### الخطوة 5: بدء التدريب (Fine-tuning)
```bash
!python tools/train.py -f exps/example/custom/yolox_restaurant.py -d 1 -b 16 --fp16 -o -c yolox_s.pth
```

### الخطوة 6: تصدير النموذج النهائي لصيغة ONNX
```bash
!python tools/export_onnx.py --output-name yolox_s_restaurant.onnx -f exps/example/custom/yolox_restaurant.py -c YOLOX_outputs/yolox_restaurant/best_ckpt.pth
```

---

## 3. نشر النموذج في نظام "رَاصِد"

1. انسخ ملف `yolox_s_restaurant.onnx` إلى مجلد:
   `/mnt/essam/sites/rased/services/edge-agent/models/yolox_s.onnx`
2. يقوم الـ Edge Agent بتحميل النموذج تلقائياً عبر `ONNXRuntime` دون الحاجة لأي مكتبات ثقيلة، ويبدأ في رصد المخالفات فوراً وإرسالها إلى الـ Go API ولوحة التحكم.
