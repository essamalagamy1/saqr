import time
import requests
from loguru import logger

class HealthMonitor:
    def __init__(self, api_url: str, agent_id: str, agent_token: str, interval_sec: int = 30):
        self.api_url = api_url
        self.agent_id = agent_id
        self.agent_token = agent_token
        self.interval_sec = interval_sec

    def send_heartbeat(self, status: str = "healthy", stats: dict = None):
        payload = {
            "agent_id": self.agent_id,
            "status": status,
            "stats": stats or {},
            "timestamp": int(time.time())
        }
        headers = {"Authorization": f"Bearer {self.agent_token}"}
        try:
            resp = requests.post(f"{self.api_url}/health", json=payload, headers=headers, timeout=5)
            if resp.status_code == 200:
                logger.debug("Heartbeat acknowledged by cloud.")
        except Exception as e:
            logger.debug(f"Heartbeat failed: {e}")
