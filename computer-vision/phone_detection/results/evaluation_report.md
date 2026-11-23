# Mobile Phone Detection Model — Technical Evaluation Report

**Model:** `/mnt/essam/sites/saqr/computer-vision/phone_detection/weights/best.pt`  
**Evaluation Split:** `test`  
**Framework:** Ultralytics YOLO26 / PyTorch  
**Date:** 2026-11-24 01:00:34  

---

## 1. Overall Performance Metrics

| Metric | Score | Description |
| :--- | :--- | :--- |
| **mAP@50** | **0.9950** | دقة التعرف المتوسطة عند تقاطع IoU=0.50 |
| **mAP@50-95** | **0.8739** | المقياس المعياري الشامل عبر كافة العتبات |
| **Precision** | **0.9951** | نسبة دقة الهواتف المرصودة وتجنب الإنذارات الخاطئة |
| **Recall** | **1.0000** | نسبة التقاط كافة الهواتف الموجودة في الكادر |
| **Latency** | **15.68 ms** | زمن استدلال الإطار الواحد |
| **Throughput** | **63.8 FPS** | سرعة البث المباشر لكاميرات المراقبة |

---

## 2. Business Logic Mapping

| Detection | Final Business Status | Arabic Action |
| :--- | :--- | :--- |
| Phone detected in hand / table | `PHONE_DETECTED` | تسجيل مخالفة استخدام هاتف محمول وتنبيه المشرف |
| No phone detected | `NO_PHONE_DETECTED` | بيئة عمل ملتزمة (مع مراعاة وضوح زاوية الرؤية) |

---

## 3. Visual Artifacts
- **Metrics Chart:** `results/metrics_summary.png`
- **Confusion Matrix:** `results/evaluation_run/confusion_matrix.png`
