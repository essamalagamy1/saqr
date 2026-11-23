# Saqr Computer Vision Engine — 3 Independent YOLO26 Models

نظام الرؤية الحاسوبية المستقل لمنظومة صَقْر للرصد والتحليل الذكي، مبني على أحدث بنية عصبية **Ultralytics YOLO26** بدون طبقة NMS منفصلة مع استهداف عتاد **NVIDIA Quadro P2000 (4GB VRAM)**.

---

## 🏗️ المعمارية المستقلة (Modular Architecture)

المشروع مفصول بالكامل إلى **3 موديلات مستقلة تماماً**، لكل موديل:
- Dataset مستقلة.
- Training Script مستقل.
- Validation Script مستقل.
- Prediction / Inference Script مستقل.
- Weights مستقلة.
- Evaluation Reports مستقلة.
- Configuration مستقلة.

```text
computer-vision/
├── shared/
│   ├── hardware_info.py       # تشخيص العتاد والذاكرة وضبط الـ Batch Size تلقائياً
│   ├── dataset_validator.py   # تدقيق جودة البيانات والإحداثيات واكتشاف الأخطاء
│   └── utils.py               # دوال التسجيل الموحد ورسم المنحنيات
│
├── face_mask/                 # 1. موديل كشف الكمامة (COMPLIANT, NO_MASK, INCORRECT_MASK)
│   ├── dataset/
│   ├── configs/data.yaml
│   ├── scripts/
│   │   ├── prepare_dataset.py # تحويل Pascal VOC XML إلى YOLO بدقة
│   │   ├── train.py           # تدريب مستقل مضبوط لـ 4GB VRAM
│   │   ├── validate.py        # تحقق مستقل وحساب mAP
│   │   ├── predict.py         # استدلال (صور، فيديو، كاميرا، RTSP)
│   │   └── evaluate.py        # تقرير تفصيلي مع حساب زمن الاستدلال و FPS
│   ├── weights/
│   └── results/
│
├── gloves/                    # 2. موديل قفازات المطابخ واليد المكشوفة (GLOVES, BARE_HAND)
│   ├── dataset/
│   ├── configs/data.yaml
│   ├── scripts/
│   │   ├── prepare_dataset.py
│   │   ├── train.py
│   │   ├── validate.py
│   │   ├── predict.py         # شرط صارم: عدم افتراض اليد المكشوفة عند احتجاب اليد
│   │   └── evaluate.py        # تركيز خاص على Recall كلاس bare_hand
│   ├── weights/
│   └── results/
│
├── phone_detection/           # 3. موديل كشف الهاتف المحمول (PHONE_DETECTED, NO_PHONE)
│   ├── dataset/
│   ├── configs/data.yaml
│   ├── scripts/
│   │   ├── test_pretrained.py # اختبار دقة أوزان COCO الأساسية أولاً
│   │   ├── prepare_dataset.py
│   │   ├── train.py
│   │   ├── validate.py
│   │   ├── predict.py
│   │   └── evaluate.py
│   ├── weights/
│   └── results/
│
├── requirements.txt
└── README.md
```

---

## ⚡ أوامر التشغيل والاستخدام المستقلة

### 1. موديل الكمامة (Face Mask Detection)
```bash
# تجهيز وتحويل الداتاسيت مع فحص الجودة
python face_mask/scripts/prepare_dataset.py

# بدء التدريب (تلقائياً يضبط batch=4..8 لبطاقة P2000)
python face_mask/scripts/train.py --epochs 50 --batch 8 --model yolo26n.pt

# الاستدلال على صورة أو بث RTSP
python face_mask/scripts/predict.py image.jpg --conf 0.25
python face_mask/scripts/predict.py "rtsp://admin:pass@192.168.1.10:554/ch1"

# إصدار تقرير التقييم الفني
python face_mask/scripts/evaluate.py --split test
```

### 2. موديل قفازات المنشآت الغذائية (Gloves Detection)
```bash
# تجهيز وتدقيق بيانات القفازات والأيدي المكشوفة
python gloves/scripts/prepare_dataset.py

# تدريب الموديل
python gloves/scripts/train.py --epochs 50 --batch 8

# الاستدلال (يرجع GLOVES_COMPLIANT, BARE_HAND_VIOLATION, أو UNKNOWN)
python gloves/scripts/predict.py kitchen_worker.jpg

# تقييم الموديل مع التركيز على Bare Hand Recall
python gloves/scripts/evaluate.py --split test
```

### 3. موديل الهاتف المحمول (Mobile Phone Detection)
```bash
# اختبار الأوزان الأساسية الجاهزة أولاً
python phone_detection/scripts/test_pretrained.py cctv_sample.jpg

# التدريب في حال الحاجة لتحسين رصد الهواتف الصغيرة
python phone_detection/scripts/train.py --epochs 50 --batch 8

# الاستدلال الفوري
python phone_detection/scripts/predict.py frame.jpg --conf 0.20
```
