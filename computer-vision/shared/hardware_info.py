#!/usr/bin/env python3
"""
Hardware Info & GPU Resource Profiler for Saqr CV Models
Specialized for NVIDIA Quadro P2000 (4GB VRAM) and system memory profiling.
"""

import sys
import os

def get_system_ram_gb():
    """Returns available and total system RAM in GB using /proc/meminfo or psutil."""
    try:
        import psutil
        mem = psutil.virtual_memory()
        return round(mem.total / 1e9, 2), round(mem.available / 1e9, 2)
    except ImportError:
        total_ram, avail_ram = 16.0, 8.0
        if os.path.exists('/proc/meminfo'):
            with open('/proc/meminfo') as f:
                lines = f.readlines()
                meminfo = {}
                for l in lines:
                    parts = l.split(':')
                    if len(parts) == 2:
                        meminfo[parts[0].strip()] = int(parts[1].split()[0])
                total_ram = round(meminfo.get('MemTotal', 16000000) / 1e6, 2)
                avail_ram = round(meminfo.get('MemAvailable', 8000000) / 1e6, 2)
        return total_ram, avail_ram

def profile_hardware():
    """
    Profiles current machine hardware: CPU, RAM, and GPU.
    Returns recommended batch size and image size for YOLO training.
    """
    total_ram, avail_ram = get_system_ram_gb()
    info = {
        "cuda_available": False,
        "device_name": "CPU",
        "total_vram_gb": 0.0,
        "free_vram_gb": 0.0,
        "total_ram_gb": total_ram,
        "avail_ram_gb": avail_ram,
        "recommended_batch": 4,
        "recommended_imgsz": 640,
        "device_arg": "cpu"
    }

    try:
        import torch
        if torch.cuda.is_available():
            device_id = 0
            info["cuda_available"] = True
            info["device_name"] = torch.cuda.get_device_name(device_id)
            total_vram = torch.cuda.get_device_properties(device_id).total_memory / 1e9
            allocated_vram = torch.cuda.memory_allocated(device_id) / 1e9
            free_vram = total_vram - allocated_vram

            info["total_vram_gb"] = round(total_vram, 2)
            info["free_vram_gb"] = round(free_vram, 2)
            info["device_arg"] = "0"

            # Auto-tuning for 4GB VRAM (Quadro P2000)
            if total_vram <= 4.5:
                # 4GB VRAM constraints:
                # imgsz=640 with batch=8 or 4 to strictly avoid OOM
                info["recommended_batch"] = 8 if free_vram >= 3.5 else 4
                info["recommended_imgsz"] = 640
            elif total_vram <= 8.5:
                info["recommended_batch"] = 16
                info["recommended_imgsz"] = 640
            else:
                info["recommended_batch"] = 32
                info["recommended_imgsz"] = 640

    except ImportError:
        pass

    return info

def print_hardware_summary():
    hw = profile_hardware()
    print("=" * 65)
    print("🖥️  Hardware & Compute Resource Summary")
    print("=" * 65)
    print(f"CUDA Available:       {hw['cuda_available']}")
    print(f"Compute Device:       {hw['device_name']}")
    if hw['cuda_available']:
        print(f"Total VRAM:           {hw['total_vram_gb']} GB")
        print(f"Free VRAM:            {hw['free_vram_gb']} GB")
    print(f"Total System RAM:     {hw['total_ram_gb']} GB (Available: {hw['avail_ram_gb']} GB)")
    print(f"Device Target:        {hw['device_arg']}")
    print(f"Recommended Batch:    {hw['recommended_batch']}")
    print(f"Recommended Img Size: {hw['recommended_imgsz']}")
    print("=" * 65)
    return hw

if __name__ == "__main__":
    print_hardware_summary()
