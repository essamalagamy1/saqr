#!/usr/bin/env python3
"""
Saqr Custom Training Studio — Real GPU YOLO26 Fine-Tuning, Validation & Atomic Deployment
Runs from host .venv/bin/python, mixes user samples with experience replay,
exports & validates ONNX via studio_infer.js before atomic swap, and generates Before/After proof.
"""

import argparse
import csv
import hashlib
import json
import os
import random
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

SAQR_ROOT = Path(__file__).resolve().parent.parent
CV_DIR = SAQR_ROOT / "computer-vision"
STUDIO_DIR = SAQR_ROOT / "storage" / "training_studio"
MODELS_DIR = SAQR_ROOT / "apps" / "desktop" / "models"
LOCK_FILE = STUDIO_DIR / "active.lock"
MANIFEST_FILE = MODELS_DIR / "studio_manifest.json"
RELOAD_SIGNAL = MODELS_DIR / ".reload_signal"
INFER_HELPER = SAQR_ROOT / "scripts" / "studio_infer.js"

sys.path.insert(0, str(CV_DIR / "shared"))
from hardware_info import profile_hardware  # noqa: E402

MODEL_REGISTRY = {
    "face_mask": {
        "cv_dir": "face_mask",
        "onnx_name": "face_mask.onnx",
        "names": {0: "with_mask", 1: "without_mask", 2: "mask_weared_incorrect"},
    },
    "gloves": {
        "cv_dir": "gloves",
        "onnx_name": "gloves.onnx",
        "names": {0: "gloves", 1: "bare_hand"},
    },
    "phone": {
        "cv_dir": "phone_detection",
        "onnx_name": "phone.onnx",
        "names": {0: "cell_phone"},
    },
}


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def sha256_file(path: Path) -> str:
    if not path.exists():
        return ""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def atomic_write_json(path: Path, data: dict):
    tmp = path.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def atomic_copy(src: Path, dst: Path):
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_suffix(dst.suffix + ".tmp")
    shutil.copy2(src, tmp)
    os.replace(tmp, dst)


def update_job(job_path: Path, updates: dict):
    with open(job_path, "r", encoding="utf-8") as f:
        job = json.load(f)
    job.update(updates)
    job["updatedAt"] = now_iso()
    atomic_write_json(job_path, job)
    return job


def run_batch_infer(model_key: str, samples_dir: Path, conf: float = 0.25) -> dict:
    proc = subprocess.run(
        ["node", str(INFER_HELPER), "batch-infer", model_key, str(samples_dir), "--conf", str(conf)],
        cwd=str(SAQR_ROOT),
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"batch-infer failed: {proc.stderr.strip() or proc.stdout.strip()}")
    parsed = json.loads(proc.stdout.strip().splitlines()[-1])
    if not parsed.get("success"):
        raise RuntimeError(parsed.get("error", "batch-infer error"))
    return parsed["results"]


def validate_staged_onnx(onnx_path: Path, model_key: str) -> dict:
    proc = subprocess.run(
        ["node", str(INFER_HELPER), "validate", str(onnx_path), model_key],
        cwd=str(SAQR_ROOT),
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"ONNX validation failed: {proc.stderr.strip() or proc.stdout.strip()}")
    return json.loads(proc.stdout.strip().splitlines()[-1])


