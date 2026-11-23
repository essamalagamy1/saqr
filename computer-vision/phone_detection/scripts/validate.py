#!/usr/bin/env python3
"""
Validation Script for Mobile Phone Detection Model
"""

import os
import sys
import argparse
from pathlib import Path

# Add shared utilities to Python path
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_DIR = SCRIPT_DIR.parent
ROOT_DIR = PROJECT_DIR.parent
sys.path.insert(0, str(ROOT_DIR / "shared"))

from utils import setup_logger

logger = setup_logger("Phone-Validate", str(PROJECT_DIR / "results" / "validate.log"))

def run_validation(weights_path: str = None, split: str = "val", imgsz: int = 640):
    from ultralytics import YOLO

    if not weights_path:
        local_best = PROJECT_DIR / "weights" / "best.pt"
        if local_best.exists():
            weights_path = str(local_best)
        else:
            weights_path = "yolo26n.pt"

    config_path = str(PROJECT_DIR / "configs" / "data.yaml")
    logger.info(f"Validating Phone Detection model on split [{split}]...")

    model = YOLO(weights_path)
    metrics = model.val(
        data=config_path,
        split=split,
        imgsz=imgsz,
        project=str(PROJECT_DIR / "results"),
        name=f"val_{split}",
        exist_ok=True,
        plots=True
    )

    logger.info("Validation complete.")
    logger.info(f"mAP50:     {metrics.box.map50:.4f}")
    logger.info(f"mAP50-95:  {metrics.box.map:.4f}")
    logger.info(f"Precision: {metrics.box.mp:.4f}")
    logger.info(f"Recall:    {metrics.box.mr:.4f}")

    return metrics

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Validate Phone Detection Model")
    parser.add_argument("--weights", type=str, default=None, help="Weights path")
    parser.add_argument("--split", type=str, default="val", choices=["val", "test"], help="Dataset split")
    parser.add_argument("--imgsz", type=int, default=640, help="Image resolution")
    args = parser.parse_args()

    run_validation(weights_path=args.weights, split=args.split, imgsz=args.imgsz)
