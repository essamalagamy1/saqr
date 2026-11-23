#!/usr/bin/env python3
"""
Pretrained YOLO26 Evaluation on COCO Class 'cell phone' (Class ID 67)
Tests base YOLO26n performance on CCTV sample footage before undertaking fine-tuning.
"""

import os
import sys
import argparse
from pathlib import Path
import cv2

# Add shared utilities to Python path
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_DIR = SCRIPT_DIR.parent
ROOT_DIR = PROJECT_DIR.parent
sys.path.insert(0, str(ROOT_DIR / "shared"))

from utils import setup_logger

logger = setup_logger("Phone-PretrainedTest", str(PROJECT_DIR / "results" / "pretrained_test.log"))

COCO_PHONE_CLASS_ID = 67  # 'cell phone' in standard COCO dataset

def test_pretrained_coco_phone(source_path: str, model_name: str = "yolo26n.pt", conf_threshold: float = 0.20):
    from ultralytics import YOLO

    logger.info(f"Loading pretrained model: {model_name}...")
    model = YOLO(model_name)

    p = Path(source_path)
    output_dir = PROJECT_DIR / "results" / "pretrained_coco_eval"
    output_dir.mkdir(parents=True, exist_ok=True)

    if p.is_file():
        frame = cv2.imread(str(p))
        if frame is None:
            logger.error(f"Cannot read image: {p}")
            return

        # Inference specifically filtering for cell phone
        results = model.predict(source=frame, classes=[COCO_PHONE_CLASS_ID], conf=conf_threshold, verbose=False)
        annotated = frame.copy()
        phone_count = len(results[0].boxes)

        for box in results[0].boxes:
            conf = float(box.conf[0].item())
            x1, y1, x2, y2 = box.xyxy[0].cpu().numpy().astype(int)
            cv2.rectangle(annotated, (x1, y1), (x2, y2), (0, 0, 255), 2)
            cv2.putText(annotated, f"CELL PHONE ({conf:.0%})", (x1, max(y1 - 6, 15)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 2)

        out_file = output_dir / f"eval_{p.name}"
        cv2.imwrite(str(out_file), annotated)

        status = "PHONE_DETECTED" if phone_count > 0 else "NO_PHONE_DETECTED"
        logger.info(f"Image: {p.name} | Result: {status} | Phones Detected: {phone_count}")
        print("\n" + "=" * 55)
        print(f"Pretrained YOLO26 COCO Evaluation on {p.name}:")
        print(f"Status: {status} (Count: {phone_count})")
        print(f"Annotated preview saved to: {out_file}")
        print("=" * 55)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Test Pretrained YOLO26 Cell Phone Detection")
    parser.add_argument("source", help="Path to CCTV image or folder to test")
    parser.add_argument("--model", type=str, default="yolo26n.pt", help="Pretrained model")
    parser.add_argument("--conf", type=float, default=0.20, help="Confidence threshold")
    args = parser.parse_args()

    test_pretrained_coco_phone(args.source, model_name=args.model, conf_threshold=args.conf)
