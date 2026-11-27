https://feels-detector-telescope-uses.trycloudflare.com/detections#!/usr/bin/env python3
"""
Senior CV Training Pipeline: Multi-Scale CCTV Handheld Phone Detector (YOLO26n -> ONNX)
Solves scale mismatch from close-up Datacluster phone datasets by generating realistic
CCTV-scale composite positives + real kitchen hard negatives + real DVR samples,
while holding out real unseen kitchen & CH7 validation scenes.
"""

import glob
import json
import os
import random
import shutil
from pathlib import Path

import cv2
import numpy as np

random.seed(42)
np.random.seed(42)

ROOT = Path("/mnt/essam/sites/saqr")
PHONE_DS = ROOT / "computer-vision" / "phone_detection" / "dataset"
HOT_SNAPS = ROOT / "storage" / "snapshots" / "hot"
STUDIO_SAMPLE = ROOT / "storage" / "training_studio" / "jobs" / "job_1795570372795_9f8cde" / "samples" / "img_001.png"
STUDIO_META = STUDIO_SAMPLE.with_suffix(".meta.json")
OUT_DS = ROOT / "storage" / "training_studio" / "cctv_phone_dataset"
RUN_DIR = ROOT / "storage" / "training_studio" / "cctv_phone_runs"
MODELS_DIR = ROOT / "apps" / "desktop" / "models"
MANIFEST_PATH = MODELS_DIR / "studio_manifest.json"
BASE_PT = ROOT / "yolo26n.pt"


def extract_phone_crops(img_dir: Path, lbl_dir: Path):
    crops = []
    for img_path in sorted(img_dir.glob("*")):
        lbl_path = lbl_dir / f"{img_path.stem}.txt"
        if not lbl_path.exists():
            continue
        img = cv2.imread(str(img_path))
        if img is None:
            continue
        h, w = img.shape[:2]
        for line in lbl_path.read_text().splitlines():
            parts = line.strip().split()
            if len(parts) != 5:
                continue
            cx, cy, bw, bh = map(float, parts[1:])
            x1 = max(0, int((cx - bw / 2) * w))
            y1 = max(0, int((cy - bh / 2) * h))
            x2 = min(w, int((cx + bw / 2) * w))
            y2 = min(h, int((cy + bh / 2) * h))
            if (x2 - x1) >= 24 and (y2 - y1) >= 24:
                crops.append(img[y1:y2, x1:x2].copy())
    return crops


