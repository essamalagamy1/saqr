#!/usr/bin/env python3
"""
Prediction & Live Inference Script for Face Mask Detection
Supports Single Image, Image Folder, Video File, Webcam, and RTSP Streams.
Translates classes to: COMPLIANT, NO_MASK, INCORRECT_MASK.
"""

import os
import sys
import time
import argparse
from pathlib import Path
import cv2
import numpy as np

# Add shared utilities to Python path
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_DIR = SCRIPT_DIR.parent
ROOT_DIR = PROJECT_DIR.parent
sys.path.insert(0, str(ROOT_DIR / "shared"))

from utils import setup_logger

logger = setup_logger("FaceMask-Predict")

# Final Business Domain Statuses requested by User
STATUS_MAP = {
    "with_mask": {
        "status": "COMPLIANT",
        "ar_label": "يرتدي الكمامة بشكل صحيح",
        "color": (0, 200, 0)      # Green
    },
    "without_mask": {
        "status": "NO_MASK",
        "ar_label": "مخالفة: بدون كمامة",
        "color": (0, 0, 255)      # Red
    },
    "mask_weared_incorrect": {
        "status": "INCORRECT_MASK",
        "ar_label": "مخالفة: ارتداء غير صحيح للكمامة",
        "color": (0, 165, 255)    # Orange
    }
}

def load_inference_model(weights_path: str = None):
    from ultralytics import YOLO

    if not weights_path:
        local_best = PROJECT_DIR / "weights" / "best.pt"
        if local_best.exists():
            weights_path = str(local_best)
        else:
            weights_path = "yolo26n.pt"

    logger.info(f"Loading Face Mask model from: {weights_path}")
    return YOLO(weights_path)

def process_frame(model, frame, conf_threshold: float = 0.25):
    """Runs inference on a single BGR frame and returns annotated frame + detections list."""
    results = model.predict(source=frame, conf=conf_threshold, verbose=False)
    annotated = frame.copy()
    detections = []

    if not results or len(results) == 0:
        return annotated, detections

    r = results[0]
    boxes = r.boxes
    h_img, w_img = frame.shape[:2]

    for box in boxes:
        cls_id = int(box.cls[0].item())
        conf = float(box.conf[0].item())
        raw_name = r.names.get(cls_id, f"class_{cls_id}").lower()
        xyxy = box.xyxy[0].cpu().numpy().astype(int)
        x1, y1, x2, y2 = xyxy

        meta = STATUS_MAP.get(raw_name, {
            "status": raw_name.upper(),
            "ar_label": raw_name,
            "color": (255, 255, 255)
        })

        color = meta["color"]
        status = meta["status"]

        # Draw box
        cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 2)

        # Label tag
        label_text = f"{status} ({conf:.0%})"
        (w_txt, h_txt), baseline = cv2.getTextSize(label_text, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 2)
        cv2.rectangle(annotated, (x1, max(y1 - h_txt - 6, 0)), (x1 + w_txt + 4, max(y1, h_txt + 6)), color, -1)
        cv2.putText(annotated, label_text, (x1 + 2, max(y1 - 4, h_txt + 2)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 2)

        detections.append({
            "status": status,
            "raw_class": raw_name,
            "ar_label": meta["ar_label"],
            "confidence": round(conf, 4),
            "box": [int(x1), int(y1), int(x2), int(y2)],
            "normalized_box": [
                round(x1 / w_img, 4),
                round(y1 / h_img, 4),
                round(x2 / w_img, 4),
                round(y2 / h_img, 4)
            ]
        })

    return annotated, detections

def run_prediction(source: str, weights_path: str = None, conf: float = 0.25, output_dir: str = None):
    model = load_inference_model(weights_path)

    if not output_dir:
        output_dir = PROJECT_DIR / "results" / "predictions"
    else:
        output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    # 1. Webcam or numeric camera index
    if source.isdigit():
        cap = cv2.VideoCapture(int(source))
        _stream_capture(model, cap, conf, window_name=f"Face Mask Stream (Camera {source})")
        return

    # 2. RTSP Stream or Video File
    p = Path(source)
    is_video = source.startswith("rtsp://") or source.startswith("http://") or (p.exists() and p.suffix.lower() in [".mp4", ".avi", ".mkv", ".mov"])
    if is_video:
        cap = cv2.VideoCapture(source)
        if not cap.isOpened():
            logger.error(f"Failed to open video source: {source}")
            return

        out_video_path = output_dir / f"annotated_{Path(source).name if not source.startswith('rtsp') else 'rtsp_output.mp4'}"
        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        fps = int(cap.get(cv2.CAP_PROP_FPS)) or 25
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 1280
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 720
        writer = cv2.VideoWriter(str(out_video_path), fourcc, fps, (w, h))

        logger.info(f"Processing video/RTSP stream from: {source}")
        frame_idx = 0
        t0 = time.time()
        while True:
            ret, frame = cap.read()
            if not ret:
                break
            annotated, _ = process_frame(model, frame, conf)
            writer.write(annotated)
            frame_idx += 1
            if frame_idx % 50 == 0:
                elapsed = time.time() - t0
                logger.info(f"Processed {frame_idx} frames ({frame_idx / elapsed:.1f} FPS)...")

        cap.release()
        writer.release()
        logger.info(f"Saved annotated video to: {out_video_path}")
        return

    # 3. Directory of images
    if p.is_dir():
        image_files = sorted(list(p.glob("*.jpg")) + list(p.glob("*.png")) + list(p.glob("*.jpeg")))
        logger.info(f"Running inference on directory ({len(image_files)} images)...")
        for img_p in image_files:
            frame = cv2.imread(str(img_p))
            if frame is None:
                continue
            annotated, dets = process_frame(model, frame, conf)
            cv2.imwrite(str(output_dir / f"annotated_{img_p.name}"), annotated)
        logger.info(f"Saved {len(image_files)} annotated images to: {output_dir}")
        return

    # 4. Single Image
    if p.is_file():
        frame = cv2.imread(str(p))
        if frame is None:
            logger.error(f"Cannot read image file: {p}")
            return
        annotated, detections = process_frame(model, frame, conf)
        out_path = output_dir / f"annotated_{p.name}"
        cv2.imwrite(str(out_path), annotated)
        logger.info(f"Saved annotated image to: {out_path}")
        print("\n" + "=" * 50)
        print(f"Face Mask Detection Results ({len(detections)} faces detected):")
        print("=" * 50)
        for i, d in enumerate(detections, 1):
            print(f"[{i}] Status: {d['status']:16s} | Confidence: {d['confidence']:.1%} | BBox: {d['box']}")
        print("=" * 50)
        return

    logger.error(f"Source not recognized: {source}")

def _stream_capture(model, cap, conf, window_name="Stream"):
    logger.info(f"Starting real-time live preview: {window_name} (Press 'q' to stop)")
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        annotated, _ = process_frame(model, frame, conf)
        cv2.imshow(window_name, annotated)
        if cv2.waitKey(1) & 0xFF == ord('q'):
            break
    cap.release()
    cv2.destroyAllWindows()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Predict Face Mask Detection on Media")
    parser.add_argument("source", help="Path to image, folder, video, camera index (0), or RTSP URL")
    parser.add_argument("--weights", type=str, default=None, help="Path to model weights (defaults to weights/best.pt)")
    parser.add_argument("--conf", type=float, default=0.25, help="Confidence threshold")
    parser.add_argument("--output", type=str, default=None, help="Directory to save annotated outputs")
    args = parser.parse_args()

    run_prediction(args.source, weights_path=args.weights, conf=args.conf, output_dir=args.output)
