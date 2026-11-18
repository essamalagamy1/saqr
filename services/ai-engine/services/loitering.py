"""
Loitering Detection service: detects persons lingering in a zone longer than threshold.
"""

import time
from typing import List, Dict, Any

class LoiteringDetector:
    def __init__(self, max_dwell_seconds: int = 120, polygon: List[List[int]] = None):
        self.max_dwell_seconds = max_dwell_seconds
        self.polygon = polygon or []
        self.track_entry_times: Dict[int, float] = {}

    def _point_in_polygon(self, point: tuple) -> bool:
        if not self.polygon:
            return True
        x, y = point
        n = len(self.polygon)
        inside = False
        p1x, p1y = self.polygon[0]
        for i in range(n + 1):
            p2x, p2y = self.polygon[i % n]
            if y > min(p1y, p2y):
                if y <= max(p1y, p2y):
                    if x <= max(p1x, p2x):
                        if p1y != p2y:
                            xinters = (y - p1y) * (p2x - p1x) / (p2y - p1y) + p1x
                        if p1x == p2x or x <= xinters:
                            inside = not inside
            p1x, p1y = p2x, p2y
        return inside

    def update(self, tracks: List[Any]) -> List[Dict[str, Any]]:
        now = time.time()
        violations = []
        current_ids = set()

        for trk in tracks:
            current_ids.add(trk.track_id)
            center = trk.get_center()

            if self._point_in_polygon(center):
                if trk.track_id not in self.track_entry_times:
                    self.track_entry_times[trk.track_id] = now
                
                dwell_time = now - self.track_entry_times[trk.track_id]
                if dwell_time >= self.max_dwell_seconds:
                    violations.append({
                        "track_id": trk.track_id,
                        "dwell_time": int(dwell_time),
                        "box": trk.box,
                        "type": "loitering"
                    })
            else:
                self.track_entry_times.pop(trk.track_id, None)

        # Cleanup disappeared tracks
        for tid in list(self.track_entry_times.keys()):
            if tid not in current_ids:
                del self.track_entry_times[tid]

        return violations
