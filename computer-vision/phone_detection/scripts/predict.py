#!/usr/bin/env python3
"""
Prediction & Inference Script for Mobile Phone Detection
Outputs: PHONE_DETECTED or NO_PHONE_DETECTED.
Handles Single Image, Directory, Video File, Webcam, and RTSP Stream.
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

logger = setup_logger("Phone-Predict")

def load_inference_model(weights_path: str = None):
    from ultralytics import YOLO

    if not weights_path:
        local_best = PROJECT_DIR / "weights" / "best.pt"
        if local_best.exists():
            weights_path = str(local_best)
        else:
            weights_path = "yolo26n.pt"

    logger.info(f"Loading Phone Detection model from: {weights_path}")
    return YOLO(weights_path)

def process_frame(model, frame, conf_threshold: float = 0.20):
    """
    Runs inference on frame for cell phone.
    Returns annotated frame, detections, and final status (PHONE_DETECTED or NO_PHONE_DETECTED).
    """
    # If using pretrained COCO model, filter for class 67 (cell phone)
    # If using fine-tuned model with 1 class, filter class 0
    classes_filter = [0] if len(model.names) == 1 else [67]

    results = model.predict(source=frame, classes=classes_filter, conf=conf_threshold, verbose=False)
    annotated = frame.copy()
    detections = []

    phone_count = 0
    if results and len(results) > 0:
        r = results[0]
        boxes = r.boxes
        h_img, w_img = frame.shape[:2]

        for box in boxes:
            conf = float(box.conf[0].item())
            xyxy = box.xyxy[0].cpu().numpy().astype(int)
            x1, y1, x2, y2 = xyxy
            phone_count += 1

            # Draw box in Red
            cv2.rectangle(annotated, (x1, y1), (x2, y2), (0, 0, 255), 2)
            label_text = f"PHONE ({conf:.0%})"
            cv2.rectangle(annotated, (x1, max(y1 - 20, 0)), (x1 + 120, max(y1, 20)), (0, 0, 255), -1)
            cv2.putText(annotated, label_text, (x1 + 2, max(y1 - 4, 16)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 2)

            detections.append({
                "status": "PHONE_DETECTED",
                "label": "cell_phone",
                "ar_label": "هاتف محمول",
                "confidence": round(conf, 4),
                "box": [int(x1), int(y1), int(x2), int(y2)],
                "normalized_box": [
                    round(x1 / w_img, 4),
                    round(y1 / h_img, 4),
                    round(x2 / w_img, 4),
                    round(y2 / h_img, 4)
                ]
            })

    final_status = "PHONE_DETECTED" if phone_count > 0 else "NO_PHONE_DETECTED"
    banner_color = (0, 0, 255) if final_status == "PHONE_DETECTED" else (0, 200, 0)
    banner_text = f"Status: {final_status} | تم رصد {phone_count} هاتف" if phone_count > 0 else f"Status: {final_status} | لا يوجد هاتف ظاهر"

    cv2.rectangle(annotated, (0, 0), (frame.shape[1], 35), banner_color, -1)
    cv2.putText(annotated, banner_text, (15, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (255, 255, 255), 2)

    return annotated, detections, final_status

def run_prediction(source: str, weights_path: str = None, conf: float = 0.20, output_dir: str = None):
    model = load_inference_model(weights_path)

    if not output_dir:
        output_dir = PROJECT_DIR / "results" / "predictions"
    else:
        output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    # 1. Camera index
    if source.isdigit():
        cap = cv2.VideoCapture(int(source))
        _stream_capture(model, cap, conf, window_name=f"Phone Stream (Camera {source})")
        return

    # 2. Video File or RTSP
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

        logger.info(f"Processing video/RTSP from: {source}")
        frame_idx = 0
        t0 = time.time()
        while True:
            ret, frame = cap.read()
            if not ret:
                break
            annotated, _, _ = process_frame(model, frame, conf)
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
            annotated, _, _ = process_frame(model, frame, conf)
            cv2.imwrite(str(output_dir / f"annotated_{img_p.name}"), annotated)
        logger.info(f"Saved {len(image_files)} annotated images to: {output_dir}")
        return

    # 4. Single Image
    if p.is_file():
        frame = cv2.imread(str(p))
        if frame is None:
            logger.error(f"Cannot read image: {p}")
            return
        annotated, detections, final_status = process_frame(model, frame, conf)
        out_path = output_dir / f"annotated_{p.name}"
        cv2.imwrite(str(out_path), annotated)
        logger.info(f"Saved annotated image to: {out_path}")
        print("\n" + "=" * 55)
        print(f"Mobile Phone Detection Results: [{final_status}]")
        print("=" * 55)
        for i, d in enumerate(detections, 1):
            print(f"[{i}] BBox: {d['box']} | Confidence: {d['confidence']:.1%}")
        if not detections:
            print("Notice: No phone detected in image. (تنبيه: لا يعتبر عدم الاكتشاف دليلاً قاطعاً إذا كانت الصورة غير واضحة)")
        print("=" * 55)
        return

    logger.error(f"Source not recognized: {source}")

def _stream_capture(model, cap, conf, window_name="Stream"):
    logger.info(f"Starting live preview: {window_name} (Press 'q' to stop)")
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        annotated, _, _ = process_frame(model, frame, conf)
        cv2.imshow(window_name, annotated)
        if cv2.waitKey(1) & 0xFF == ord('q'):
            break
    cap.release()
    cv2.destroyAllWindows()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Predict Mobile Phone Detection on Media")
    parser.add_argument("source", help="Path to image, folder, video, camera index (0), or RTSP URL")
    parser.add_argument("--weights", type=str, default=None, help="Path to model weights")
    parser.add_argument("--conf", type=float, default=0.20, help="Confidence threshold")
    parser.add_argument("--output", type=str, default=None, help="Directory to save annotated outputs")
    args = parser.parse_args()

    run_prediction(args.source, weights_path=args.weights, conf=args.conf, output_dir=args.output)
