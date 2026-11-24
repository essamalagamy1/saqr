#!/usr/bin/env python3
"""
Specialized Fine-Tuning Script: Bare Hand & Gloves Detection (Saqr CCTV AI)
Adds kitchen worker bare-hand samples (workers in black t-shirt without gloves),
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
GLOVES_DIR = BASE_DIR / "computer-vision" / "gloves"
DATASET_DIR = GLOVES_DIR / "dataset"
TRAIN_IMG_DIR = DATASET_DIR / "images" / "train"
TRAIN_LBL_DIR = DATASET_DIR / "labels" / "train"
OUTPUT_DIR = GLOVES_DIR / "results" / "gloves_finetune"
MODELS_DIR = BASE_DIR / "apps" / "desktop" / "models"
BASE_WEIGHTS = GLOVES_DIR / "weights" / "best.pt"
HOT_SNAPSHOTS = BASE_DIR / "storage" / "snapshots" / "hot"

# Target kitchen snapshots showing staff in black t-shirts with bare hands
KITCHEN_SAMPLES = [
    {
        "snapshot": "server_4588f685-b328-4760-a2d1-e1e9a3ecf78a_1795486965182.jpg",
        "boxes": [
            # [class_id, x_center, y_center, width, height] normalized (640x360)
            [1, 0.583594, 0.479167, 0.035938, 0.069444], # Left hand at table
            [1, 0.621875, 0.481944, 0.031250, 0.063889], # Right hand at table
            [1, 0.566406, 0.569444, 0.039063, 0.083333]  # Foreground worker left hand
        ]
    },
    {
        "snapshot": "server_4588f685-b328-4760-a2d1-e1e9a3ecf78a_1795485873483.jpg",
        "boxes": [
            [1, 0.523438, 0.666667, 0.046875, 0.111111], # Right hand holding towel
            [1, 0.615625, 0.615278, 0.043750, 0.091667]  # Left hand at side
        ]
    }
]

def prepare_kitchen_training_samples():
    print("[TRAIN-GLOVES] 📸 Adding kitchen staff bare-hand samples to training dataset...")
    added_count = 0

    for sample_idx, item in enumerate(KITCHEN_SAMPLES):
        snap_path = HOT_SNAPSHOTS / item["snapshot"]
        if not snap_path.exists():
            print(f"[TRAIN-GLOVES] Warning: Snapshot {snap_path} not found!")
            continue

        img = cv2.imread(str(snap_path))
        if img is None:
            continue

        boxes = item["boxes"]

        # 1. Base image
        base_name = f"cctv_kitchen_barehand_{sample_idx+1}"
        cv2.imwrite(str(TRAIN_IMG_DIR / f"{base_name}.jpg"), img)
        with open(TRAIN_LBL_DIR / f"{base_name}.txt", "w") as f:
            for b in boxes:
                f.write(f"{b[0]} {b[1]:.6f} {b[2]:.6f} {b[3]:.6f} {b[4]:.6f}\n")
        added_count += 1

        # 2. Horizontal Flip Augmentation
        flip_name = f"cctv_kitchen_barehand_{sample_idx+1}_flip"
        img_flip = cv2.flip(img, 1)
        cv2.imwrite(str(TRAIN_IMG_DIR / f"{flip_name}.jpg"), img_flip)
        with open(TRAIN_LBL_DIR / f"{flip_name}.txt", "w") as f:
            for b in boxes:
                # x_center flipped = 1.0 - x_center
                f.write(f"{b[0]} {(1.0 - b[1]):.6f} {b[2]:.6f} {b[3]:.6f} {b[4]:.6f}\n")
        added_count += 1

        # 3. Random Lighting / Contrast Jitter
        for aug_i in range(8):
            aug_name = f"cctv_kitchen_barehand_{sample_idx+1}_aug{aug_i}"
            alpha = random.uniform(0.85, 1.15) # contrast
            beta = random.uniform(-15, 15)      # brightness
            aug_img = np.clip(alpha * img + beta, 0, 255).astype(np.uint8)
            cv2.imwrite(str(TRAIN_IMG_DIR / f"{aug_name}.jpg"), aug_img)
            with open(TRAIN_LBL_DIR / f"{aug_name}.txt", "w") as f:
                for b in boxes:
                    # slight bbox jitter +/- 1%
                    jx = max(0.01, min(0.99, b[1] + random.uniform(-0.005, 0.005)))
                    jy = max(0.01, min(0.99, b[2] + random.uniform(-0.005, 0.005)))
                    f.write(f"{b[0]} {jx:.6f} {jy:.6f} {b[3]:.6f} {b[4]:.6f}\n")
            added_count += 1

    print(f"[TRAIN-GLOVES] ✅ Added {added_count} kitchen CCTV bare-hand samples to training set.")

def run_fine_tuning(epochs=15, batch=16):
    from ultralytics import YOLO

    prepare_kitchen_training_samples()

    config_yaml = GLOVES_DIR / "configs" / "data.yaml"
    weights_path = BASE_WEIGHTS if BASE_WEIGHTS.exists() else "yolov8n.pt"

    print(f"[TRAIN-GLOVES] 🚀 Starting GPU Fine-Tuning: {weights_path} on NVIDIA Quadro P2000 (CUDA)...")
    print(f"[TRAIN-GLOVES] Config: {config_yaml} | Epochs: {epochs} | Batch: {batch}")

    model = YOLO(str(weights_path))

    results = model.train(
        data=str(config_yaml),
        epochs=epochs,
        batch=batch,
        imgsz=640,
        device="0", # GPU 0
        project=str(OUTPUT_DIR),
        name="gloves_run",
        exist_ok=True,
        save=True,
        val=True,
        amp=True,
        workers=2,
        seed=42,
        plots=False
    )

    best_pt = OUTPUT_DIR / "gloves_run" / "weights" / "best.pt"
    if not best_pt.exists():
        best_pt = OUTPUT_DIR / "gloves_run" / "weights" / "last.pt"

    print(f"[TRAIN-GLOVES] Training complete! Best weights: {best_pt}")

    # Export to ONNX
    print("[TRAIN-GLOVES] 📦 Exporting fine-tuned model to ONNX format (opset 12)...")
    finetuned_model = YOLO(str(best_pt))
    exported_path = finetuned_model.export(format="onnx", imgsz=640, opset=12, simplify=True)
    print(f"[TRAIN-GLOVES] Exported to: {exported_path}")

    # Copy to production locations
    target_onnx = MODELS_DIR / "gloves.onnx"
    target_weights = GLOVES_DIR / "weights" / "best.onnx"

    shutil.copy2(exported_path, target_onnx)
    shutil.copy2(exported_path, target_weights)
    shutil.copy2(best_pt, GLOVES_DIR / "weights" / "best.pt")

    print(f"[TRAIN-GLOVES] 🎉 Successfully updated production gloves model: {target_onnx}")

if __name__ == "__main__":
    run_fine_tuning(epochs=12, batch=16)
