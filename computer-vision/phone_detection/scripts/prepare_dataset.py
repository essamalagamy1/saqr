#!/usr/bin/env python3
"""
Data Preparation & Integrity Validator for Mobile Phone Detection
Parses VOC XML / YOLO annotations, extracts 'cell_phone' (class 0),
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

logger = setup_logger("Phone-Prepare", str(PROJECT_DIR / "results" / "prepare.log"))

CLASS_NAMES = ["cell_phone"]
PHONE_ALIASES = {"phone", "cell_phone", "mobile_phone", "smartphone", "cellphone", "mobile"}

def parse_voc_xml(xml_file: Path, img_w: int = None, img_h: int = None):
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
        if not any(alias in cls_name for alias in PHONE_ALIASES):
            continue

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

        boxes.append((0, x_center, y_center, norm_w, norm_h))

    return boxes

def collect_source_pairs():
    pairs = []
    cache_base = Path.home() / ".cache" / "kagglehub" / "datasets" / "dataclusterlabs" / "mobile-phone-image-dataset"

    # Search for candidate dataset dirs
    candidate_dirs = list(cache_base.glob("versions/*")) if cache_base.exists() else []
    candidate_dirs.append(PROJECT_DIR / "dataset" / "raw")

    for cdir in candidate_dirs:
        if not cdir.exists():
            continue
        for img_p in sorted(list(cdir.rglob("*.jpg")) + list(cdir.rglob("*.png"))):
            xml_p = img_p.with_suffix(".xml")
            if not xml_p.exists():
                xml_cand = cdir / "Annotations" / "Annotations" / f"{img_p.stem}.xml"
                if xml_cand.exists():
                    xml_p = xml_cand
                else:
                    xml_cand2 = cdir / "Annotations" / f"{img_p.stem}.xml"
                    if xml_cand2.exists():
                        xml_p = xml_cand2

            if xml_p.exists():
                pairs.append((img_p, "xml", xml_p))
            else:
                txt_p = img_p.with_suffix(".txt")
                if txt_p.exists():
                    pairs.append((img_p, "txt", txt_p))
    return pairs

def prepare_dataset(target_dir: Path, seed: int = 42):
    all_pairs = collect_source_pairs()
    if not all_pairs:
        logger.error("No image/annotation pairs found for phone dataset.")
        return False

    logger.info(f"Discovered {len(all_pairs)} image/annotation pairs for phone detection.")

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
                            boxes.append((0, float(parts[1]), float(parts[2]), float(parts[3]), float(parts[4])))

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
        "names": {0: "cell_phone"}
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
    parser = argparse.ArgumentParser(description="Prepare Phone Detection Dataset")
    parser.add_argument("--target", type=str, default=str(PROJECT_DIR / "dataset"), help="Target directory")
    parser.add_argument("--seed", type=int, default=42, help="Random split seed")
    args = parser.parse_args()

    prepare_dataset(Path(args.target), seed=args.seed)
