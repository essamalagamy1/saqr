#!/usr/bin/env python3
"""
Dataset Quality Control & Integrity Validator for Saqr YOLO Datasets
Validates annotations, coordinates, image integrity, duplicate detection, and class distributions.
"""

import os
import sys
import hashlib
import random
from pathlib import Path
from typing import Dict, List, Tuple
import cv2
import numpy as np

class DatasetValidator:
    def __init__(self, dataset_dir: str, class_names: List[str]):
        self.dataset_dir = Path(dataset_dir)
        self.class_names = class_names
        self.num_classes = len(class_names)

    def _hash_file(self, filepath: Path) -> str:
        """Calculates MD5 hash for duplicate detection."""
        hasher = hashlib.md5()
        with open(filepath, 'rb') as f:
            for chunk in iter(lambda: f.read(65536), b""):
                hasher.update(chunk)
        return hasher.hexdigest()

    def validate_split(self, split_name: str) -> Dict:
        """
        Validates a specific split (e.g. 'train', 'val', or 'test').
        """
        img_dir = self.dataset_dir / "images" / split_name
        lbl_dir = self.dataset_dir / "labels" / split_name

        report = {
            "split": split_name,
            "total_images": 0,
            "total_labels": 0,
            "corrupt_images": [],
            "duplicate_images": [],
            "missing_labels": [],
            "unmatched_labels": [],
            "invalid_boxes": [],
            "unknown_classes": [],
            "class_box_counts": {c: 0 for c in self.class_names},
            "class_image_counts": {c: 0 for c in self.class_names},
            "is_valid": True
        }

        if not img_dir.exists():
            report["is_valid"] = False
            report["error"] = f"Directory not found: {img_dir}"
            return report

        image_files = sorted(list(img_dir.glob("*.jpg")) + list(img_dir.glob("*.png")) + list(img_dir.glob("*.jpeg")))
        report["total_images"] = len(image_files)

        label_files = set(lbl_dir.glob("*.txt")) if lbl_dir.exists() else set()
        report["total_labels"] = len(label_files)

        hashes = {}
        for img_path in image_files:
            # 1. Check duplicate
            h = self._hash_file(img_path)
            if h in hashes:
                report["duplicate_images"].append((str(img_path), str(hashes[h])))
            else:
                hashes[h] = img_path

            # 2. Check corrupt image
            img = cv2.imread(str(img_path))
            if img is None:
                report["corrupt_images"].append(str(img_path))
                continue

            h_px, w_px = img.shape[:2]
            if h_px < 10 or w_px < 10:
                report["corrupt_images"].append(f"{img_path} (too small: {w_px}x{h_px})")
                continue

            # 3. Check corresponding label file
            lbl_path = lbl_dir / f"{img_path.stem}.txt"
            if not lbl_path.exists():
                report["missing_labels"].append(str(img_path))
                continue

            # 4. Check label annotations
            classes_in_image = set()
            with open(lbl_path, 'r', encoding='utf-8') as f:
                for line_num, line in enumerate(f, 1):
                    line = line.strip()
                    if not line:
                        continue
                    parts = line.split()
                    if len(parts) != 5:
                        report["invalid_boxes"].append(f"{lbl_path}:{line_num} (expected 5 tokens, got {len(parts)})")
                        continue

                    try:
                        cls_id = int(parts[0])
                        x_c, y_c, w, h = map(float, parts[1:])
                    except ValueError:
                        report["invalid_boxes"].append(f"{lbl_path}:{line_num} (non-numeric token)")
                        continue

                    # Validate Class ID
                    if cls_id < 0 or cls_id >= self.num_classes:
                        report["unknown_classes"].append(f"{lbl_path}:{line_num} (class {cls_id} not in [0..{self.num_classes-1}])")
                        continue

                    # Validate Coordinates (normalized 0..1)
                    if not (0.0 <= x_c <= 1.0 and 0.0 <= y_c <= 1.0 and 0.0 < w <= 1.0 and 0.0 < h <= 1.0):
                        report["invalid_boxes"].append(f"{lbl_path}:{line_num} (coordinates out of bounds: [{x_c}, {y_c}, {w}, {h}])")
                        continue

                    x1 = x_c - w / 2.0
                    y1 = y_c - h / 2.0
                    x2 = x_c + w / 2.0
                    y2 = y_c + h / 2.0

                    if x1 < -0.05 or y1 < -0.05 or x2 > 1.05 or y2 > 1.05:
                        report["invalid_boxes"].append(f"{lbl_path}:{line_num} (box significantly exceeds boundaries)")
                        continue

                    cls_name = self.class_names[cls_id]
                    report["class_box_counts"][cls_name] += 1
                    classes_in_image.add(cls_name)

            for c in classes_in_image:
                report["class_image_counts"][c] += 1

        # Check for unreferenced labels
        image_stems = {p.stem for p in image_files}
        for lbl_path in label_files:
            if lbl_path.stem not in image_stems:
                report["unmatched_labels"].append(str(lbl_path))

        report["is_valid"] = (
            len(report["corrupt_images"]) == 0 and
            len(report["invalid_boxes"]) == 0 and
            len(report["unknown_classes"]) == 0
        )

        return report

    def render_sample_visualizations(self, split_name: str, num_samples: int = 6, output_dir: str = None) -> List[str]:
        """
        Renders bounding boxes on random samples and saves them to visual inspection dir.
        """
        img_dir = self.dataset_dir / "images" / split_name
        lbl_dir = self.dataset_dir / "labels" / split_name
        if not output_dir:
            output_dir = self.dataset_dir / "visual_samples" / split_name
        else:
            output_dir = Path(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)

        images = list(img_dir.glob("*.jpg")) + list(img_dir.glob("*.png"))
        if not images:
            return []

        sampled = random.sample(images, min(num_samples, len(images)))
        colors = [(0, 255, 0), (0, 0, 255), (0, 255, 255), (255, 0, 0), (255, 0, 255), (255, 255, 0)]
        saved_paths = []

        for img_path in sampled:
            img = cv2.imread(str(img_path))
            if img is None:
                continue
            h_px, w_px = img.shape[:2]
            lbl_path = lbl_dir / f"{img_path.stem}.txt"

            if lbl_path.exists():
                with open(lbl_path, 'r') as f:
                    for line in f:
                        parts = line.strip().split()
                        if len(parts) != 5:
                            continue
                        cls_id = int(parts[0])
                        x_c, y_c, w, h = map(float, parts[1:])
                        x1 = int((x_c - w / 2) * w_px)
                        y1 = int((y_c - h / 2) * h_px)
                        x2 = int((x_c + w / 2) * w_px)
                        y2 = int((y_c + h / 2) * h_px)

                        color = colors[cls_id % len(colors)]
                        label_name = self.class_names[cls_id] if cls_id < len(self.class_names) else str(cls_id)
                        cv2.rectangle(img, (x1, y1), (x2, y2), color, 2)
                        cv2.putText(img, label_name, (x1, max(y1 - 6, 15)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)

            out_path = output_dir / f"visualized_{img_path.name}"
            cv2.imwrite(str(out_path), img)
            saved_paths.append(str(out_path))

        return saved_paths

    def print_report(self, report: Dict):
        print("=" * 65)
        print(f"📊 Dataset Quality Audit Report: Split [{report['split']}]")
        print("=" * 65)
        print(f"Total Images:         {report['total_images']}")
        print(f"Total Labels:         {report['total_labels']}")
        print(f"Corrupt Images:       {len(report['corrupt_images'])}")
        print(f"Duplicate Images:     {len(report['duplicate_images'])}")
        print(f"Missing Labels:       {len(report['missing_labels'])}")
        print(f"Unmatched Labels:     {len(report['unmatched_labels'])}")
        print(f"Invalid Bounding Boxes: {len(report['invalid_boxes'])}")
        print(f"Unknown Classes:      {len(report['unknown_classes'])}")
        print("-" * 65)
        print("Class Distribution (Objects / Bounding Boxes):")
        for cls_name, count in report['class_box_counts'].items():
            print(f"  - {cls_name:24s}: {count} objects")
        print("-" * 65)
        print("Class Distribution (Images containing class):")
        for cls_name, count in report['class_image_counts'].items():
            print(f"  - {cls_name:24s}: {count} images")
        print("=" * 65)
        status = "PASSED ✅" if report['is_valid'] else "FAILED ❌"
        print(f"Overall Validation Result: {status}")
        print("=" * 65)

