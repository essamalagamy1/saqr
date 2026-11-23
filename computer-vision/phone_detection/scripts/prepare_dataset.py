#!/usr/bin/env python3
"""
Data Preparation & Integrity Validator for Mobile Phone Detection
Validates 'cell_phone' class annotations and splits data 70% Train, 20% Val, 10% Test.
"""

import os
import sys
import shutil
import random
import argparse
from pathlib import Path

# Add shared utilities to Python path
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_DIR = SCRIPT_DIR.parent
ROOT_DIR = PROJECT_DIR.parent
sys.path.insert(0, str(ROOT_DIR / "shared"))

from dataset_validator import DatasetValidator
from utils import save_yaml, setup_logger

logger = setup_logger("Phone-Prepare", str(PROJECT_DIR / "results" / "prepare.log"))

CLASS_NAMES = ["cell_phone"]

def prepare_dataset(raw_dir: Path, target_dir: Path, seed: int = 42):
    images_src = raw_dir / "images"
    labels_src = raw_dir / "labels"

    if not images_src.exists():
        if (raw_dir / "train" / "images").exists():
            images_src = raw_dir
            labels_src = raw_dir

    if not images_src.exists():
        logger.warning(f"Raw source images directory not found at: {images_src}")
        logger.info(f"Please place your phone detection dataset in: {raw_dir}")
        return False

    image_files = sorted(list(images_src.rglob("*.jpg")) + list(images_src.rglob("*.png")) + list(images_src.rglob("*.jpeg")))
    if not image_files:
        logger.error(f"No images found in {images_src}")
        return False

    logger.info(f"Discovered {len(image_files)} images in raw phone dataset.")

    for split in ["train", "val", "test"]:
        (target_dir / "images" / split).mkdir(parents=True, exist_ok=True)
        (target_dir / "labels" / split).mkdir(parents=True, exist_ok=True)

    random.seed(seed)
    shuffled = image_files.copy()
    random.shuffle(shuffled)

    n_total = len(shuffled)
    n_train = int(n_total * 0.70)
    n_val = int(n_total * 0.20)

    train_imgs = shuffled[:n_train]
    val_imgs = shuffled[n_train:n_train + n_val]
    test_imgs = shuffled[n_train + n_val:]

    splits = [("train", train_imgs), ("val", val_imgs), ("test", test_imgs)]
    total_copied = 0

    for split_name, img_list in splits:
        logger.info(f"Organizing split '{split_name}': {len(img_list)} images...")
        for img_p in img_list:
            lbl_candidates = [
                img_p.parent.parent / "labels" / f"{img_p.stem}.txt",
                labels_src / f"{img_p.stem}.txt",
                img_p.parent / f"{img_p.stem}.txt"
            ]
            lbl_p = next((p for p in lbl_candidates if p.exists()), None)
            if not lbl_p:
                continue

            dest_img = target_dir / "images" / split_name / img_p.name
            shutil.copy2(img_p, dest_img)

            dest_lbl = target_dir / "labels" / split_name / f"{img_p.stem}.txt"
            with open(lbl_p, "r", encoding="utf-8") as rf, open(dest_lbl, "w", encoding="utf-8") as wf:
                for line in rf:
                    parts = line.strip().split()
                    if len(parts) == 5:
                        # Ensure class ID is 0
                        wf.write(f"0 {parts[1]} {parts[2]} {parts[3]} {parts[4]}\n")

            total_copied += 1

    logger.info(f"Successfully prepared {total_copied} samples across train/val/test splits.")

    data_yaml_path = PROJECT_DIR / "configs" / "data.yaml"
    yaml_config = {
        "path": target_dir.as_posix(),
        "train": "images/train",
        "val": "images/val",
        "test": "images/test",
        "names": {0: "cell_phone"}
    }
    save_yaml(yaml_config, str(data_yaml_path))
    logger.info(f"Generated dataset YAML configuration at: {data_yaml_path}")

    validator = DatasetValidator(str(target_dir), CLASS_NAMES)
    for split_name in ["train", "val", "test"]:
        report = validator.validate_split(split_name)
        validator.print_report(report)

    return True

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Prepare Phone Detection YOLO Dataset")
    parser.add_argument("--raw-dir", type=str, default=str(PROJECT_DIR / "dataset" / "raw"), help="Path to raw dataset")
    parser.add_argument("--target-dir", type=str, default=str(PROJECT_DIR / "dataset"), help="Destination directory")
    parser.add_argument("--seed", type=int, default=42, help="Random seed")
    args = parser.parse_args()

    prepare_dataset(Path(args.raw_dir), Path(args.target_dir), seed=args.seed)
