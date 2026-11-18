"""
Rules Engine for Rased AI Monitoring
Processes YOLOX object detections + ByteTrack IDs to detect operational violations.
1. Visitor Counter (عد الزوار)
2. Loitering Detection (كشف التسكع)
3. Kitchen PPE Hygiene (سلامة المطبخ)
"""

import time
from typing import List, Dict, Any, Tuple

class VisitorCounterRule:
    """
    Virtual tripwire / Line Crossing Counter
    Counts entries and exits across a defined line segment.
    """
    def __init__(self, line: Tuple[Tuple[int, int], Tuple[int, int]] = ((100, 300), (500, 300))):
        self.line = line
        self.in_count = 0
        self.out_count = 0
        self.previous_positions: Dict[int, Tuple[float, float]] = {}

    def _side_of_line(self, point: Tuple[float, float]) -> float:
        (x1, y1), (x2, y2) = self.line
        px, py = point
        return (x2 - x1) * (py - y1) - (y2 - y1) * (px - x1)

    def update(self, tracks: List[Any]) -> Dict[str, Any]:
        events = []
        for trk in tracks:
            tid = trk["id"]
            box = trk["box"]
            curr_pos = ((box[0] + box[2]) / 2.0, (box[1] + box[3]) / 2.0)

            if tid in self.previous_positions:
                prev_pos = self.previous_positions[tid]
                side_prev = self._side_of_line(prev_pos)
                side_curr = self._side_of_line(curr_pos)

                if side_prev < 0 and side_curr >= 0:
                    self.in_count += 1
                    events.append({"type": "visitor_in", "track_id": tid, "total_in": self.in_count})
                elif side_prev > 0 and side_curr <= 0:
                    self.out_count += 1
                    events.append({"type": "visitor_out", "track_id": tid, "total_out": self.out_count})

            self.previous_positions[tid] = curr_pos

        return {
            "in_count": self.in_count,
            "out_count": self.out_count,
            "events": events
        }


class LoiteringRule:
    """
    Detects individuals lingering in a restricted or sensitive zone longer than threshold.
    """
    def __init__(self, dwell_seconds_limit: int = 45, polygon: List[Tuple[int, int]] = None):
        self.dwell_seconds_limit = dwell_seconds_limit
        self.polygon = polygon or []
        self.entry_times: Dict[int, float] = {}
        self.alerted_tracks = set()

    def _point_in_polygon(self, x: float, y: float) -> bool:
        if not self.polygon:
            return True
        inside = False
        n = len(self.polygon)
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
        active_ids = set()

        for trk in tracks:
            tid = trk["id"]
            box = trk["box"]
            active_ids.add(tid)
            cx, cy = (box[0] + box[2]) / 2.0, (box[1] + box[3]) / 2.0

            if self._point_in_polygon(cx, cy):
                if tid not in self.entry_times:
                    self.entry_times[tid] = now

                dwell = now - self.entry_times[tid]
                if dwell >= self.dwell_seconds_limit and tid not in self.alerted_tracks:
                    self.alerted_tracks.add(tid)
                    violations.append({
                        "type": "كشف التسكع في منطقة محظورة",
                        "severity": "medium",
                        "confidence": 0.94,
                        "track_id": tid,
                        "dwell_time_seconds": int(dwell),
                        "box": box
                    })
            else:
                self.entry_times.pop(tid, None)
                self.alerted_tracks.discard(tid)

        # Cleanup lost tracks
        for tid in list(self.entry_times.keys()):
            if tid not in active_ids:
                del self.entry_times[tid]
                self.alerted_tracks.discard(tid)

        return violations


class KitchenPPERule:
    """
    Checks kitchen staff for mandatory Food Safety Gear (Gloves, Head Cover, Apron).
    """
    def __init__(self, require_gloves: bool = True, require_hat: bool = True):
        self.require_gloves = require_gloves
        self.require_hat = require_hat

    def check_compliance(self, person_crop_detections: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Takes detections within a person bounding box and identifies missing items.
        """
        violations = []
        labels = [d["label"] for d in person_crop_detections]

        if self.require_gloves and ("no_gloves" in labels or "gloves" not in labels):
            violations.append({
                "type": "عدم ارتداء قفازات العمل",
                "severity": "high",
                "confidence": 0.96,
                "category": "safety"
            })

        if self.require_hat and ("no_hat" in labels or "chef_hat" not in labels):
            violations.append({
                "type": "عدم ارتداء غطاء الرأس",
                "severity": "high",
                "confidence": 0.95,
                "category": "safety"
            })

        return violations
