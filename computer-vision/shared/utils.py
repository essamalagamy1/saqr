#!/usr/bin/env python3
"""
Shared Engineering Utilities for Saqr Computer Vision Models
Provides unified logging, metrics visualization, YAML config management, and stream helpers.
"""

import os
import sys
import yaml
import logging
from pathlib import Path
from typing import Dict, Any, List
import matplotlib.pyplot as plt

def setup_logger(name: str, log_file: str = None, level=logging.INFO) -> logging.Logger:
    """Configures a standardized console and file logger."""
    logger = logging.getLogger(name)
    logger.setLevel(level)

    formatter = logging.Formatter(
        '[%(asctime)s] [%(name)s] [%(levelname)s] %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )

    if not logger.handlers:
        console_handler = logging.StreamHandler(sys.stdout)
        console_handler.setFormatter(formatter)
        logger.addHandler(console_handler)

        if log_file:
            Path(log_file).parent.mkdir(parents=True, exist_ok=True)
            file_handler = logging.FileHandler(log_file, encoding='utf-8')
            file_handler.setFormatter(formatter)
            logger.addHandler(file_handler)

    return logger

def load_yaml(filepath: str) -> Dict[str, Any]:
    """Loads and parses a YAML configuration file."""
    with open(filepath, 'r', encoding='utf-8') as f:
        return yaml.safe_load(f)

def save_yaml(data: Dict[str, Any], filepath: str):
    """Saves dictionary data to a YAML file."""
    Path(filepath).parent.mkdir(parents=True, exist_ok=True)
    with open(filepath, 'w', encoding='utf-8') as f:
        yaml.dump(data, f, default_flow_style=False, allow_unicode=True)

def plot_metrics_summary(metrics: Dict[str, float], output_path: str, title: str):
    """
    Renders a bar chart summarizing Precision, Recall, mAP50, and mAP50-95.
    """
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    keys = list(metrics.keys())
    values = [metrics[k] for k in keys]

    plt.figure(figsize=(8, 5))
    bars = plt.bar(keys, values, color=['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6'])
    plt.ylim(0, 1.05)
    plt.ylabel('Score')
    plt.title(title)
    plt.grid(axis='y', linestyle='--', alpha=0.5)

    for bar in bars:
        h = bar.get_height()
        plt.text(bar.get_x() + bar.get_width() / 2.0, h + 0.02, f'{h:.3f}', ha='center', va='bottom', fontsize=10, fontweight='bold')

    plt.tight_layout()
    plt.savefig(output_path, dpi=200)
    plt.close()

