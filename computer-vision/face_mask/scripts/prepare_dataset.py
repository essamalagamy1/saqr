#!/usr/bin/env python3
"""
Data Preparation & VOC-to-YOLO Converter for Face Mask Detection
Downloads/extracts the Kaggle andrewmvd/face-mask-detection dataset,
converts Pascal VOC XML annotations to YOLO format, splits into 70/20/10,
generates data.yaml, and runs DatasetValidator.
"""

import os
import sys
import shutil
import random
import argparse
import xml.etree.ElementTree as ET
from pathlib import Path

# Add shared utilities to Python path
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_DIR = SCRIPT_DIR.parent
ROOT_DIR = PROJECT_DIR.parent
sys.path.insert(0, str(ROOT_DIR / "shared"))

from dataset_validator import DatasetValidator
from utils import save_yaml, setup_logger

logger = setup_logger("FaceMask-Prepare", str(PROJECT_DIR / "results" / "prepare.log"))

CLASS_MAP = {
    "with_mask": 0,
    "without_mask": 1,
    "mask_weared_incorrect": 2
}
CLASS_NAMES = ["with_mask", "without_mask", "mask_weared_incorrect"]

def parse_voc_xml(xml_file: Path, img_w: int = None, img_h: int = None):
    """
    Parses Pascal VOC XML and returns normalized YOLO bounding boxes.
    """
    tree = ET.parse(xml_file)
    root = tree.getroot()

    size_elem = root.find("size")
    if size_elem is not None:
        w_node = size_elem.find("width")
        h_node = size_elem.find("height")
        if w_node is not None and int(w_node.text) > 0:
            img_w = int(w_node.text)
        if h_node is not None and int(h_node.text) > 0:
            img_h = int(h_node.text)

    if not img_w or not img_h:
        raise ValueError(f"Image width or height missing for {xml_file}")

    boxes = []
    for obj in root.findall("object"):
        name_node = obj.find("name")
        if name_node is None:
            continue
        cls_name = name_node.text.strip().lower()
        if cls_name not in CLASS_MAP:
            logger.warning(f"Skipping unknown class '{cls_name}' in {xml_file.name}")
            continue
        cls_id = CLASS_MAP[cls_name]

        bndbox = obj.find("bndbox")
        if bndbox is None:
            continue

        xmin = float(bndbox.find("xmin").text)
        ymin = float(bndbox.find("ymin").text)
        xmax = float(bndbox.find("xmax").text)
        ymax = float(bndbox.find("ymax").text)

        # Clamp coordinates to image boundaries
        xmin = max(0.0, min(xmin, float(img_w)))
        ymin = max(0.0, min(ymin, float(img_h)))
        xmax = max(0.0, min(xmax, float(img_w)))
        ymax = max(0.0, min(ymax, float(img_h)))

        box_w = xmax - xmin
        box_h = ymax - ymin

        if box_w <= 1 or box_h <= 1:
            continue  # Ignore 0-area or degenerate boxes

        x_center = (xmin + xmax) / 2.0 / img_w
        y_center = (ymin + ymax) / 2.0 / img_h
        norm_w = box_w / img_w
        norm_h = box_h / img_h

        # Strict bounds assurance [0.0, 1.0]
        x_center = max(0.0, min(1.0, x_center))
        y_center = max(0.0, min(1.0, y_center))
        norm_w = max(0.001, min(1.0, norm_w))
        norm_h = max(0.001, min(1.0, norm_h))

        boxes.append((cls_id, x_center, y_center, norm_w, norm_h))

    return boxes

def acquire_raw_dataset(raw_dir: Path) -> Path:
    """
    Downloads or locates the raw dataset containing 'images' and 'annotations'.
    """
    if (raw_dir / "images").exists() and (raw_dir / "annotations").exists():
        logger.info(f"Found existing raw dataset in: {raw_dir}")
        return raw_dir

    logger.info("Attempting automated Kaggle dataset download via kagglehub...")
    try:
        import kagglehub
        download_path = kagglehub.dataset_download("andrewmvd/face-mask-detection")
        logger.info(f"KaggleHub downloaded dataset to: {download_path}")
        return Path(download_path)
    except Exception as e:
        logger.warning(f"KaggleHub automated download unavailable: {e}")

    # Check alternative common locations
    candidate_paths = [
        Path.home() / ".cache" / "kagglehub" / "datasets" / "andrewmvd" / "face-mask-detection",
        raw_dir
    ]
    for p in candidate_paths:
        if p.exists() and (p / "images").exists():
            return p

    raise FileNotFoundError(
        f"Raw dataset not found. Please place images/ and annotations/ in '{raw_dir}' "
        "or install kagglehub ('pip install kagglehub')."
    )

