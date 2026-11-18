"""
Rased Edge Agent Main Process
Runs in restaurant/store on local PC/Mini-PC (BYOD).
Connects to local RTSP cameras, extracts frames, performs analysis, and publishes events.
"""

import time
from loguru import logger
from agent.config import AgentConfig
from agent.publisher import MQTTPublisher
from agent.health import HealthMonitor

def main():
    logger.info("Initializing Rased Edge Agent...")
    cfg = AgentConfig()

    publisher = MQTTPublisher(cfg.mqtt_broker, cfg.mqtt_port, cfg.agent_id, cfg.local_buffer_dir)
    publisher.connect()

    health = HealthMonitor(cfg.cloud_api_url, cfg.agent_id, cfg.agent_token)

    logger.info(f"Rased Edge Agent {cfg.agent_id} active and monitoring.")

    last_heartbeat = 0
    while True:
        now = time.time()
        if now - last_heartbeat >= 30:
            health.send_heartbeat(status="online", stats={"cameras_connected": 0})
            last_heartbeat = now
        time.sleep(1)

if __name__ == "__main__":
    main()
