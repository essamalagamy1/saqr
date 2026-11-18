#!/usr/bin/env python3
"""
Rased Edge Agent Simulator (Zero-Dependency)
Uses Python standard library (urllib.request) to post events to the Rased API.
"""

import time
import json
import random
import urllib.request
import urllib.error

API_BASE = "http://localhost:8080/api/v1"

SAMPLE_EVENTS = [
    {
        "type": "عدم ارتداء قفازات العمل",
        "severity": "high",
        "service_slug": "kitchen_ppe",
        "confidence_min": 0.88,
        "confidence_max": 0.99,
        "box": [140, 260, 220, 340]
    },
    {
        "type": "عدم ارتداء غطاء الرأس",
        "severity": "high",
        "service_slug": "kitchen_ppe",
        "confidence_min": 0.90,
        "confidence_max": 0.98,
        "box": [150, 70, 230, 140]
    },
    {
        "type": "كشف التسكع في الممر",
        "severity": "medium",
        "service_slug": "loitering_detection",
        "confidence_min": 0.92,
        "confidence_max": 0.99,
        "box": [100, 120, 240, 380]
    },
    {
        "type": "كشف استخدام الجوال",
        "severity": "medium",
        "service_slug": "phone_usage",
        "confidence_min": 0.85,
        "confidence_max": 0.96,
        "box": [180, 190, 230, 250]
    },
    {
        "type": "العميل المنتظر - تجاوز وقت الانتظار",
        "severity": "low",
        "service_slug": "queue_wait_time",
        "confidence_min": 0.93,
        "confidence_max": 0.98,
        "box": [120, 160, 260, 370]
    }
]

def make_request(url, data=None, headers=None):
    if headers is None:
        headers = {}
    headers["Content-Type"] = "application/json"
    req = urllib.request.Request(
        url,
        data=json.dumps(data).encode("utf-8") if data else None,
        headers=headers,
        method="POST" if data else "GET"
    )
    with urllib.request.urlopen(req, timeout=10) as response:
        return json.loads(response.read().decode("utf-8"))

def main():
    print("=" * 60)
    print("🤖 Rased Edge Agent Simulator (Zero Dependencies)")
    print("=" * 60)

    # 1. Login
    try:
        login_res = make_request(f"{API_BASE}/auth/login", {
            "email": "fitforless@rased.com",
            "password": "password123"
        })
        token = login_res["data"]["tokens"]["access_token"]
        auth_headers = {"Authorization": f"Bearer {token}"}
        print("✅ Logged in successfully. Token acquired.")
    except Exception as e:
        print(f"❌ Login failed: {e}")
        return

    # 2. Get Branches
    try:
        branches_res = make_request(f"{API_BASE}/branches/", headers=auth_headers)
        branches = branches_res.get("data", [])
        if not branches:
            print("❌ No branches found.")
            return
        branch_id = branches[0]["id"]
        branch_name = branches[0]["name"]
        print(f"✅ Found branch: {branch_name} ({branch_id})")
    except Exception as e:
        print(f"❌ Failed to fetch branches: {e}")
        return

    # 3. Get Cameras
    try:
        cameras_res = make_request(f"{API_BASE}/cameras/", headers=auth_headers)
        cameras = cameras_res.get("data", [])
        if not cameras:
            print("❌ No cameras found.")
            return
        print(f"✅ Found {len(cameras)} cameras connected.")
    except Exception as e:
        print(f"❌ Failed to fetch cameras: {e}")
        return

    print("\n🚀 Starting simulation loop (posting detection every 6 seconds)...\n")
    event_count = 0
    while True:
        sample = random.choice(SAMPLE_EVENTS)
        cam = random.choice(cameras)
        confidence = round(random.uniform(sample["confidence_min"], sample["confidence_max"]), 2)

        payload = {
            "branch_id": branch_id,
            "camera_id": cam["id"],
            "type": sample["type"],
            "severity": sample["severity"],
            "confidence": confidence,
            "bounding_boxes": json.dumps([{"box": sample["box"], "label": sample["type"]}]),
            "metadata": json.dumps({"camera_name": cam["name"], "event_seq": event_count + 1})
        }

        try:
            res = make_request(f"{API_BASE}/detections/ingest", data=payload, headers=auth_headers)
            event_count += 1
            print(f"[{event_count:03d}] 📸 Detection: {sample['type']:<30} | Camera: {cam['name']:<25} | Conf: {int(confidence*100)}%")
        except Exception as e:
            print(f"⚠️ Failed to ingest event: {e}")

        time.sleep(6)

if __name__ == "__main__":
    main()
