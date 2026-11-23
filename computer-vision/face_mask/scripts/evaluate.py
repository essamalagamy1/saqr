#!/usr/bin/env python3
"""
Comprehensive Evaluation & Reporting Script for Face Mask Detection Model
Generates standalone technical markdown report with per-class metrics, latency benchmarks,
and confusion matrix analysis as requested in Section 7 of project specification.
"""

import os
import sys
import time
import json
import argparse
from pathlib import Path
import numpy as np

# Add shared utilities to Python path
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_DIR = SCRIPT_DIR.parent
ROOT_DIR = PROJECT_DIR.parent
sys.path.insert(0, str(ROOT_DIR / "shared"))

from utils import setup_logger, plot_metrics_summary

logger = setup_logger("FaceMask-Evaluate", str(PROJECT_DIR / "results" / "evaluate.log"))

CLASS_NAMES = ["with_mask", "without_mask", "mask_weared_incorrect"]
AR_NAMES = {
    "with_mask": "كمامة صحيحة (Compliant)",
    "without_mask": "بدون كمامة (No Mask)",
    "mask_weared_incorrect": "ارتداء خاطئ (Incorrect Mask)"
}

def evaluate_and_report(weights_path: str = None, split: str = "test"):
    from ultralytics import YOLO

    if not weights_path:
        local_best = PROJECT_DIR / "weights" / "best.pt"
        if local_best.exists():
            weights_path = str(local_best)
        else:
            weights_path = "yolo26n.pt"

    config_path = str(PROJECT_DIR / "configs" / "data.yaml")
    logger.info(f"Running full evaluation on split: {split}")

    model = YOLO(weights_path)
    metrics = model.val(
        data=config_path,
        split=split,
        imgsz=640,
        project=str(PROJECT_DIR / "results"),
        name="evaluation_run",
        exist_ok=True,
        plots=True
    )

    # Benchmark Inference Speed & FPS
    dummy_input = np.zeros((640, 640, 3), dtype=np.uint8)
    # Warmup
    for _ in range(5):
        model.predict(dummy_input, verbose=False)

    times = []
    for _ in range(30):
        t0 = time.perf_counter()
        model.predict(dummy_input, verbose=False)
        times.append(time.perf_counter() - t0)

    avg_latency_ms = round(np.mean(times) * 1000, 2)
    fps = round(1000.0 / avg_latency_ms, 1)

    # Class-level metrics
    per_class_results = []
    maps = metrics.box.maps  # per class mAP50-95
    p_per_class = metrics.box.p
    r_per_class = metrics.box.r
    f1_per_class = metrics.box.f1

    for idx, cname in enumerate(CLASS_NAMES):
        p = float(p_per_class[idx]) if len(p_per_class) > idx else 0.0
        r = float(r_per_class[idx]) if len(r_per_class) > idx else 0.0
        f1 = float(f1_per_class[idx]) if len(f1_per_class) > idx else 0.0
        map50_95 = float(maps[idx]) if len(maps) > idx else 0.0

        per_class_results.append({
            "class_id": idx,
            "name": cname,
            "ar_name": AR_NAMES.get(cname, cname),
            "precision": round(p, 4),
            "recall": round(r, 4),
            "f1_score": round(f1, 4),
            "map50_95": round(map50_95, 4)
        })

    overall_metrics = {
        "precision": round(float(metrics.box.mp), 4),
        "recall": round(float(metrics.box.mr), 4),
        "map50": round(float(metrics.box.map50), 4),
        "map50_95": round(float(metrics.box.map), 4),
        "inference_latency_ms": avg_latency_ms,
        "fps": fps
    }

    # Generate Plot
    chart_path = PROJECT_DIR / "results" / "metrics_summary.png"
    plot_metrics_summary(
        {"Precision": overall_metrics["precision"], "Recall": overall_metrics["recall"], "mAP50": overall_metrics["map50"], "mAP50-95": overall_metrics["map50_95"]},
        str(chart_path),
        "Face Mask Detection — Model Performance Summary"
    )

    # Generate Markdown Report
    report_md = f"""# Face Mask Detection Model — Technical Evaluation Report

**Model:** `{weights_path}`  
**Evaluation Split:** `{split}`  
**Framework:** Ultralytics YOLO26 / PyTorch  
**Date:** {time.strftime('%Y-%m-%d %H:%M:%S')}  

---

## 1. Overall Performance Metrics

| Metric | Score | Description |
| :--- | :--- | :--- |
| **mAP@50** | **{overall_metrics['map50']:.4f}** | Mean Average Precision at IoU=0.50 |
| **mAP@50-95** | **{overall_metrics['map50_95']:.4f}** | Primary benchmark metric across IoU thresholds |
| **Mean Precision** | **{overall_metrics['precision']:.4f}** | Ratio of true positive detections |
| **Mean Recall** | **{overall_metrics['recall']:.4f}** | Coverage of ground-truth faces detected |
| **Latency** | **{overall_metrics['inference_latency_ms']} ms** | Average per-frame execution time |
| **Throughput** | **{overall_metrics['fps']} FPS** | Real-time surveillance speed |

---

## 2. Per-Class Independent Breakdown

| Class ID | Class Name | Description | Precision | Recall | F1-Score | mAP50-95 |
| :---: | :--- | :--- | :---: | :---: | :---: | :---: |
"""
    for c in per_class_results:
        report_md += f"| {c['class_id']} | `{c['name']}` | {c['ar_name']} | {c['precision']:.4f} | {c['recall']:.4f} | {c['f1_score']:.4f} | {c['map50_95']:.4f} |\n"

    report_md += f"""
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
"""

    report_path = PROJECT_DIR / "results" / "evaluation_report.md"
    report_path.write_text(report_md, encoding="utf-8")

    json_path = PROJECT_DIR / "results" / "evaluation_metrics.json"
    with open(json_path, "w", encoding="utf-8") as jf:
        json.dump({"overall": overall_metrics, "per_class": per_class_results}, jf, indent=2)

    logger.info(f"✅ Generated Evaluation Report at: {report_path}")
    logger.info(f"✅ Saved metrics JSON to: {json_path}")
    print(report_md)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Evaluate Face Mask Model and Generate Report")
    parser.add_argument("--weights", type=str, default=None, help="Weights path")
    parser.add_argument("--split", type=str, default="test", choices=["val", "test"], help="Evaluation split")
    args = parser.parse_args()

    evaluate_and_report(weights_path=args.weights, split=args.split)
