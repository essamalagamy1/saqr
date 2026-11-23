# Face Mask Detection Model — Technical Evaluation Report

**Model:** `/mnt/essam/sites/saqr/computer-vision/face_mask/weights/best.pt`  
**Evaluation Split:** `test`  
**Framework:** Ultralytics YOLO26 / PyTorch  
**Date:** 2026-11-24 00:45:13  

---

## 1. Overall Performance Metrics

| Metric | Score | Description |
| :--- | :--- | :--- |
| **mAP@50** | **0.7975** | Mean Average Precision at IoU=0.50 |
| **mAP@50-95** | **0.5494** | Primary benchmark metric across IoU thresholds |
| **Mean Precision** | **0.7237** | Ratio of true positive detections |
| **Mean Recall** | **0.7935** | Coverage of ground-truth faces detected |
| **Latency** | **14.4 ms** | Average per-frame execution time |
| **Throughput** | **69.4 FPS** | Real-time surveillance speed |

---

## 2. Per-Class Independent Breakdown

| Class ID | Class Name | Description | Precision | Recall | F1-Score | mAP50-95 |
| :---: | :--- | :--- | :---: | :---: | :---: | :---: |
| 0 | `with_mask` | كمامة صحيحة (Compliant) | 0.8994 | 0.9302 | 0.9145 | 0.6501 |
| 1 | `without_mask` | بدون كمامة (No Mask) | 0.7750 | 0.8947 | 0.8306 | 0.5955 |
| 2 | `mask_weared_incorrect` | ارتداء خاطئ (Incorrect Mask) | 0.4966 | 0.5556 | 0.5244 | 0.4026 |

---

## 3. Business Logic Output Mapping

| Model Prediction | Business Domain Status | Arabic Meaning | Action Required |
| :--- | :--- | :--- | :--- |
| `with_mask` | `COMPLIANT` | يرتدي الكمامة بشكل صحيح | لا يوجد (مطابق للمعايير) |
| `without_mask` | `NO_MASK` | لا يرتدي الكمامة | تسجيل مخالفة فورية وتنبيه المشرف |
| `mask_weared_incorrect` | `INCORRECT_MASK` | يرتدي الكمامة بطريقة خاطئة | تنبيه العامل لتغطية الأنف والفم |

---

## 4. Visual Artifacts
- **Metrics Chart:** `results/metrics_summary.png`
- **Confusion Matrix:** `results/evaluation_run/confusion_matrix.png`
- **PR Curve:** `results/evaluation_run/PR_curve.png`
- **F1 Curve:** `results/evaluation_run/F1_curve.png`