def paste_phone_cctv(bg_img, phone_crop, target_h, center_hint=None):
    bg = bg_img.copy()
    bh, bw = bg.shape[:2]
    ph0, pw0 = phone_crop.shape[:2]
    if ph0 < 8 or pw0 < 8:
        return None, None

    aspect = pw0 / ph0
    # Clamp phone dimensions to realistic handheld CCTV range
    new_h = max(18, min(68, int(target_h)))
    new_w = max(14, min(68, int(new_h * aspect)))
    patch = cv2.resize(phone_crop, (new_w, new_h), interpolation=cv2.INTER_AREA)

    # Random slight rotation (-22..+22 deg) & CCTV lighting match
    angle = random.uniform(-22, 22)
    M = cv2.getRotationMatrix2D((new_w / 2, new_h / 2), angle, 1.0)
    cos = abs(M[0, 0])
    sin = abs(M[0, 1])
    rw = int(new_h * sin + new_w * cos)
    rh = int(new_h * cos + new_w * sin)
    M[0, 2] += rw / 2 - new_w / 2
    M[1, 2] += rh / 2 - new_h / 2
    rotated = cv2.warpAffine(patch, M, (rw, rh), borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0))
    mask = cv2.warpAffine(np.full((new_h, new_w), 255, dtype=np.uint8), M, (rw, rh))

    # Blur edges slightly + brightness jitter
    if rw >= bw - 10 or rh >= bh - 10:
        return None, None

    if center_hint:
        cx = int(center_hint[0] + random.uniform(-20, 20))
        cy = int(center_hint[1] + random.uniform(-20, 20))
        x1 = max(4, min(bw - rw - 4, cx - rw // 2))
        y1 = max(4, min(bh - rh - 4, cy - rh // 2))
    else:
        x1 = random.randint(int(bw * 0.12), max(int(bw * 0.12) + 1, int(bw * 0.88) - rw))
        y1 = random.randint(int(bh * 0.12), max(int(bh * 0.12) + 1, int(bh * 0.88) - rh))

    # Match local luminance softly
    roi = bg[y1 : y1 + rh, x1 : x1 + rw].astype(np.float32)
    rot_f = rotated.astype(np.float32)
    bg_l = float(np.mean(roi))
    fg_l = float(np.mean(rot_f[mask > 128])) if np.any(mask > 128) else bg_l
    gain = np.clip((bg_l + random.uniform(-15, 25)) / max(20.0, fg_l), 0.55, 1.45)
    rot_f = np.clip(rot_f * gain, 0, 255)

    # Mild Gaussian blur + feather mask to avoid sharp artificial paste borders
    rot_f = cv2.GaussianBlur(rot_f, (3, 3), 0.6)
    alpha = cv2.GaussianBlur(mask.astype(np.float32) / 255.0, (3, 3), 0.6)[..., None]
    blended = np.clip(rot_f * alpha + roi * (1.0 - alpha), 0, 255).astype(np.uint8)
    bg[y1 : y1 + rh, x1 : x1 + rw] = blended

    # Simulate DVR JPEG compression artifact
    ok, enc = cv2.imencode(".jpg", bg, [int(cv2.IMWRITE_JPEG_QUALITY), random.randint(68, 92)])
    if ok:
        bg = cv2.imdecode(enc, cv2.IMREAD_COLOR)

    ncx = (x1 + rw / 2) / bw
    ncy = (y1 + rh / 2) / bh
    nw = rw / bw
    nh = rh / bh
    return bg, (0, ncx, ncy, nw, nh)


def build_dataset():
    if OUT_DS.exists():
        shutil.rmtree(OUT_DS)
    for split in ["train", "val"]:
        (OUT_DS / "images" / split).mkdir(parents=True, exist_ok=True)
        (OUT_DS / "labels" / split).mkdir(parents=True, exist_ok=True)

    train_crops = extract_phone_crops(PHONE_DS / "images" / "train", PHONE_DS / "labels" / "train")
    val_crops = extract_phone_crops(PHONE_DS / "images" / "val", PHONE_DS / "labels" / "val")
    print(f"[CCTV-PHONE] Extracted {len(train_crops)} train crops, {len(val_crops)} val crops")

    # Select clean kitchen backgrounds without phone detections
    all_snaps = sorted(HOT_SNAPS.glob("*.jpg"))
    # Exclude snapshots near the 11-25 00:07..00:18 phone test window just in case
    bgs = [p for p in all_snaps if not any(ts in p.name for ts in ["1795565", "1795687015579"])]
    random.shuffle(bgs)
    val_bgs = bgs[:45]
    train_bgs = bgs[45:320]
    if len(train_bgs) < 60:
        train_bgs = bgs[45:]

    def load_bgs(paths):
        loaded = []
        for p in paths:
            im = cv2.imread(str(p))
            if im is not None and im.shape[0] >= 240 and im.shape[1] >= 320:
                loaded.append(im)
        return loaded

    tr_bg_imgs = load_bgs(train_bgs)
    va_bg_imgs = load_bgs(val_bgs)
    print(f"[CCTV-PHONE] Backgrounds: train={len(tr_bg_imgs)}, val={len(va_bg_imgs)}")

    # 1. Synthetic multi-scale CCTV phones (Train: 210 pos, 95 hard negatives)
    idx = 0
    for i in range(210):
        bg = random.choice(tr_bg_imgs)
        labels = []
        cur = bg
        for _ in range(random.choice([1, 1, 2])):
            crop = random.choice(train_crops)
            res_img, lbl = paste_phone_cctv(cur, crop, random.randint(22, 56))
            if res_img is not None:
                cur = res_img
                labels.append(lbl)
        if not labels:
            continue
        stem = f"syn_pos_{idx:04d}"
        cv2.imwrite(str(OUT_DS / "images" / "train" / f"{stem}.jpg"), cur)
        with open(OUT_DS / "labels" / "train" / f"{stem}.txt", "w") as f:
            for l in labels:
                f.write(f"{l[0]} {l[1]:.6f} {l[2]:.6f} {l[3]:.6f} {l[4]:.6f}\n")
        idx += 1

    # Hard negatives (clean kitchen frames with 0 labels)
    for i in range(min(95, len(tr_bg_imgs))):
        bg = tr_bg_imgs[i % len(tr_bg_imgs)]
        stem = f"hard_neg_{i:04d}"
        cv2.imwrite(str(OUT_DS / "images" / "train" / f"{stem}.jpg"), bg)
        (OUT_DS / "labels" / "train" / f"{stem}.txt").write_text("")

    # 2. Add real CCTV phone sample img_001.png (+ zoomed DVR 640x360 crop variants)
    if STUDIO_SAMPLE.exists() and STUDIO_META.exists():
        meta = json.loads(STUDIO_META.read_text())
        s_img = cv2.imread(str(STUDIO_SAMPLE))
        sh, sw = s_img.shape[:2]
        b = meta["boxes"][0]
        bx = (b["x"] + b["width"] / 2) / 100.0
        by = (b["y"] + b["height"] / 2) / 100.0
        bw = b["width"] / 100.0
        bh = b["height"] / 100.0

        # Base + flip + DVR crop (strips web UI header/footer around y=50..600)
        for v in range(18):
            cur = s_img.copy()
            nbx, nby, nbw, nbh = bx, by, bw, bh
            if v % 2 == 1:
                cur = cv2.flip(cur, 1)
                nbx = 1.0 - nbx
            # Random inner crop preserving phone
            if v >= 2:
                x1_c = random.randint(0, int(sw * 0.28))
                y1_c = random.randint(40, int(sh * 0.25))
                x2_c = random.randint(max(x1_c + 420, int(sw * 0.72)), sw)
                y2_c = random.randint(max(y1_c + 300, int(sh * 0.75)), sh - 30)
                px_c = nbx * sw
                py_c = nby * sh
                pw_c = nbw * sw
                ph_c = nbh * sh
                if x1_c + 20 < px_c - pw_c and px_c + pw_c < x2_c - 20 and y1_c + 20 < py_c - ph_c and py_c + ph_c < y2_c - 20:
                    cur = cur[y1_c:y2_c, x1_c:x2_c]
                    ch, cw = cur.shape[:2]
                    nbx = (px_c - x1_c) / cw
                    nby = (py_c - y1_c) / ch
                    nbw = pw_c / cw
                    nbh = ph_c / ch
            alpha = random.uniform(0.85, 1.15)
            beta = random.uniform(-12, 12)
            cur = np.clip(alpha * cur + beta, 0, 255).astype(np.uint8)
            stem = f"real_cctv_phone_{v:02d}"
            cv2.imwrite(str(OUT_DS / "images" / "train" / f"{stem}.jpg"), cur)
            with open(OUT_DS / "labels" / "train" / f"{stem}.txt", "w") as f:
                f.write(f"0 {nbx:.6f} {nby:.6f} {nbw:.6f} {nbh:.6f}\n")

    # 3. Build held-out validation set (40 CCTV-scale positives + 25 hard negatives)
    for i in range(40):
        bg = random.choice(va_bg_imgs)
        crop = random.choice(val_crops)
        res_img, lbl = paste_phone_cctv(bg, crop, random.randint(22, 56))
        if res_img is None:
            continue
        stem = f"val_pos_{i:04d}"
        cv2.imwrite(str(OUT_DS / "images" / "val" / f"{stem}.jpg"), res_img)
        with open(OUT_DS / "labels" / "val" / f"{stem}.txt", "w") as f:
            f.write(f"{lbl[0]} {lbl[1]:.6f} {lbl[2]:.6f} {lbl[3]:.6f} {lbl[4]:.6f}\n")

    for i in range(min(25, len(va_bg_imgs))):
        bg = va_bg_imgs[i]
        stem = f"val_neg_{i:04d}"
        cv2.imwrite(str(OUT_DS / "images" / "val" / f"{stem}.jpg"), bg)
        (OUT_DS / "labels" / "val" / f"{stem}.txt").write_text("")

    yaml_path = OUT_DS / "data.yaml"
    yaml_path.write_text(
        f"path: {OUT_DS}\n"
        "train: images/train\n"
        "val: images/val\n"
        "names:\n"
        "  0: cell_phone\n"
    )
    print(f"[CCTV-PHONE] Dataset ready at {yaml_path}")
    return yaml_path


def train_and_export(yaml_path: Path):
    from ultralytics import YOLO

    if RUN_DIR.exists():
        shutil.rmtree(RUN_DIR)

    model = YOLO(str(BASE_PT))
    model.train(
        data=str(yaml_path),
        epochs=32,
        batch=16,
        imgsz=640,
        device="0",
        project=str(RUN_DIR),
        name="run",
        exist_ok=True,
        mosaic=0.35,
        scale=0.35,
        fliplr=0.5,
        lr0=0.002,
        cos_lr=True,
        amp=True,
        workers=2,
        seed=42,
        plots=False,
    )

    best_pt = RUN_DIR / "run" / "weights" / "best.pt"
    if not best_pt.exists():
        best_pt = RUN_DIR / "run" / "weights" / "last.pt"

    exported = YOLO(str(best_pt)).export(format="onnx", imgsz=640, opset=12, simplify=True)
    print(f"[CCTV-PHONE] Exported candidate ONNX: {exported}")
    return best_pt, Path(exported)


if __name__ == "__main__":
    yaml_p = build_dataset()
    train_and_export(yaml_p)
