# Gloves & Bare Hand Detection Model — Technical Evaluation Report

**Model:** `/mnt/essam/sites/saqr/computer-vision/gloves/weights/best.pt`  
**Evaluation Split:** `test`  
**Framework:** Ultralytics YOLO26 / PyTorch  
**Date:** 2026-11-24 00:56:11  

---

## 1. Overall Performance Metrics

| Metric | Score | Significance |
| :--- | :--- | :--- |
| **Bare Hand Recall (Critical)** | **0.7000** | قدرة الموديل على عدم تفويت أي يد مكشوفة |
| **mAP@50** | **0.8383** | Mean Average Precision at IoU=0.50 |
| **mAP@50-95** | **0.6270** | Primary benchmark across IoU thresholds |
| **Mean Precision** | **0.7844** | الدقة وتجنب الإنذارات الكاذبة |
| **Mean Recall** | **0.7700** | الشمولية الإجمالية للأيدي والجوانتيات |
| **Inference Latency** | **14.71 ms** | سرعة معالجة الإطار الواحد |
| **Throughput** | **68.0 FPS** | معدل الإطارات في الثانية للكاميرات |

---

## 2. Per-Class Breakdown

| Class ID | Class Name | Description | Precision | Recall | F1-Score | mAP50-95 |
| :---: | :--- | :--- | :---: | :---: | :---: | :---: |
| 0 | `gloves` | قفازات استخدام واحد (Compliant) | 0.9491 | 0.8400 | 0.8912 | 0.7748 |
| 1 | `bare_hand` | يد مكشوفة بدون جوانتي (Violation) | 0.6197 | 0.7000 | 0.6574 | 0.4792 |

---

## 3. Strict Industrial Compliance Logic

| Observation | Output Status | Interpretation | Action |
| :--- | :--- | :--- | :--- |
| Hand with Disposable Glove detected | `GLOVES_COMPLIANT` | العامل يرتدي قفازات نظيفة | لا يوجد (مطابق للمعايير) |
| Bare Hand detected | `BARE_HAND_VIOLATION` | يد مكشوفة تلامس الأغذية | تسجيل مخالفة وتنبيه فوري |
| No hands detected in frame | `UNKNOWN` | الأيدي محجوبة أو غير ظاهرة | لا يتم تسجيل مخالفة تخمينية |

---

## 4. Visual Artifacts
- **Metrics Chart:** `results/metrics_summary.png`
- **Confusion Matrix:** `results/evaluation_run/confusion_matrix.png`
- **PR Curve:** `results/evaluation_run/PR_curve.png`
- **F1 Curve:** `results/evaluation_run/F1_curve.png`
