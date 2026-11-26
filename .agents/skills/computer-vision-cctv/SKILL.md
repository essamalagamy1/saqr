---
name: computer-vision-cctv
description: >
  Computer vision engineering for CCTV PPE & compliance monitoring, object detection,
  multi-object tracking, and ONNX Runtime / TensorRT deployment. Use when building or
  optimizing YOLO detection pipelines, RTSP video ingestion, anatomical ROI verification,
  or production inference on edge/GPU hardware.
license: MIT + Commons Clause
metadata:
  version: 1.2.0
  author: borghei (customized for saqr)
  category: engineering
  domain: computer-vision
  updated: 2026-11-26
  tags: [object-detection, cctv, ppe-compliance, bytetrack, onnx-runtime, yolo]
---
# CCTV & Compliance Computer Vision Engineer

Design and optimize end-to-end computer vision pipelines for real-time CCTV PPE & compliance monitoring (face masks, gloves, mobile phone detection) using Ultralytics YOLO and ONNX Runtime / TensorRT deployment.

## Core Capabilities

- **Detection pipeline design** — requirements analysis, YOLO architecture selection (`yolo26n`/`s`/`m`, `yolo11`), dataset preparation (Pascal VOC / COCO / YOLO), training configuration for constrained VRAM (e.g., 4GB GPU), and metric evaluation (mAP, Recall on violation classes).
- **CCTV PPE & compliance systems** — resilient RTSP ingestion, ByteTrack multi-object tracking, temporal debouncing, two-stage anatomical ROI association, and ONNX Runtime optimization.
- **Model optimization & deployment** — baseline benchmarking, ONNX export, FP16/INT8 quantization with accuracy verification, and TensorRT/CUDA execution provider tuning.
- **Dataset engineering** — audit, cleaning, format conversion (VOC/COCO/YOLO), bounding-box validation, and stratified train/val/test splits.
- **Production targets** — sustained FPS, mAP, latency P95/P99, VRAM footprint, and false-positive rate budgets.

## When to Use

- Building or updating a CCTV object detection or PPE compliance pipeline.
- Integrating RTSP streams, ByteTrack tracking, or alert debouncing logic.
- Exporting, quantizing, or profiling YOLO models on ONNX Runtime / CUDA / TensorRT.
- Auditing, converting, or splitting computer vision datasets.

## Clarify First

Before generating training configs or inference pipelines, settle the inputs below if missing:

- **Task & Model:** Which compliance module (`face_mask`, `gloves`, `phone_detection`) or detection target.
- **Input Source:** Static image, recorded video, or live RTSP stream (resolution, FPS, camera count).
- **Deployment Target:** Target hardware (e.g., Quadro P2000 4GB VRAM, CPU, Jetson) and runtime (PyTorch `.pt`, ONNX Runtime, TensorRT).

---

## CCTV PPE & Compliance Rules

### 1. RTSP / FFmpeg Stream Resilience
- **Never block inference on stale buffered frames:** OpenCV/FFmpeg buffers accumulate latency when inference is slower than stream FPS. Use a dedicated producer thread (latest-frame buffer of size `1`, dropping older frames on overwrite) or FFmpeg low-latency flags (`-fflags nobuffer -flags low_delay -rtsp_transport tcp`) and `cv2.CAP_PROP_BUFFERSIZE = 1`.
- **Reconnect with exponential backoff + jitter:** Treat `ret == False`, empty frames, or read timeouts as stream disconnects. Reconnect using capped exponential backoff (e.g., `1s → 2s → 4s → ... → max 30s` + random jitter) and log connection state transitions without crashing the worker process.
- **Separate decode from inference:** Keep frame decoding/resizing decoupled from model inference so transient network stalls do not corrupt tracker timestamps or freeze health checks.

