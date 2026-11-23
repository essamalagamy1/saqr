#!/usr/bin/env python3
"""
Independent Training Script for Gloves & Bare Hand Detection Model (YOLO26)
Optimized for NVIDIA Quadro P2000 (4GB VRAM).
"""

import os
import sys
import argparse
from pathlib import Path

# Add shared utilities to Python path
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_DIR = SCRIPT_DIR.parent
ROOT_DIR = PROJECT_DIR.parent
sys.path.insert(0, str(ROOT_DIR / "shared"))

from hardware_info import profile_hardware
from utils import setup_logger

logger = setup_logger("Gloves-Train", str(PROJECT_DIR / "results" / "train.log"))

def train_model(
    config_path: str = None,
    epochs: int = 50,
    batch_size: int = None,
    imgsz: int = 640,
    model_name: str = "yolo26n.pt",
    device: str = None,
    patience: int = 15
):
    from ultralytics import YOLO

    if not config_path:
        config_path = str(PROJECT_DIR / "configs" / "data.yaml")

    if not Path(config_path).exists():
        raise FileNotFoundError(f"Dataset config not found at: {config_path}. Run prepare_dataset.py first.")

    hw = profile_hardware()
    if batch_size is None:
        batch_size = hw["recommended_batch"]
    if device is None:
        device = hw["device_arg"]

    logger.info("=" * 65)
    logger.info("🚀 Launching Independent Training: Gloves & Bare Hand Detection")
    logger.info("=" * 65)
    logger.info(f"Base Model:         {model_name}")
    logger.info(f"Dataset Config:     {config_path}")
    logger.info(f"Target Device:      {device} ({hw['device_name']})")
    logger.info(f"Batch Size:         {batch_size}")
    logger.info(f"Image Resolution:   {imgsz}")
    logger.info(f"Total Epochs:       {epochs} (Early Stopping: {patience})")
    logger.info("=" * 65)

    model = YOLO(model_name)
    project_dir = str(PROJECT_DIR / "results")
    run_name = "train_run"

    results = model.train(
        data=config_path,
        epochs=epochs,
        batch=batch_size,
        imgsz=imgsz,
        device=device,
        project=project_dir,
        name=run_name,
        exist_ok=True,
        patience=patience,
        save=True,
        save_period=10,
        val=True,
        plots=True,
        amp=True,
        workers=2,
        seed=42
    )

    weights_dir = PROJECT_DIR / "weights"
    weights_dir.mkdir(parents=True, exist_ok=True)
    run_weights = Path(project_dir) / run_name / "weights"

    if (run_weights / "best.pt").exists():
        import shutil
        shutil.copy2(run_weights / "best.pt", weights_dir / "best.pt")
        shutil.copy2(run_weights / "last.pt", weights_dir / "last.pt")
        logger.info(f"✅ Saved best weights to: {weights_dir / 'best.pt'}")
        logger.info(f"✅ Saved last weights to: {weights_dir / 'last.pt'}")

    logger.info("Gloves & Bare Hand training completed successfully!")
    return results

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train Gloves & Bare Hand Detection Model")
    parser.add_argument("--config", type=str, default=None, help="Path to data.yaml")
    parser.add_argument("--epochs", type=int, default=50, help="Training epochs")
    parser.add_argument("--batch", type=int, default=None, help="Batch size")
    parser.add_argument("--imgsz", type=int, default=640, help="Image resolution")
    parser.add_argument("--model", type=str, default="yolo26n.pt", help="Base model weights")
    parser.add_argument("--device", type=str, default=None, help="Device ('0' for GPU or 'cpu')")
    parser.add_argument("--patience", type=int, default=15, help="Early stopping patience")
    args = parser.parse_args()

    train_model(
        config_path=args.config,
        epochs=args.epochs,
        batch_size=args.batch,
        imgsz=args.imgsz,
        model_name=args.model,
        device=args.device,
        patience=args.patience
    )
