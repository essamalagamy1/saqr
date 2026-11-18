"""
YOLOX Fine-Tuning Pipeline for Restaurant PPE & Kitchen Safety
Apache 2.0 Licensed Object Detection Model.

This script runs on Google Colab (Free T4 GPU) or local Linux workstation with CUDA.
Dataset: Roboflow Universe PPE & Kitchen Hygiene (Chef Hat, Gloves, Uniform, Mask).
"""

import os
import sys

COLAB_TRAINING_SCRIPT = """# ==============================================================================
# 🍳 RASED (راصد) — YOLOX Training Notebook for Restaurant Safety
# License: Apache 2.0 (Commercial-friendly)
# ==============================================================================

# 1. Clone official YOLOX repository
!git clone https://github.com/Megvii-BaseDetection/YOLOX.git
%cd YOLOX

# 2. Install YOLOX & dependencies
!pip install -U pip && pip install -r requirements.txt
!pip install -v -e .
!pip install roboflow onnx onnxruntime

# 3. Download Kitchen Safety PPE Dataset from Roboflow Universe
from roboflow import Roboflow
rf = Roboflow(api_key="YOUR_ROBOFLOW_API_KEY")
project = rf.workspace("rased-ai").project("restaurant-ppe-hygiene")
version = project.version(1)
dataset = version.download("coco")

# 4. Download Pre-trained YOLOX-S Weights (COCO pretrained)
!wget https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_s.pth

# 5. Define Custom Experiment Config (exps/example/custom/yolox_restaurant.py)
exp_code = '''
import os
from yolox.exp import Exp as MyExp

class Exp(MyExp):
    def __init__(self):
        super(Exp, self).__init__()
        self.num_classes = 4  # chef_hat, no_hat, gloves, no_gloves
        self.depth = 0.33
        self.width = 0.50
        self.exp_name = "yolox_restaurant_ppe"

        # Data config
        self.data_dir = "datasets/restaurant-ppe"
        self.train_ann = "train/_annotations.coco.json"
        self.val_ann = "valid/_annotations.coco.json"

        self.max_epoch = 40
        self.data_num_workers = 4
        self.eval_interval = 5
'''
with open("exps/example/custom/yolox_restaurant.py", "w") as f:
    f.write(exp_code)

# 6. Start Training
!python tools/train.py -f exps/example/custom/yolox_restaurant.py -d 1 -b 16 --fp16 -o -c yolox_s.pth

# 7. Export Best Model to ONNX for Edge Agent
!python tools/export_onnx.py --output-name yolox_s_restaurant.onnx -f exps/example/custom/yolox_restaurant.py -c YOLOX_outputs/yolox_restaurant_ppe/best_ckpt.pth

print("✅ Model trained & exported successfully to yolox_s_restaurant.onnx!")
"""

def main():
    print("Writing Google Colab training notebook template...")
    with open("docs/train_yolox_colab.py", "w") as f:
        f.write(COLAB_TRAINING_SCRIPT)
    print("Done. Saved to docs/train_yolox_colab.py")

if __name__ == "__main__":
    main()