### 2. Multi-Object Tracking (ByteTrack) & Temporal Smoothing
- **Track before alerting:** Associate detections across frames using **ByteTrack** (retaining low-confidence detections for track continuity during brief occlusions) so compliance state is evaluated per `track_id`, not per isolated frame.
- **Temporal smoothing & hysteresis (debouncing):** Never emit a compliance violation from a single frame. Maintain a sliding window or consecutive-frame counter per `track_id` (e.g., trigger `VIOLATION` only after `K` violation frames out of `N` recent frames, or `>= T` seconds continuously, and clear only after `M` compliant frames).
- **Alert cooldowns:** Enforce a per-`(camera_id, track_id, violation_type)` cooldown window before emitting duplicate alerts/snapshots, while still updating live track state for UI overlays.

### 3. Two-Stage / Anatomical ROI Association
- **Person-first detection:** Detect `person` bounding boxes first (or alongside PPE classes) to anchor compliance checks to an actual tracked individual rather than background false positives.
- **Anatomical ROI verification:**
  - **Face Mask (`face_mask`):** Restrict or associate mask/no-mask detections to the upper/head ROI of each person box (roughly top 30–35% of the person bounding box) to reject stray faces/posters outside the person context.
  - **Gloves & Phone (`gloves`, `phone_detection`):** Associate hand/glove and mobile phone detections with the hand / upper-to-mid-body ROI of the tracked person.
- **Strict occlusion handling:** If a target anatomical ROI (e.g., hands) is occluded, out of frame, or below minimum pixel size, report `UNKNOWN` / `INDETERMINATE` — never default an unseen hand to `BARE_HAND` or `NO_MASK`.

### 4. ONNX Runtime Inference Optimization
- **Execution provider & threading:** Explicitly configure `onnxruntime.SessionOptions`:
  - Set `graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL`.
  - Tune `intra_op_num_threads` (typically physical cores for CPU EP; avoid oversubscription when running multiple camera workers) and `inter_op_num_threads = 1` for sequential graphs.
  - Pin CUDA/TensorRT EP options explicitly when GPU is present, with VRAM limits respected (e.g., 4GB VRAM budget).
- **Memory reuse & zero-copy I/O:** Pre-allocate input/output tensors and use `IOBinding` (especially for CUDA EP) and `arena_extend_strategy` / memory pattern settings (`enable_mem_pattern = True`, `enable_mem_reuse = True`) to eliminate per-frame host-device allocation churn.
- **Profile before claiming speedups:** Measure actual end-to-end throughput (FPS) and latency percentiles (`P50`, `P95`, `P99`)—including preprocessing (letterbox/normalize), inference, and postprocessing (NMS/decode)—after warmup iterations on the target hardware. Never quote theoretical or unmeasured speedup numbers.

---

## Anti-Patterns

### Benchmarking Without Target Runtime & Warmup
**Mistake:** Reporting latency or speedup numbers without running `onnxruntime` / CUDA on the target hardware, or including cold-start first-frame compilation in averages.
**Instead:** Run warmup iterations, benchmark on target hardware with the exact input shape and batch size, and report measured FPS and P50/P95/P99 latency.

### Quantizing Without an Accuracy Check
**Mistake:** Shipping an FP16 or INT8 exported model because inference is faster, without re-measuring mAP and per-class Recall.
**Why it happens:** Speed is visible immediately; accuracy drops show up later on small/rare classes (`bare_hand`, `incorrect_mask`, small `phone`).
**Instead:** Re-run validation on the held-out test split after every export or precision change and accept only within the agreed accuracy/Recall budget.

### Splitting After Augmenting
**Mistake:** Augmenting the full dataset, then splitting into train/val/test.
**Instead:** Perform stratified split first, keep `val` and `test` untouched, and apply augmentations only to `train` (or online during training) to prevent data leakage and inflated mAP.

### Single-Frame Violation Alerting
**Mistake:** Triggering alerts on raw single-frame detections without tracking or temporal smoothing.
**Instead:** Require ByteTrack persistence + M-of-N temporal debouncing + per-track cooldowns.