def prepare_dataset(raw_dir: Path, target_dir: Path, seed: int = 42):
    """
    Converts VOC annotations to YOLO format and splits 70% Train, 20% Val, 10% Test.
    """
    source_dir = acquire_raw_dataset(raw_dir)
    images_src = source_dir / "images"
    annotations_src = source_dir / "annotations"

    xml_files = sorted(list(annotations_src.glob("*.xml")))
    if not xml_files:
        raise FileNotFoundError(f"No XML files found in {annotations_src}")

    logger.info(f"Discovered {len(xml_files)} XML annotations in {annotations_src}")

    # Set up destination split directories
    for split in ["train", "val", "test"]:
        (target_dir / "images" / split).mkdir(parents=True, exist_ok=True)
        (target_dir / "labels" / split).mkdir(parents=True, exist_ok=True)

    # Deterministic split: 70% Train, 20% Val, 10% Test
    random.seed(seed)
    shuffled_xmls = xml_files.copy()
    random.shuffle(shuffled_xmls)

    n_total = len(shuffled_xmls)
    n_train = int(n_total * 0.70)
    n_val = int(n_total * 0.20)

    train_xmls = shuffled_xmls[:n_train]
    val_xmls = shuffled_xmls[n_train:n_train + n_val]
    test_xmls = shuffled_xmls[n_train + n_val:]

    splits = [("train", train_xmls), ("val", val_xmls), ("test", test_xmls)]

    total_converted = 0
    total_boxes = 0

    import cv2

    for split_name, xml_list in splits:
        logger.info(f"Processing split '{split_name}': {len(xml_list)} samples...")
        for xml_p in xml_list:
            stem = xml_p.stem
            # Find corresponding image
            candidates = list(images_src.glob(f"{stem}.*"))
            if not candidates:
                logger.warning(f"No matching image found for annotation: {xml_p.name}")
                continue
            img_p = candidates[0]

            # Read image dimensions
            img = cv2.imread(str(img_p))
            if img is None:
                logger.warning(f"Corrupt or unreadable image: {img_p}")
                continue
            h, w = img.shape[:2]

            try:
                boxes = parse_voc_xml(xml_p, img_w=w, img_h=h)
            except Exception as parse_err:
                logger.error(f"Error parsing {xml_p}: {parse_err}")
                continue

            # Copy image
            dest_img = target_dir / "images" / split_name / img_p.name
            shutil.copy2(img_p, dest_img)

            # Write YOLO label
            dest_lbl = target_dir / "labels" / split_name / f"{stem}.txt"
            with open(dest_lbl, "w", encoding="utf-8") as lf:
                for b in boxes:
                    lf.write(f"{b[0]} {b[1]:.6f} {b[2]:.6f} {b[3]:.6f} {b[4]:.6f}\n")

            total_converted += 1
            total_boxes += len(boxes)

    logger.info(f"Successfully converted {total_converted} images with {total_boxes} total bounding boxes.")

    # Generate data.yaml
    data_yaml_path = PROJECT_DIR / "configs" / "data.yaml"
    yaml_config = {
        "path": target_dir.as_posix(),
        "train": "images/train",
        "val": "images/val",
        "test": "images/test",
        "names": {i: name for i, name in enumerate(CLASS_NAMES)}
    }
    save_yaml(yaml_config, str(data_yaml_path))
    logger.info(f"Generated dataset YAML configuration at: {data_yaml_path}")

    # Run DatasetValidator Quality Audit
    validator = DatasetValidator(str(target_dir), CLASS_NAMES)
    for split_name in ["train", "val", "test"]:
        report = validator.validate_split(split_name)
        validator.print_report(report)
        validator.render_sample_visualizations(split_name, num_samples=6)

    logger.info("Dataset preparation and verification completed successfully!")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Prepare Face Mask YOLO Dataset")
    parser.add_argument("--raw-dir", type=str, default=str(PROJECT_DIR / "dataset" / "raw"), help="Path to raw VOC dataset")
    parser.add_argument("--target-dir", type=str, default=str(PROJECT_DIR / "dataset"), help="Destination YOLO dataset directory")
    parser.add_argument("--seed", type=int, default=42, help="Random seed for splitting")
    args = parser.parse_args()

    prepare_dataset(Path(args.raw_dir), Path(args.target_dir), seed=args.seed)
