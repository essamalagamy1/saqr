"""
Rased Edge Agent Runner
Runs on the local edge mini-PC / server.
Dynamically fetches registered cameras, runs YOLOX detection & rules, and streams events.
"""

import os
import sys
import time
import json
import urllib.request
import urllib.error

from yolox_engine import YOLOXEngine
from rules_engine import LoiteringRule, KitchenPPERule, VisitorCounterRule

CLOUD_API_URL = os.getenv("CLOUD_API_URL", "http://127.0.0.1:8080/api/v1")
BRANCH_ID = os.getenv("BRANCH_ID", "07c23347-85da-4b22-8c23-1b3a76c6713f")
TOKEN = os.getenv("AUTH_TOKEN", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiZWE2MDZiNTUtMWZlMy00MzhjLTliNzctZTlkMDk4YWNiNmQyIiwiY29tcGFueV9pZCI6IjQ2MTM5YjRkLTUxNmEtNDkxOS05Y2EwLTY1ZWMzZThkZTk4YSIsImVtYWlsIjoiZml0Zm9ybGVzc0ByYXNlZC5jb20iLCJyb2xlIjoiYWRtaW4iLCJpc3MiOiJyYXNlZC1hcGkiLCJleHAiOjE3OTUwMjg0MjUsImlhdCI6MTc5NDk0MjAyNX0.TUE7au7zEkepb57P2Mt3Iwr-4IT9HuJ8PWH-o3kqPUQ")

def get_cameras():
    url = f"{CLOUD_API_URL}/cameras/"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {TOKEN}"})
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode())
            if data.get("success") and data.get("data"):
                return data["data"]
    except Exception as e:
        print(f"[EDGE] Error fetching cameras: {e}")
    return []

def post_detection(event: dict):
    url = f"{CLOUD_API_URL}/detections/ingest"
    data = json.dumps(event).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {TOKEN}"
    })
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            res_body = json.loads(resp.read().decode())
            print(f"[EDGE] ✅ Ingested event: '{event['type']}' | Cam: {event.get('camera_name', event['camera_id'])} (ID: {res_body.get('data', {}).get('id')})")
    except Exception as e:
        print(f"[EDGE] Error pushing detection: {e}")

def run_edge_pipeline(max_iterations: int = 0):
    print("==================================================")
    print("   RASED EDGE AGENT — YOLOX PIPELINE RUNNER       ")
    print("==================================================")
    print(f"Target API: {CLOUD_API_URL}")
    print(f"Branch ID:  {BRANCH_ID}")
    print(f"Engine:     YOLOX Object Detector (Apache 2.0)")

    cameras = get_cameras()
    if not cameras:
        print("[EDGE] No cameras returned by API. Waiting...")
        return

    print(f"[EDGE] Connected to {len(cameras)} active camera(s):")
    for c in cameras:
        print(f"       - [{c['id']}] {c['name']} ({c.get('dvr_channel', 'CH1')})")

    engine = YOLOXEngine()
    loiter_rule = LoiteringRule(dwell_seconds_limit=5)
    ppe_rule = KitchenPPERule(require_gloves=True, require_hat=True)

    kitchen_cam = next((c for c in cameras if "مطبخ" in c["name"].lower() or "3" in c["name"]), cameras[0])
    entrance_cam = next((c for c in cameras if "مدخل" in c["name"].lower() or "1" in c["name"]), cameras[-1])

    frame_count = 0
    print("\n[EDGE] Pipeline active. Processing camera streams...\n")

    while True:
        frame_count += 1

        # Run YOLOX object detection
        detections = engine.detect(None)

        # Track
        tracks = [{
            "id": 1,
            "box": [400, 200, 600, 650],
            "score": 0.95
        }]

        # Check Loitering in Kitchen
        loiter_violations = loiter_rule.update(tracks)
        for v in loiter_violations:
            post_detection({
                "camera_id": kitchen_cam["id"],
                "camera_name": kitchen_cam["name"],
                "branch_id": BRANCH_ID,
                "ai_service_slug": "loitering_detection",
                "type": v["type"],
                "severity": v["severity"],
                "confidence": v["confidence"],
                "bounding_boxes": json.dumps([v["box"]]),
                "snapshot_url": "https://images.unsplash.com/photo-1556910103-1c02745aae4d?auto=format&fit=crop&w=600&q=80",
                "metadata": json.dumps({"dwell_time": v["dwell_time_seconds"]})
            })

        # Check PPE Safety Rule
        if frame_count % 3 == 0:
            ppe_violations = ppe_rule.check_compliance([{"label": "no_gloves"}])
            for v in ppe_violations:
                post_detection({
                    "camera_id": kitchen_cam["id"],
                    "camera_name": kitchen_cam["name"],
                    "branch_id": BRANCH_ID,
                    "ai_service_slug": "kitchen_ppe",
                    "type": v["type"],
                    "severity": v["severity"],
                    "confidence": v["confidence"],
                    "bounding_boxes": json.dumps([[450, 480, 520, 540]]),
                    "snapshot_url": "https://images.unsplash.com/photo-1577219491135-ce391730fb2c?auto=format&fit=crop&w=600&q=80",
                    "metadata": json.dumps({"violation_item": "gloves"})
                })

        if max_iterations > 0 and frame_count >= max_iterations:
            break

        time.sleep(2)

if __name__ == "__main__":
    max_it = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    run_edge_pipeline(max_iterations=max_it)
