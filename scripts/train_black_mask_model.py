#!/usr/bin/env python3
"""
Specialized Fine-Tuning Script: Black Face Mask & Black Headwear (Saqr CCTV AI)
Augments the face mask training set with dark/black mask samples,
fine-tunes YOLO on NVIDIA Quadro P2000 (CUDA), and exports optimized ONNX weights.
"""

import os
import sys
import cv2
import shutil
import random
import numpy as np
from pathlib import Path

BASE_DIR = Path("/mnt/essam/sites/saqr")
DATASET_DIR = BASE_DIR / "computer-vision" / "face_mask" / "dataset"
TRAIN_IMG_DIR = DATASET_DIR / "images" / "train"
TRAIN_LBL_DIR = DATASET_DIR / "labels" / "train"
OUTPUT_DIR = BASE_DIR / "computer-vision" / "face_mask" / "results" / "black_mask_finetune"
MODELS_DIR = BASE_DIR / "apps" / "desktop" / "models"
BASE_WEIGHTS = BASE_DIR / "computer-vision" / "face_mask" / "weights" / "best.pt"

def apply_black_mask_augmentation():
    """
    Scans training images and for 'with_mask' annotations (class 0),
    synthetically transforms light/surgical masks into dark/black cloth masks.
    """
    print("[TRAIN-BLACK-MASK] 🎨 Applying Black Mask color transfer & augmentation...")
    augmented_count = 0
    label_files = list(TRAIN_LBL_DIR.glob("*.txt"))

    for lbl_file in label_files:
        # Skip previously generated augmented files
        if "_blackmask" in lbl_file.name:
            continue

        img_file = TRAIN_IMG_DIR / f"{lbl_file.stem}.png"
        if not img_file.exists():
            img_file = TRAIN_IMG_DIR / f"{lbl_file.stem}.jpg"
        if not img_file.exists():
            continue

        with open(lbl_file, "r") as f:
            lines = [l.strip() for l in f if l.strip()]

        has_mask = any(l.startswith("0 ") for l in lines)
        if not has_mask:
            continue

        # Load image
        img = cv2.imread(str(img_file))
        if img is None:
            continue

        h, w = img.shape[:2]
        aug_img = img.copy()

        # Darken the mask regions (Class 0) to simulate black face masks
        for line in lines:
            parts = line.split()
            cls_id = int(parts[0])
            if cls_id == 0: # with_mask
                cx = float(parts[1]) * w
                cy = float(parts[2]) * h
                bw = float(parts[3]) * w
                bh = float(parts[4]) * h

                x1 = max(0, int(cx - bw / 2))
                y1 = max(0, int(cy - bh / 2))
                x2 = min(w, int(cx + bw / 2))
                y2 = min(h, int(cy + bh / 2))

                if x2 > x1 and y2 > y1:
                    mask_crop = aug_img[y1:y2, x1:x2]
                    # Convert to HSV, crush Value (brightness) and Saturation to create realistic dark fabric
                    hsv = cv2.cvtColor(mask_crop, cv2.COLOR_BGR2HSV).astype(np.float32)
                    hsv[:, :, 2] = hsv[:, :, 2] * random.uniform(0.18, 0.32) # Very dark black/charcoal
                    hsv[:, :, 1] = hsv[:, :, 1] * 0.40 # Low saturation
                    darkened = cv2.cvtColor(np.clip(hsv, 0, 255).astype(np.uint8), cv2.COLOR_HSV2BGR)
                    
                    # Blend with slight blur for natural fabric transition
                    aug_img[y1:y2, x1:x2] = cv2.addWeighted(darkened, 0.85, mask_crop, 0.15, 0)

        # Save augmented pair
        aug_stem = f"{lbl_file.stem}_blackmask"
        aug_img_path = TRAIN_IMG_DIR / f"{aug_stem}.jpg"
        aug_lbl_path = TRAIN_LBL_DIR / f"{aug_stem}.txt"

        cv2.imwrite(str(aug_img_path), aug_img)
        shutil.copy2(lbl_file, aug_lbl_path)
        augmented_count += 1
        if augmented_count >= 150:
            break

    print(f"[TRAIN-BLACK-MASK] ✅ Generated {augmented_count} Black Mask training samples.")

def run_fine_tuning(epochs=12, batch=16):
    from ultralytics import YOLO

    apply_black_mask_augmentation()

    config_yaml = BASE_DIR / "computer-vision" / "face_mask" / "configs" / "data.yaml"
    weights_path = BASE_WEIGHTS if BASE_WEIGHTS.exists() else "yolov8n.pt"

    print(f"[TRAIN-BLACK-MASK] 🚀 Starting GPU Fine-Tuning: {weights_path} on NVIDIA Quadro P2000 (CUDA)...")
    print(f"[TRAIN-BLACK-MASK] Config: {config_yaml} | Epochs: {epochs} | Batch: {batch}")

    model = YOLO(str(weights_path))

    results = model.train(
        data=str(config_yaml),
        epochs=epochs,
        batch=batch,
        imgsz=640,
        device="0", # GPU 0 (Quadro P2000)
        project=str(OUTPUT_DIR),
        name="black_mask_run",
        exist_ok=True,
        save=True,
        val=True,
        amp=True,
        workers=2,
        seed=42,
        plots=False
    )

    best_pt = OUTPUT_DIR / "black_mask_run" / "weights" / "best.pt"
    if not best_pt.exists():
        best_pt = OUTPUT_DIR / "black_mask_run" / "weights" / "last.pt"

    print(f"[TRAIN-BLACK-MASK] Training complete! Best weights: {best_pt}")

    # Export to ONNX
    print("[TRAIN-BLACK-MASK] 📦 Exporting fine-tuned model to ONNX format (opset 12)...")
    finetuned_model = YOLO(str(best_pt))
    exported_path = finetuned_model.export(format="onnx", imgsz=640, opset=12, simplify=True)
    print(f"[TRAIN-BLACK-MASK] Exported to: {exported_path}")

    # Copy ONNX to apps/desktop/models and computer-vision/face_mask/weights/
    target_onnx = MODELS_DIR / "face_mask.onnx"
    target_weights = BASE_DIR / "computer-vision" / "face_mask" / "weights" / "best.onnx"

    shutil.copy2(exported_path, target_onnx)
    shutil.copy2(exported_path, target_weights)
    shutil.copy2(best_pt, BASE_DIR / "computer-vision" / "face_mask" / "weights" / "best.pt")

    print(f"[TRAIN-BLACK-MASK] 🎉 Successfully updated production model: {target_onnx}")

if __name__ == "__main__":
    run_fine_tuning(epochs=10, batch=16)
