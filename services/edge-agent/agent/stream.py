import time
import cv2
from loguru import logger
from typing import Generator, Optional
import numpy as np

class RTSPStreamManager:
    def __init__(self, rtsp_url: str, camera_id: str, reconnect_delay: int = 5):
        self.rtsp_url = rtsp_url
        self.camera_id = camera_id
        self.reconnect_delay = reconnect_delay
        self.cap: Optional[cv2.VideoCapture] = None
        self.running = False

    def start(self) -> Generator[np.ndarray, None, None]:
        self.running = True
        while self.running:
            logger.info(f"Connecting to RTSP stream for camera {self.camera_id}...")
            self.cap = cv2.VideoCapture(self.rtsp_url)
            
            if not self.cap.isOpened():
                logger.warning(f"Could not open stream for {self.camera_id}, retrying in {self.reconnect_delay}s...")
                time.sleep(self.reconnect_delay)
                continue

            logger.info(f"Connected to camera {self.camera_id} successfully.")
            while self.running and self.cap.isOpened():
                ret, frame = self.cap.read()
                if not ret:
                    logger.warning(f"Frame read failed for camera {self.camera_id}. Reconnecting...")
                    break
                yield frame

            if self.cap:
                self.cap.release()
            time.sleep(self.reconnect_delay)

    def stop(self):
        self.running = False
        if self.cap:
            self.cap.release()
