"""
FastAPI AI Engine Service for Rased
Provides REST API for inference, pipeline testing, and model health.
"""

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
from services.detector import YOLOXDetector
from services.tracker import ByteTracker
from services.counter import LineCounter
from services.loitering import LoiteringDetector

app = FastAPI(
    title="Rased AI Engine",
    description="YOLOX-powered Computer Vision Microservice for Restaurant & Retail Monitoring",
    version="1.0.0"
)

detector = YOLOXDetector()
tracker = ByteTracker()

@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "rased-ai-engine",
        "model": "YOLOX-S",
        "license": "Apache 2.0"
    }

class DetectRequest(BaseModel):
    image_url: Optional[str] = None
    confidence_threshold: float = 0.5

@app.post("/detect")
def run_detect(req: DetectRequest):
    return {
        "success": True,
        "detections": []
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
