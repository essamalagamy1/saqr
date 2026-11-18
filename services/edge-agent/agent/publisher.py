import json
import os
import time
from loguru import logger
import paho.mqtt.client as mqtt
from typing import Dict, Any

class MQTTPublisher:
    def __init__(self, broker: str, port: int, agent_id: str, buffer_dir: str = "./buffer"):
        self.broker = broker
        self.port = port
        self.agent_id = agent_id
        self.buffer_dir = buffer_dir
        os.makedirs(self.buffer_dir, exist_ok=True)
        
        self.client = mqtt.Client(client_id=f"rased-agent-{agent_id}")
        self.client.on_connect = self._on_connect
        self.client.on_disconnect = self._on_disconnect
        self.connected = False

    def connect(self):
        try:
            self.client.connect(self.broker, self.port, 60)
            self.client.loop_start()
        except Exception as e:
            logger.warning(f"Could not connect to MQTT broker ({e}). Events will be buffered locally.")

    def _on_connect(self, client, userdata, flags, rc):
        if rc == 0:
            self.connected = True
            logger.info("Connected to MQTT Broker.")
            self._flush_buffer()
        else:
            logger.error(f"MQTT connect failed with code {rc}")

    def _on_disconnect(self, client, userdata, rc):
        self.connected = False
        logger.warning("Disconnected from MQTT Broker.")

    def publish_event(self, event: Dict[str, Any]):
        topic = f"rased/events/{event.get('branch_id', 'global')}/{event.get('camera_id', 'all')}"
        payload = json.dumps(event)

        if self.connected:
            self.client.publish(topic, payload, qos=1)
            logger.info(f"Published event {event.get('type')} to {topic}")
        else:
            self._save_to_buffer(event)

    def _save_to_buffer(self, event: Dict[str, Any]):
        fname = os.path.join(self.buffer_dir, f"evt_{int(time.time()*1000)}.json")
        with open(fname, "w") as f:
            json.dump(event, f)
        logger.warning(f"Buffered event to {fname} (Offline mode)")

    def _flush_buffer(self):
        files = [f for f in os.listdir(self.buffer_dir) if f.endswith(".json")]
        if not files:
            return
        logger.info(f"Flushing {len(files)} buffered events...")
        for fname in sorted(files):
            fpath = os.path.join(self.buffer_dir, fname)
            try:
                with open(fpath, "r") as f:
                    event = json.load(f)
                topic = f"rased/events/{event.get('branch_id', 'global')}/{event.get('camera_id', 'all')}"
                self.client.publish(topic, json.dumps(event), qos=1)
                os.remove(fpath)
            except Exception as e:
                logger.error(f"Failed to flush {fpath}: {e}")
                break
