#!/usr/bin/env python3
"""
Comprehensive Evaluation & Reporting Script for Mobile Phone Detection Model
Reports mAP, Precision, Recall, Confusion Matrix, and Speed Benchmarks.
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

logger = setup_logger("Phone-Evaluate", str(PROJECT_DIR / "results" / "evaluate.log"))

def evaluate_and_report(weights_path: str = None, split: str = "test"):
    from ultralytics import YOLO

    if not weights_path:
        local_best = PROJECT_DIR / "weights" / "best.pt"
        if local_best.exists():
            weights_path = str(local_best)
        else:
            weights_path = "yolo26n.pt"

    config_path = str(PROJECT_DIR / "configs" / "data.yaml")
    logger.info(f"Evaluating Mobile Phone model on split: {split}")

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

    # Latency & FPS Benchmark
    dummy_input = np.zeros((640, 640, 3), dtype=np.uint8)
    for _ in range(5):
        model.predict(dummy_input, verbose=False)

    times = []
    for _ in range(30):
        t0 = time.perf_counter()
        model.predict(dummy_input, verbose=False)
        times.append(time.perf_counter() - t0)

    avg_latency_ms = round(np.mean(times) * 1000, 2)
    fps = round(1000.0 / avg_latency_ms, 1)

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
        "Mobile Phone Detection — Performance Metrics"
    )

    report_md = f"""# Mobile Phone Detection Model — Technical Evaluation Report

**Model:** `{weights_path}`  
**Evaluation Split:** `{split}`  
**Framework:** Ultralytics YOLO26 / PyTorch  
**Date:** {time.strftime('%Y-%m-%d %H:%M:%S')}  

---

## 1. Overall Performance Metrics

| Metric | Score | Description |
| :--- | :--- | :--- |
| **mAP@50** | **{overall_metrics['map50']:.4f}** | دقة التعرف المتوسطة عند تقاطع IoU=0.50 |
| **mAP@50-95** | **{overall_metrics['map50_95']:.4f}** | المقياس المعياري الشامل عبر كافة العتبات |
| **Precision** | **{overall_metrics['precision']:.4f}** | نسبة دقة الهواتف المرصودة وتجنب الإنذارات الخاطئة |
| **Recall** | **{overall_metrics['recall']:.4f}** | نسبة التقاط كافة الهواتف الموجودة في الكادر |
| **Latency** | **{overall_metrics['inference_latency_ms']} ms** | زمن استدلال الإطار الواحد |
| **Throughput** | **{overall_metrics['fps']} FPS** | سرعة البث المباشر لكاميرات المراقبة |

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
"""

    report_path = PROJECT_DIR / "results" / "evaluation_report.md"
    report_path.write_text(report_md, encoding="utf-8")

    json_path = PROJECT_DIR / "results" / "evaluation_metrics.json"
    with open(json_path, "w", encoding="utf-8") as jf:
        json.dump(overall_metrics, jf, indent=2)

    logger.info(f"✅ Generated Evaluation Report at: {report_path}")
    print(report_md)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Evaluate Phone Detection Model and Generate Report")
    parser.add_argument("--weights", type=str, default=None, help="Weights path")
    parser.add_argument("--split", type=str, default="test", choices=["val", "test"], help="Evaluation split")
    args = parser.parse_args()

    evaluate_and_report(weights_path=args.weights, split=args.split)
