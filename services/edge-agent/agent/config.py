import os
from dotenv import load_dotenv

load_dotenv()

class AgentConfig:
    def __init__(self):
        self.agent_id = os.getenv("AGENT_ID", "edge-agent-default")
        self.agent_token = os.getenv("AGENT_TOKEN", "")
        self.cloud_api_url = os.getenv("CLOUD_API_URL", "http://localhost:8080/api/v1")
        self.mqtt_broker = os.getenv("MQTT_BROKER", "localhost")
        self.mqtt_port = int(os.getenv("MQTT_PORT", "1883"))
        self.fps_sample_rate = int(os.getenv("FPS_SAMPLE_RATE", "5"))
        self.local_buffer_dir = os.getenv("LOCAL_BUFFER_DIR", "./buffer")
