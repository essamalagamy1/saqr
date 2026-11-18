"""
Visitor Counting service using virtual line crossing.
"""

from typing import List, Tuple, Dict, Any

class LineCounter:
    def __init__(self, line_p1: Tuple[int, int], line_p2: Tuple[int, int]):
        self.p1 = line_p1
        self.p2 = line_p2
        self.entered = 0
        self.exited = 0
        self.tracked_sides: Dict[int, int] = {}  # track_id -> side (-1 or +1)

    def _get_side(self, point: Tuple[float, float]) -> int:
        """Determines which side of the line a point is on using cross product."""
        x, y = point
        x1, y1 = self.p1
        x2, y2 = self.p2
        val = (x2 - x1) * (y - y1) - (y2 - y1) * (x - x1)
        return 1 if val > 0 else -1

    def update(self, tracks: List[Any]) -> Dict[str, int]:
        """Checks if any track crossed the line."""
        for trk in tracks:
            center = trk.get_center()
            current_side = self._get_side(center)
            
            if trk.track_id in self.tracked_sides:
                prev_side = self.tracked_sides[trk.track_id]
                if prev_side != current_side:
                    if prev_side == -1 and current_side == 1:
                        self.entered += 1
                    else:
                        self.exited += 1
            
            self.tracked_sides[trk.track_id] = current_side

        return {
            "entered": self.entered,
            "exited": self.exited,
            "occupancy": max(0, self.entered - self.exited)
        }
