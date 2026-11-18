"""
ByteTrack Tracker wrapper for Object Tracking across frames.
"""

from typing import List, Dict, Any
import numpy as np

class Track:
    def __init__(self, track_id: int, box: List[float], score: float):
        self.track_id = track_id
        self.box = box  # [x1, y1, x2, y2]
        self.score = score
        self.history = [self.get_center()]
        self.hits = 1
        self.time_since_update = 0

    def get_center(self) -> Tuple_Point:
        x1, y1, x2, y2 = self.box
        return ((x1 + x2) / 2.0, (y1 + y2) / 2.0)

    def update(self, box: List[float], score: float):
        self.box = box
        self.score = score
        self.history.append(self.get_center())
        if len(self.history) > 30:
            self.history.pop(0)
        self.hits += 1
        self.time_since_update = 0

Tuple_Point = tuple

class ByteTracker:
    def __init__(self, track_thresh: float = 0.5, match_thresh: float = 0.8, max_time_lost: int = 30):
        self.track_thresh = track_thresh
        self.match_thresh = match_thresh
        self.max_time_lost = max_time_lost
        self.tracked_tracks: List[Track] = []
        self._next_id = 1

    def update(self, detections: List[Dict[str, Any]]) -> List[Track]:
        """
        Updates tracks with new detections using simple IoU matching.
        """
        active_tracks = []
        for det in detections:
            box = det["box"]
            score = det.get("score", 1.0)
            
            # Simple nearest track matcher
            matched = False
            for trk in self.tracked_tracks:
                iou = self._iou(trk.box, box)
                if iou > 0.4:
                    trk.update(box, score)
                    matched = True
                    active_tracks.append(trk)
                    break
            
            if not matched:
                new_track = Track(self._next_id, box, score)
                self._next_id += 1
                self.tracked_tracks.append(new_track)
                active_tracks.append(new_track)

        # Cleanup old tracks
        self.tracked_tracks = [t for t in self.tracked_tracks if t.time_since_update < self.max_time_lost]
        return active_tracks

    def _iou(self, boxA: List[float], boxB: List[float]) -> float:
        xA = max(boxA[0], boxB[0])
        yA = max(boxA[1], boxB[1])
        xB = min(boxA[2], boxB[2])
        yB = min(boxA[3], boxB[3])

        interArea = max(0, xB - xA) * max(0, yB - yA)
        boxAArea = (boxA[2] - boxA[0]) * (boxA[3] - boxA[1])
        boxBArea = (boxB[2] - boxB[0]) * (boxB[3] - boxB[1])
        union = boxAArea + boxBArea - interArea
        return interArea / float(union) if union > 0 else 0.0
