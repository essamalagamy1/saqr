#!/usr/bin/env python3
"""
Data Preparation & Integrity Validator for Gloves & Bare Hand Detection
Parses VOC XML / YOLO annotations, balances 'gloves' (class 0) and 'bare_hand' (class 1),
splits data deterministically (70% Train, 20% Val, 10% Test), and runs DatasetValidator.
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

logger = setup_logger("Gloves-Prepare", str(PROJECT_DIR / "results" / "prepare.log"))

CLASS_NAMES = ["gloves", "bare_hand"]
CLASS_MAP = {
    "gloves": 0,
    "glove": 0,
    "gloved_hand": 0,
    "glove_hand": 0,
    "latex_glove": 0,
    "nitrile_glove": 0,
    "bare_hand": 1,
    "barehand": 1,
    "human_palm": 1,
    "palm": 1,
    "hand": 1,
    "no_gloves": 1
}

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
        raise ValueError(f"Image dimensions missing for {xml_file}")

    boxes = []
    for obj in root.findall("object"):
        name_node = obj.find("name")
        if name_node is None:
            continue
        cls_name = name_node.text.strip().lower()
        if cls_name not in CLASS_MAP:
            continue
        cls_id = CLASS_MAP[cls_name]

        bndbox = obj.find("bndbox")
        if bndbox is None:
            continue

        xmin = float(bndbox.find("xmin").text)
        ymin = float(bndbox.find("ymin").text)
        xmax = float(bndbox.find("xmax").text)
        ymax = float(bndbox.find("ymax").text)

        xmin = max(0.0, min(xmin, float(img_w)))
        ymin = max(0.0, min(ymin, float(img_h)))
        xmax = max(0.0, min(xmax, float(img_w)))
        ymax = max(0.0, min(ymax, float(img_h)))

        box_w = xmax - xmin
        box_h = ymax - ymin
        if box_w <= 1 or box_h <= 1:
            continue

        x_center = max(0.0, min(1.0, (xmin + xmax) / 2.0 / img_w))
        y_center = max(0.0, min(1.0, (ymin + ymax) / 2.0 / img_h))
        norm_w = max(0.001, min(1.0, box_w / img_w))
        norm_h = max(0.001, min(1.0, box_h / img_h))

        boxes.append((cls_id, x_center, y_center, norm_w, norm_h))

    return boxes

def collect_source_pairs(source_dirs):
    """Collect all valid image and label/xml pairs from candidate directories."""
    pairs = []
    for sdir in source_dirs:
        p = Path(sdir)
        if not p.exists():
            continue
        for img_p in sorted(list(p.rglob("*.jpg")) + list(p.rglob("*.png")) + list(p.rglob("*.jpeg"))):
            xml_p = img_p.with_suffix(".xml")
            txt_p = img_p.with_suffix(".txt")
            if xml_p.exists():
                pairs.append((img_p, "xml", xml_p))
            elif txt_p.exists():
                pairs.append((img_p, "txt", txt_p))
    return pairs

def prepare_dataset(target_dir: Path, seed: int = 42):
    """
    Validates, standardizes, and splits gloves & bare hand dataset into 70/20/10.
    """
    cache_base = Path.home() / ".cache" / "kagglehub" / "datasets"
    candidate_sources = [
        cache_base / "dataclusterlabs" / "palm-and-gloves-dataset" / "versions" / "4",
        cache_base / "dataclusterlabs" / "gloves-dataset-covid-safety-wear" / "versions" / "2",
        PROJECT_DIR / "dataset" / "raw"
    ]

    all_pairs = collect_source_pairs(candidate_sources)
    if not all_pairs:
        logger.error(f"No image/annotation pairs found in sources: {candidate_sources}")
        return False

    logger.info(f"Discovered {len(all_pairs)} image/annotation pairs across gloves/hands sources.")

    # Target directory setup
    for split in ["train", "val", "test"]:
        (target_dir / "images" / split).mkdir(parents=True, exist_ok=True)
        (target_dir / "labels" / split).mkdir(parents=True, exist_ok=True)

    random.seed(seed)
    shuffled = all_pairs.copy()
    random.shuffle(shuffled)

    n_total = len(shuffled)
    n_train = int(n_total * 0.70)
    n_val = int(n_total * 0.20)

    train_pairs = shuffled[:n_train]
    val_pairs = shuffled[n_train:n_train + n_val]
    test_pairs = shuffled[n_train + n_val:]

    splits = [("train", train_pairs), ("val", val_pairs), ("test", test_pairs)]
    total_processed = 0

    from PIL import Image

    for split_name, pair_list in splits:
        logger.info(f"Processing split '{split_name}': {len(pair_list)} samples...")
        for img_p, annot_type, annot_p in pair_list:
            try:
                with Image.open(img_p) as im:
                    w, h = im.size
            except Exception as e:
                logger.warning(f"Corrupt image {img_p}: {e}")
                continue

            boxes = []
            if annot_type == "xml":
                try:
                    boxes = parse_voc_xml(annot_p, w, h)
                except Exception as e:
                    logger.warning(f"Failed to parse XML {annot_p}: {e}")
                    continue
            elif annot_type == "txt":
                with open(annot_p, "r", encoding="utf-8") as f:
                    for line in f:
                        parts = line.strip().split()
                        if len(parts) == 5:
                            cls_id = int(parts[0])
                            mapped_cls = 0 if cls_id == 0 else 1
                            boxes.append((mapped_cls, float(parts[1]), float(parts[2]), float(parts[3]), float(parts[4])))

            if not boxes:
                continue

            dest_img = target_dir / "images" / split_name / img_p.name
            dest_lbl = target_dir / "labels" / split_name / f"{img_p.stem}.txt"

            shutil.copy2(img_p, dest_img)
            with open(dest_lbl, "w", encoding="utf-8") as wf:
                for b in boxes:
                    wf.write(f"{b[0]} {b[1]:.6f} {b[2]:.6f} {b[3]:.6f} {b[4]:.6f}\n")

            total_processed += 1

    logger.info(f"Successfully prepared {total_processed} samples across train/val/test splits.")

    # Generate data.yaml
    data_yaml_path = PROJECT_DIR / "configs" / "data.yaml"
    yaml_config = {
        "path": target_dir.as_posix(),
        "train": "images/train",
        "val": "images/val",
        "test": "images/test",
        "names": {0: "gloves", 1: "bare_hand"}
    }
    save_yaml(yaml_config, str(data_yaml_path))
    logger.info(f"Generated dataset YAML configuration at: {data_yaml_path}")

    # Run DatasetValidator
    validator = DatasetValidator(str(target_dir), CLASS_NAMES)
    for split_name in ["train", "val", "test"]:
        report = validator.validate_split(split_name)
        validator.print_report(report)
        validator.render_sample_visualizations(split_name, num_samples=6)

    return True

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Prepare Gloves and Bare Hand Dataset")
    parser.add_argument("--target", type=str, default=str(PROJECT_DIR / "dataset"), help="Target directory")
    parser.add_argument("--seed", type=int, default=42, help="Random split seed")
    args = parser.parse_args()

    prepare_dataset(Path(args.target), seed=args.seed)