def materialize_dataset(job_dir: Path, model_key: str, use_replay: bool):
    cfg = MODEL_REGISTRY[model_key]
    samples_dir = job_dir / "samples"
    dataset_dir = job_dir / "dataset"

    for split in ("train", "val"):
        (dataset_dir / "images" / split).mkdir(parents=True, exist_ok=True)
        (dataset_dir / "labels" / split).mkdir(parents=True, exist_ok=True)

    meta_files = sorted(samples_dir.glob("*.meta.json"))
    if not meta_files:
        raise RuntimeError("No annotated samples found in job directory")

    sample_entries = []
    for mf in meta_files:
        with open(mf, "r", encoding="utf-8") as f:
            meta = json.load(f)
        img_name = meta["fileName"]
        img_path = samples_dir / img_name
        if not img_path.exists():
            continue

        # Convert UI percentage top-left boxes to YOLO normalized center format
        yolo_lines = []
        if not meta.get("isNegative", False):
            for box in meta.get("boxes", []):
                cls_id = int(box["classId"])
                if cls_id not in cfg["names"]:
                    raise ValueError(f"Invalid classId {cls_id} for model {model_key}")
                left = max(0.0, min(1.0, float(box["x"]) / 100.0))
                top = max(0.0, min(1.0, float(box["y"]) / 100.0))
                w = max(0.001, min(1.0, float(box["width"]) / 100.0))
                h = max(0.001, min(1.0, float(box["height"]) / 100.0))
                xc = max(0.0, min(1.0, left + w / 2.0))
                yc = max(0.0, min(1.0, top + h / 2.0))
                yolo_lines.append(f"{cls_id} {xc:.6f} {yc:.6f} {w:.6f} {h:.6f}")

        lbl_content = "\n".join(yolo_lines)
        (samples_dir / f"{img_path.stem}.txt").write_text(lbl_content, encoding="utf-8")
        sample_entries.append((img_path, lbl_content, meta))

    # Avoid train/val data leakage: split 80/20 only when >= 5 samples; otherwise all user samples go to train
    val_entries = []
    train_entries = list(sample_entries)
    if len(sample_entries) >= 5:
        rng = random.Random(42)
        indices = list(range(len(sample_entries)))
        rng.shuffle(indices)
        val_count = max(1, len(sample_entries) // 5)
        val_idx_set = set(indices[:val_count])
        train_entries = [sample_entries[i] for i in range(len(sample_entries)) if i not in val_idx_set]
        val_entries = [sample_entries[i] for i in range(len(sample_entries)) if i in val_idx_set]

    # Experience Replay from base dataset to prevent catastrophic forgetting
    replay_train_count = 0
    replay_val_count = 0
    base_ds = CV_DIR / cfg["cv_dir"] / "dataset"

    max_replay_train_cap = 25 if model_key == "phone" else 100
    src_train_imgs = []
    if use_replay and (base_ds / "images" / "train").exists():
        rng = random.Random(42)
        all_src_train = sorted(
            [p for p in (base_ds / "images" / "train").iterdir() if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}]
        )
        src_train_imgs = rng.sample(all_src_train, min(max_replay_train_cap, len(all_src_train)))

    # Dynamic boost so 1-4 user images aren't drowned out by replay samples (~35-45% user weight)
    target_user_copies = max(5, min(20, max(5, len(src_train_imgs) // 2) // max(1, len(train_entries))))
    user_train_count = 0
    for img_path, lbl_content, _ in train_entries:
        for copy_i in range(target_user_copies):
            stem = f"user_{img_path.stem}_b{copy_i}"
            shutil.copy2(img_path, dataset_dir / "images" / "train" / f"{stem}{img_path.suffix}")
            (dataset_dir / "labels" / "train" / f"{stem}.txt").write_text(lbl_content, encoding="utf-8")
            user_train_count += 1

    user_val_count = 0
    for img_path, lbl_content, _ in val_entries:
        stem = f"userval_{img_path.stem}"
        shutil.copy2(img_path, dataset_dir / "images" / "val" / f"{stem}{img_path.suffix}")
        (dataset_dir / "labels" / "val" / f"{stem}.txt").write_text(lbl_content, encoding="utf-8")
        user_val_count += 1

    for p in src_train_imgs:
        dst_stem = f"replay_{p.stem}"
        shutil.copy2(p, dataset_dir / "images" / "train" / f"{dst_stem}{p.suffix}")
        lbl_src = base_ds / "labels" / "train" / f"{p.stem}.txt"
        lbl_txt = lbl_src.read_text(encoding="utf-8") if lbl_src.exists() else ""
        (dataset_dir / "labels" / "train" / f"{dst_stem}.txt").write_text(lbl_txt, encoding="utf-8")
        replay_train_count += 1

    if (base_ds / "images" / "val").exists():
        rng = random.Random(42)
        src_val_imgs = sorted(
            [p for p in (base_ds / "images" / "val").iterdir() if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}]
        )
        max_replay_val = min(10 if model_key == "phone" else 50, len(src_val_imgs))
        for p in rng.sample(src_val_imgs, max_replay_val):
            dst_stem = f"replayval_{p.stem}"
            shutil.copy2(p, dataset_dir / "images" / "val" / f"{dst_stem}{p.suffix}")
            lbl_src = base_ds / "labels" / "val" / f"{p.stem}.txt"
            lbl_txt = lbl_src.read_text(encoding="utf-8") if lbl_src.exists() else ""
            (dataset_dir / "labels" / "val" / f"{dst_stem}.txt").write_text(lbl_txt, encoding="utf-8")
            replay_val_count += 1

    # Fallback if base val dir didn't exist and user uploaded < 5 samples
    if user_val_count + replay_val_count == 0:
        for img_path, lbl_content, _ in sample_entries[:1]:
            stem = f"fallbackval_{img_path.stem}"
            shutil.copy2(img_path, dataset_dir / "images" / "val" / f"{stem}{img_path.suffix}")
            (dataset_dir / "labels" / "val" / f"{stem}.txt").write_text(lbl_content, encoding="utf-8")

    # Write clean data.yaml
    names_yaml = "\n".join([f"  {k}: {v}" for k, v in cfg["names"].items()])
    yaml_content = (
        f"path: {dataset_dir.resolve()}\n"
        f"train: images/train\n"
        f"val: images/val\n"
        f"nc: {len(cfg['names'])}\n"
        f"names:\n{names_yaml}\n"
    )
    yaml_path = dataset_dir / "data.yaml"
    yaml_path.write_text(yaml_content, encoding="utf-8")

    return {
        "yaml_path": yaml_path,
        "user_samples": len(sample_entries),
        "user_train_boosted": user_train_count,
        "user_val": user_val_count,
        "replay_train": replay_train_count,
        "replay_val": replay_val_count,
    }


def parse_results_csv(csv_path: Path) -> tuple[list[dict], dict]:
    history = []
    if not csv_path.exists():
        return history, {}
    with open(csv_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            cleaned = {k.strip(): v.strip() for k, v in row.items() if k}
            try:
                history.append({
                    "epoch": int(float(cleaned.get("epoch", len(history) + 1))),
                    "box_loss": round(float(cleaned.get("train/box_loss", 0) or 0), 4),
                    "cls_loss": round(float(cleaned.get("train/cls_loss", 0) or 0), 4),
                    "precision": round(float(cleaned.get("metrics/precision(B)", 0) or 0), 4),
                    "recall": round(float(cleaned.get("metrics/recall(B)", 0) or 0), 4),
                    "map50": round(float(cleaned.get("metrics/mAP50(B)", 0) or 0), 4),
                    "map50_95": round(float(cleaned.get("metrics/mAP50-95(B)", 0) or 0), 4),
                })
            except ValueError:
                continue
    final_metrics = history[-1] if history else {}
    return history, final_metrics


def prune_old_backups(backups_root: Path, model_key: str, keep: int = 5):
    if not backups_root.exists():
        return
    matching = sorted(
        [d for d in backups_root.iterdir() if d.is_dir() and d.name.startswith(f"{model_key}_")],
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    for old_dir in matching[keep:]:
        shutil.rmtree(old_dir, ignore_errors=True)


def prune_old_jobs(jobs_root: Path, keep: int = 12):
    if not jobs_root.exists():
        return
    dirs = sorted(
        [d for d in jobs_root.iterdir() if d.is_dir()],
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    for old_dir in dirs[keep:]:
        # Keep job.json & proof.json, prune heavy materialized dataset folder
        ds = old_dir / "dataset"
        if ds.exists():
            shutil.rmtree(ds, ignore_errors=True)


def main():
    parser = argparse.ArgumentParser(description="Saqr Training Studio GPU Runner")
    parser.add_argument("--job-id", required=True)
    args = parser.parse_args()

    try:
        os.nice(10)
    except Exception:
        pass

    import torch
    from ultralytics import YOLO

    torch.set_num_threads(2)

    job_dir = STUDIO_DIR / "jobs" / args.job_id
    job_path = job_dir / "job.json"
    if not job_path.exists():
        raise FileNotFoundError(f"Job not found: {job_path}")

    job = update_job(job_path, {"status": "preparing", "pid": os.getpid()})
    model_key = job["modelKey"]
    epochs = int(job.get("epochs", 15))
    use_replay = bool(job.get("useReplay", True))
    cfg = MODEL_REGISTRY[model_key]

    prod_onnx = MODELS_DIR / cfg["onnx_name"]
    prod_pt = CV_DIR / cfg["cv_dir"] / "weights" / "best.pt"

    try:
        print(f"[STUDIO] Starting training job {args.job_id} for model '{model_key}' (epochs={epochs}, replay={use_replay})", flush=True)
        sha_before = sha256_file(prod_onnx)
        update_job(job_path, {"onnxSha256Before": sha_before})

        print("[STUDIO] Capturing BEFORE inference snapshot on uploaded samples...", flush=True)
        before_results = run_batch_infer(model_key, job_dir / "samples", conf=0.25)

        print("[STUDIO] Materializing dataset with experience replay...", flush=True)
        ds_stats = materialize_dataset(job_dir, model_key, use_replay)
        print(f"[STUDIO] Dataset ready: {ds_stats}", flush=True)

        hw = profile_hardware()
        base_batch = int(hw.get("recommended_batch", 8))
        device = hw.get("device_arg", "0")
        print(f"[STUDIO] Hardware: {hw['device_name']} | VRAM free: {hw['free_vram_gb']} GB | device={device}", flush=True)

        base_weights = prod_pt if prod_pt.exists() else (SAQR_ROOT / "yolo26n.pt")
        update_job(job_path, {"status": "training", "datasetStats": {k: str(v) if isinstance(v, Path) else v for k, v in ds_stats.items()}})

        run_project = job_dir / "runs"
        batch_candidates = []
        for b in [base_batch, 4, 2]:
            if b not in batch_candidates:
                batch_candidates.append(b)

        train_ok = False
        last_err = None
        for bs in batch_candidates:
            try:
                print(f"[STUDIO] Launching YOLO.train(weights={base_weights.name}, batch={bs}, epochs={epochs}, device={device})", flush=True)
                model = YOLO(str(base_weights))
                model.train(
                    data=str(ds_stats["yaml_path"]),
                    epochs=epochs,
                    batch=bs,
                    imgsz=640,
                    device=device,
                    project=str(run_project),
                    name="train_run",
                    exist_ok=True,
                    patience=0,
                    optimizer="AdamW",
                    lr0=0.0005,
                    warmup_epochs=1.0,
                    cos_lr=True,
                    mosaic=0.0,
                    erasing=0.0,
                    save=True,
                    val=True,
                    plots=False,
                    amp=True,
                    workers=2,
                    seed=42,
                )
                train_ok = True
                break
            except RuntimeError as rt_err:
                last_err = rt_err
                if "out of memory" in str(rt_err).lower():
                    print(f"[STUDIO] CUDA OOM at batch={bs}, retrying smaller batch...", flush=True)
                    if torch.cuda.is_available():
                        torch.cuda.empty_cache()
                    continue
                raise

        if not train_ok:
            raise RuntimeError(f"Training failed across all batch sizes: {last_err}")

        run_dir = run_project / "train_run"
        # When user_val == 0 (< 5 user samples), val only reflects old replay images;
        # use last.pt so the model keeps its adapted weights on the new user samples instead of reverting to Epoch 1.
        last_pt = run_dir / "weights" / "last.pt"
        best_pt = run_dir / "weights" / "best.pt"
        if ds_stats.get("user_val", 0) == 0 and last_pt.exists():
            trained_pt = last_pt
        else:
            trained_pt = best_pt if best_pt.exists() else last_pt
        if not trained_pt.exists():
            raise RuntimeError("No trained weights (best.pt/last.pt) produced")

        update_job(job_path, {"status": "exporting"})
        print(f"[STUDIO] Exporting {trained_pt} to ONNX (imgsz=640, opset=18, simplify=True)...", flush=True)
        export_model = YOLO(str(trained_pt))
        exported_path = Path(export_model.export(format="onnx", imgsz=640, opset=18, simplify=True))
        if not exported_path.exists():
            raise RuntimeError("ONNX export produced no output file")

        print("[STUDIO] Validating staged ONNX with onnxruntime-node before deployment...", flush=True)
        val_info = validate_staged_onnx(exported_path, model_key)
        print(f"[STUDIO] Staged ONNX validated OK: {val_info}", flush=True)

        # Backup previous production weights before atomic swap
        backup_dir = STUDIO_DIR / "backups" / f"{model_key}_{int(time.time())}_{args.job_id}"
        backup_dir.mkdir(parents=True, exist_ok=True)
        if prod_pt.exists():
            shutil.copy2(prod_pt, backup_dir / "best.pt")
        if prod_onnx.exists():
            shutil.copy2(prod_onnx, backup_dir / cfg["onnx_name"])
        prune_old_backups(STUDIO_DIR / "backups", model_key, keep=5)

        # Atomic swap into production paths
        atomic_copy(trained_pt, prod_pt)
        atomic_copy(exported_path, prod_onnx)
        sha_after = sha256_file(prod_onnx)

        # Update studio_manifest.json atomically and signal live detector hot-reload
        manifest = {"models": {}}
        if MANIFEST_FILE.exists():
            try:
                manifest = json.loads(MANIFEST_FILE.read_text(encoding="utf-8"))
            except Exception:
                manifest = {"models": {}}
        manifest.setdefault("models", {})
        entry = {
            "studioTrained": True,
            "lastJobId": args.job_id,
            "updatedAt": now_iso(),
            "sha256": sha_after,
            "backupDir": str(backup_dir.relative_to(SAQR_ROOT)),
        }
        if model_key == "phone":
            entry["phoneMode"] = "custom_only"
            entry["conf"] = 0.22
        manifest["models"][model_key] = entry
        atomic_write_json(MANIFEST_FILE, manifest)
        RELOAD_SIGNAL.write_text(now_iso(), encoding="utf-8")

        update_job(job_path, {"status": "verifying", "onnxSha256After": sha_after})
        print("[STUDIO] Running AFTER inference on uploaded samples using deployed ONNX...", flush=True)
        after_results = run_batch_infer(model_key, job_dir / "samples", conf=0.25)

        epoch_history, final_metrics = parse_results_csv(run_dir / "results.csv")
        sample_proofs = []
        for mf in sorted((job_dir / "samples").glob("*.meta.json")):
            meta = json.loads(mf.read_text(encoding="utf-8"))
            fname = meta["fileName"]
            sample_proofs.append({
                "fileName": fname,
                "originalName": meta.get("originalName", fname),
                "notes": meta.get("notes", ""),
                "isNegative": bool(meta.get("isNegative", False)),
                "targetBoxes": meta.get("boxes", []),
                "before": before_results.get(fname, {"detections": [], "inferenceMs": 0}),
                "after": after_results.get(fname, {"detections": [], "inferenceMs": 0}),
            })

        proof_data = {
            "jobId": args.job_id,
            "modelKey": model_key,
            "completedAt": now_iso(),
            "onnxSha256Before": sha_before,
            "onnxSha256After": sha_after,
            "onnxSizeBytes": prod_onnx.stat().st_size,
            "backupDir": str(backup_dir.relative_to(SAQR_ROOT)),
            "metrics": final_metrics,
            "epochHistory": epoch_history,
            "samples": sample_proofs,
        }
        atomic_write_json(job_dir / "proof.json", proof_data)

        # Clean heavy materialized dataset folder after successful training
        if (job_dir / "dataset").exists():
            shutil.rmtree(job_dir / "dataset", ignore_errors=True)
        prune_old_jobs(STUDIO_DIR / "jobs", keep=12)

        update_job(job_path, {
            "status": "completed",
            "onnxSha256After": sha_after,
            "afterMetrics": final_metrics,
            "backupDir": str(backup_dir.relative_to(SAQR_ROOT)),
        })
        print(f"[STUDIO] ✅ Job {args.job_id} completed and deployed! SHA256={sha_after[:12]}", flush=True)
    except Exception as exc:
        print(f"[STUDIO] ❌ Job {args.job_id} failed: {exc}", file=sys.stderr, flush=True)
        update_job(job_path, {"status": "failed", "error": str(exc)})
        sys.exit(1)
    finally:
        if LOCK_FILE.exists():
            try:
                LOCK_FILE.unlink()
            except Exception:
                pass


if __name__ == "__main__":
    main()
