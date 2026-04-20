"""
Track text detections across frames and fill gaps via optical flow.
"""

from __future__ import annotations

import logging
from collections.abc import Callable

import cv2
import numpy as np

from src.config import DetectionConfig
from src.data_types import BBox, Quad, TextDetection, TextTrack

# Kalman
from src.utils.kalman import QuadKalmanFilter
from src.utils.optical_flow import (
    CoTrackerFlowTracker,
    track_points_farneback,
    track_points_lucas_kanade,
)

logger = logging.getLogger(__name__)


def bbox_iou(a: BBox, b: BBox) -> float:
    x_overlap = max(0, min(a.x2, b.x2) - max(a.x, b.x))
    y_overlap = max(0, min(a.y2, b.y2) - max(a.y, b.y))
    intersection = x_overlap * y_overlap
    union = a.area() + b.area() - intersection
    return intersection / max(union, 1e-6)


def quad_coverage(candidate: Quad, existing: Quad) -> float:
    """Fraction of ``candidate``'s quad area covered by ``existing``'s quad.

    Uses Shapely polygon intersection for accurate overlap on rotated /
    perspective-distorted quads. Axis-aligned bbox overlap would grossly
    overestimate coverage for tilted text.

    Returns ``intersection_area(candidate, existing) / area(candidate)``
    in [0, 1].  Returns 0 if either polygon is degenerate.
    """
    from shapely.geometry import Polygon

    try:
        poly_c = Polygon(candidate.points)
        poly_e = Polygon(existing.points)
        if not poly_c.is_valid or not poly_e.is_valid:
            return 0.0
        c_area = poly_c.area
        if c_area < 1e-6:
            return 0.0
        return float(poly_c.intersection(poly_e).area / c_area)
    except Exception:  # noqa: BLE001
        return 0.0


def generate_quad_grid(
    corners: np.ndarray, grid_size: int,
) -> np.ndarray:
    """Generate a grid of points inside a quad via bilinear interpolation.

    Args:
        corners: (4, 2) quad corners in TL, TR, BR, BL order.
        grid_size: number of interior samples per axis (e.g. 3 = 3×3 = 9
            interior points). The 4 corners are prepended, giving
            ``4 + grid_size**2`` total points.

    Returns:
        (4 + grid_size**2, 2) float32 array. First 4 rows are the
        original corners so indexing ``[:4]`` recovers them.
    """
    pts = [corners.astype(np.float32)]
    if grid_size > 0:
        tl, tr, br, bl = corners[0], corners[1], corners[2], corners[3]
        for iy in range(grid_size):
            # Parametric v in (0, 1) excluding the boundary
            v = (iy + 1) / (grid_size + 1)
            left = tl + v * (bl - tl)
            right = tr + v * (br - tr)
            for ix in range(grid_size):
                u = (ix + 1) / (grid_size + 1)
                pt = left + u * (right - left)
                pts.append(pt.reshape(1, 2).astype(np.float32))
    return np.concatenate(pts, axis=0)


class TextTracker:
    """Groups detections into tracks and fills gaps via optical flow."""

    def __init__(self, config: DetectionConfig):
        self.config = config
        self._cotracker: CoTrackerFlowTracker | None = None

        # Kalman filters per track
        self._kalman_filters: dict[int, QuadKalmanFilter] = {}

        # EMA state per track
        self._ema_states: dict[int, np.ndarray] = {}

        # EMA smoothing factor (tunable via config)
        self._ema_alpha = getattr(config, "ema_alpha", 0.6)

    # -------------------------
    # Kalman helpers
    # -------------------------
    def _get_kalman(self, track_id: int) -> QuadKalmanFilter:
        if track_id not in self._kalman_filters:
            self._kalman_filters[track_id] = QuadKalmanFilter()
        return self._kalman_filters[track_id]

    # -------------------------
    # EMA helper
    # -------------------------
    def _apply_ema(self, track_id: int, points: np.ndarray) -> np.ndarray:
        prev = self._ema_states.get(track_id)

        if prev is None:
            smoothed = points
        else:
            smoothed = self._ema_alpha * prev + (1.0 - self._ema_alpha) * points

        self._ema_states[track_id] = smoothed
        return smoothed

    # -------------------------
    # Text normalization & similarity
    # -------------------------
    def _normalize_text(self, text: str) -> str:
        return text.lower().replace(" ", "")

    def _compute_text_similarity(self, text1: str, text2: str) -> float:
        t1 = self._normalize_text(text1)
        t2 = self._normalize_text(text2)

        if not t1 or not t2:
            return 0.0

        matches = sum(c1 == c2 for c1, c2 in zip(t1, t2))
        max_len = max(len(t1), len(t2))
        return matches / max_len

    # -------------------------
    # Smoothing utilities (light)
    # -------------------------
    def _to_np(self, pts):
        return np.asarray(pts, dtype=np.float32)

    def _smooth_quad(self, prev: Quad, new: Quad, alpha: float = 0.3) -> Quad:
        prev_pts = self._to_np(prev.points)
        new_pts = self._to_np(new.points)

        smoothed = alpha * prev_pts + (1.0 - alpha) * new_pts
        return Quad(points=smoothed)

    def _smooth_or_update_detection(
        self,
        track: TextTrack,
        frame_idx: int,
        new_det: TextDetection,
    ) -> TextDetection:
        if frame_idx in track.detections:
            existing = track.detections[frame_idx]
            smoothed_quad = self._smooth_quad(existing.quad, new_det.quad)

            return TextDetection(
                frame_idx=frame_idx,
                quad=smoothed_quad,
                bbox=smoothed_quad.to_bbox(),
                text=new_det.text,
                ocr_confidence=new_det.ocr_confidence,
                sharpness_score=new_det.sharpness_score,
                contrast_score=new_det.contrast_score,
                frontality_score=new_det.frontality_score,
                composite_score=new_det.composite_score,
            )

        return new_det

    # -------------------------
    # Tracking
    # -------------------------
    def group_detections_into_tracks(
        self,
        all_detections: dict[int, list[TextDetection]],
        translate_fn: Callable[[str], str],
        source_lang: str = "en",
        target_lang: str = "es",
    ) -> list[TextTrack]:

        tracks: list[TextTrack] = []
        next_track_id = 0
        active: dict[int, TextDetection] = {}

        IOU_THRESHOLD = 0.2

        for frame_idx in sorted(all_detections.keys()):
            dets = all_detections[frame_idx]

            matched_det_idxs: set[int] = set()
            matched_track_ids: set[int] = set()

            for det_i, det in enumerate(dets):

                best_score = 0.0
                best_track_id = None

                for track_id, last_det in active.items():

                    if track_id in matched_track_ids:
                        continue

                    if abs(last_det.frame_idx - frame_idx) > self.config.track_break_threshold:
                        continue

                    iou = bbox_iou(det.bbox, last_det.bbox)
                    if iou < IOU_THRESHOLD:
                        continue

                    text_similarity = self._compute_text_similarity(det.text, last_det.text)
                    temporal_score = 1.0 / (1.0 + abs(last_det.frame_idx - frame_idx))

                    center_distance = np.linalg.norm(
                        np.array([
                            (det.bbox.x + det.bbox.x2) / 2.0,
                            (det.bbox.y + det.bbox.y2) / 2.0
                        ]) - np.array([
                            (last_det.bbox.x + last_det.bbox.x2) / 2.0,
                            (last_det.bbox.y + last_det.bbox.y2) / 2.0
                        ])
                    )

                    distance_penalty = 1.0 / (1.0 + center_distance)

                    score = (
                        0.50 * iou +
                        0.20 * text_similarity +
                        0.20 * temporal_score +
                        0.10 * distance_penalty
                    )

                    if score > best_score:
                        best_score = score
                        best_track_id = track_id

                if best_track_id is not None:
                    for track in tracks:
                        if track.track_id == best_track_id:
                            smoothed_det = self._smooth_or_update_detection(
                                track,
                                frame_idx,
                                det,
                            )
                            track.detections[frame_idx] = smoothed_det
                            break

                    active[best_track_id] = det
                    matched_det_idxs.add(det_i)
                    matched_track_ids.add(best_track_id)

            # Create new tracks
            for det_i, det in enumerate(dets):
                if det_i in matched_det_idxs:
                    continue

                if target_lang:
                    try:
                        translated = translate_fn(det.text)
                    except Exception:
                        logger.warning(
                            "Translation failed for text '%s', using source text",
                            det.text,
                        )
                        translated = det.text
                else:
                    translated = det.text

                track = TextTrack(
                    track_id=next_track_id,
                    source_text=det.text,
                    target_text=translated,
                    source_lang=source_lang,
                    target_lang=target_lang,
                    detections={frame_idx: det},
                )

                logger.info(
                    f"Created track {track.track_id} for text '{track.source_text}' at frame {frame_idx}"
                )

                tracks.append(track)
                active[next_track_id] = det
                next_track_id += 1

        return tracks

    # -------------------------
    # Duplicate track suppression
    # -------------------------
    def filter_duplicate_tracks(
        self,
        tracks: list[TextTrack],
    ) -> list[TextTrack]:
        """Remove tracks whose starting-frame bbox is largely covered by
        an existing earlier-starting track.

        Catches the common OCR failure where e.g. "AB" is detected as a
        new track starting at frame 70, but "ABCD" already exists from
        frame 0 and covers the same region.

        Algorithm:
            1. Sort tracks by earliest detection frame (ties broken by
               track_id for determinism).
            2. For each track *t* in order, look at its bbox at its
               starting frame.
            3. Among all previously-accepted tracks that also have a
               detection at that frame, compute ``bbox_coverage(t, i)``.
            4. If any existing track covers more than the configured
               threshold of *t*'s area → drop *t*.
        """
        threshold = self.config.duplicate_track_coverage_threshold
        if threshold <= 0:
            return tracks

        # Sort: earlier start frame first, then by track_id for stability.
        sorted_tracks = sorted(
            tracks,
            key=lambda t: (min(t.detections.keys()), t.track_id),
        )

        accepted: list[TextTrack] = []
        for track in sorted_tracks:
            # Drop tracks where translation == source (nothing to replace).
            if track.source_text.strip().lower() == track.target_text.strip().lower():
                logger.info(
                    "S1: dropping track %d — target text '%s' is same as "
                    "source '%s'",
                    track.track_id, track.target_text, track.source_text,
                )
                continue

            start_frame = min(track.detections.keys())
            start_det = track.detections[start_frame]

            is_duplicate = False
            for existing in accepted:
                existing_det = existing.detections.get(start_frame)
                if existing_det is None:
                    continue
                coverage = quad_coverage(start_det.quad, existing_det.quad)
                if coverage >= threshold:
                    logger.info(
                        "S1: dropping track %d ('%s', starts frame %d) — "
                        "%.0f%% covered by track %d ('%s')",
                        track.track_id, track.source_text, start_frame,
                        coverage * 100, existing.track_id, existing.source_text,
                    )
                    is_duplicate = True
                    break

            if not is_duplicate:
                accepted.append(track)

        n_dropped = len(tracks) - len(accepted)
        if n_dropped > 0:
            logger.info(
                "S1: duplicate suppression dropped %d / %d tracks",
                n_dropped, len(tracks),
            )
        return accepted

    # -------------------------
    # Reference-frame size / aspect filters
    # -------------------------
    def filter_tracks_by_reference_size(
        self,
        tracks: list[TextTrack],
    ) -> list[TextTrack]:
        """Drop tracks whose reference-frame bbox is below ``ref_min_bbox_area``.

        Uses the axis-aligned bbox area (px²) of the reference-frame
        detection. Tracks without a valid reference frame pass through
        unchanged — downstream stages already no-op on them, so there's
        nothing to gain by forcing a drop here.
        """
        min_area = self.config.ref_min_bbox_area
        if min_area <= 0:
            return tracks

        accepted: list[TextTrack] = []
        for track in tracks:
            ref_det = track.detections.get(track.reference_frame_idx)
            if ref_det is None:
                accepted.append(track)
                continue
            area = ref_det.bbox.area()
            if area < min_area:
                logger.info(
                    "S1: dropping track %d ('%s') — reference bbox area "
                    "%d px² < min %g",
                    track.track_id, track.source_text, area, min_area,
                )
                continue
            accepted.append(track)

        n_dropped = len(tracks) - len(accepted)
        if n_dropped > 0:
            logger.info(
                "S1: min-area filter dropped %d / %d tracks",
                n_dropped, len(tracks),
            )
        return accepted

    def filter_tracks_by_reference_aspect_ratio(
        self,
        tracks: list[TextTrack],
    ) -> list[TextTrack]:
        """Drop tracks whose reference quad exceeds ``ref_max_aspect_ratio``.

        Ratio is ``max(w/h, h/w)`` of the reference quad's average edge
        lengths — symmetric across 90° rotations so a very tall quad
        trips the same threshold as a very wide one. Tracks without a
        valid reference frame pass through unchanged.
        """
        max_ratio = self.config.ref_max_aspect_ratio
        if max_ratio <= 0:
            return tracks

        accepted: list[TextTrack] = []
        for track in tracks:
            ref_det = track.detections.get(track.reference_frame_idx)
            if ref_det is None:
                accepted.append(track)
                continue
            w_over_h = ref_det.quad.aspect_ratio()
            ratio = max(w_over_h, 1.0 / max(w_over_h, 1e-6))
            if ratio > max_ratio:
                logger.info(
                    "S1: dropping track %d ('%s') — reference aspect "
                    "ratio %.2f:1 > max %.2f:1",
                    track.track_id, track.source_text, ratio, max_ratio,
                )
                continue
            accepted.append(track)

        n_dropped = len(tracks) - len(accepted)
        if n_dropped > 0:
            logger.info(
                "S1: aspect-ratio filter dropped %d / %d tracks",
                n_dropped, len(tracks),
            )
        return accepted

    def filter_tracks_by_top_n_size(
        self,
        tracks: list[TextTrack],
    ) -> list[TextTrack]:
        """Keep only the N tracks with the largest reference bbox area.

        ``N`` comes from ``ref_keep_top_n``. Tracks without a valid
        reference detection are ranked last (size 0) — they survive
        only if fewer than N tracks have a valid reference. Original
        input order is preserved among the kept tracks. 0 or negative
        N disables. ``len(tracks) <= N`` short-circuits.
        """
        top_n = self.config.ref_keep_top_n
        if top_n <= 0 or len(tracks) <= top_n:
            return tracks

        def _size(track: TextTrack) -> int:
            ref_det = track.detections.get(track.reference_frame_idx)
            return ref_det.bbox.area() if ref_det is not None else 0

        # Rank by size desc; break ties by original index so the pick
        # is deterministic.
        indexed = sorted(
            enumerate(tracks),
            key=lambda it: (-_size(it[1]), it[0]),
        )
        keep_idxs = {i for i, _ in indexed[:top_n]}
        kept = [t for i, t in enumerate(tracks) if i in keep_idxs]

        for i, track in enumerate(tracks):
            if i in keep_idxs:
                continue
            logger.info(
                "S1: dropping track %d ('%s') — reference bbox area "
                "%d px² outside top %d",
                track.track_id, track.source_text, _size(track), top_n,
            )

        logger.info(
            "S1: top-N filter dropped %d / %d tracks (keeping top %d)",
            len(tracks) - len(kept), len(tracks), top_n,
        )
        return kept

    # -------------------------
    # Optical flow gap filling
    # -------------------------
    def fill_gaps(
        self,
        tracks: list[TextTrack],
        frames: dict[int, np.ndarray],
    ) -> list[TextTrack]:

        all_frame_idxs = sorted(frames.keys())
        full = self.config.flow_fill_strategy == "full_propagation"

        for track in tracks:
            if track.reference_frame_idx < 0 or not track.detections:
                continue

            ref_idx = track.reference_frame_idx

            tracked_quads = self._track_quad_across_frames(
                track,
                frames,
                all_frame_idxs,
                ref_idx,
                ref_only=full,
            )

            for frame_idx, quad in tracked_quads.items():
                if frame_idx == ref_idx:
                    continue

                existing = track.detections.get(frame_idx)

                if existing is not None and self.config.use_flow_ocr_blend:
                    quad = self._smooth_quad(existing.quad, quad, alpha=0.3)

                quad_points = self._to_np(quad.points)
                filtered_points = quad_points

                if self.config.use_kalman_smoothing:
                    kalman = self._get_kalman(track.track_id)
                    filtered_points = kalman.update(filtered_points)

                if self.config.use_ema_smoothing:
                    filtered_points = self._apply_ema(track.track_id, filtered_points)

                quad = Quad(points=filtered_points)

                # Carry over the full tracked grid (corners + interior)
                # from CoTracker, if present. S2 uses these for robust
                # multi-point homography fitting.
                orig_quad = tracked_quads.get(frame_idx)
                grid_pts = getattr(orig_quad, "_tracked_grid", None) if orig_quad is not None else None

                track.detections[frame_idx] = TextDetection(
                    frame_idx=frame_idx,
                    quad=quad,
                    bbox=quad.to_bbox(),
                    text=track.source_text,
                    ocr_confidence=0.0,
                    tracked_grid_points=grid_pts,
                )

        return tracks

    # -------------------------
    # Optical flow tracking
    # -------------------------
    def _track_quad_across_frames(
        self,
        track: TextTrack,
        frames: dict[int, np.ndarray],
        all_frame_idxs: list[int],
        ref_idx: int,
        ref_only: bool = False,
    ) -> dict[int, Quad]:

        track_frame_idx_start = min(track.detections.keys())
        track_frame_idx_end = max(track.detections.keys())

        if self.config.optical_flow_method == "cotracker":
            ref_det = track.detections.get(ref_idx)
            if ref_det is None:
                return {}

            if self._cotracker is None:
                self._cotracker = CoTrackerFlowTracker(self.config)

            target_frame_idxs = [
                i for i in all_frame_idxs
                if track_frame_idx_start <= i <= track_frame_idx_end
            ]

            grid_size = getattr(self.config, "cotracker_grid_size", 0)
            ref_corners = np.asarray(ref_det.quad.points, dtype=np.float32)
            if grid_size > 0:
                ref_points = generate_quad_grid(ref_corners, grid_size)
            else:
                ref_points = ref_corners

            tracked_points = self._cotracker.track_points_batch(
                frames,
                target_frame_idxs,
                ref_idx,
                ref_points,
            )

            result: dict[int, Quad] = {}
            for idx, pts in tracked_points.items():
                # First 4 rows are always the quad corners
                corners = pts[:4] if isinstance(pts, np.ndarray) else np.array(pts[:4])
                quad = Quad(points=corners.tolist() if isinstance(corners, np.ndarray) else corners)
                result[idx] = quad
                # Store the full grid on the track's detection if it
                # already exists, or mark it for storage later in fill_gaps.
                # We use a transient attribute on the Quad to carry the
                # grid through to fill_gaps where the TextDetection is
                # created. This avoids changing the return type.
                if grid_size > 0 and isinstance(pts, np.ndarray) and pts.shape[0] > 4:
                    quad._tracked_grid = pts.astype(np.float32)  # type: ignore[attr-defined]
            return result

        tracked_quads: dict[int, Quad] = {}

        if ref_only:
            ref_det = track.detections.get(ref_idx)
            if ref_det is not None:
                tracked_quads[ref_idx] = ref_det.quad
        else:
            for idx, det in track.detections.items():
                tracked_quads[idx] = det.quad

        forward_idxs = [
            i for i in all_frame_idxs
            #if i >= ref_idx and track_frame_idx_start <= i <= track_frame_idx_end
        ]
        self._propagate_quads(forward_idxs, frames, tracked_quads)

        backward_idxs = [
            i for i in reversed(all_frame_idxs)
            if i <= ref_idx and track_frame_idx_start <= i <= track_frame_idx_end
        ]
        self._propagate_quads(backward_idxs, frames, tracked_quads)

        return tracked_quads

    def _propagate_quads(
        self,
        ordered_idxs: list[int],
        frames: dict[int, np.ndarray],
        tracked_quads: dict[int, Quad],
    ) -> None:

        for i in range(1, len(ordered_idxs)):
            curr_idx = ordered_idxs[i]
            prev_idx = ordered_idxs[i - 1]

            if curr_idx in tracked_quads:
                continue
            if prev_idx not in tracked_quads:
                continue

            prev_gray = cv2.cvtColor(frames[prev_idx], cv2.COLOR_BGR2GRAY)
            curr_gray = cv2.cvtColor(frames[curr_idx], cv2.COLOR_BGR2GRAY)
            prev_points = tracked_quads[prev_idx].points

            if self.config.optical_flow_method == "farneback":
                new_points = track_points_farneback(
                    prev_gray, curr_gray, prev_points, self.config
                )
            else:
                new_points = track_points_lucas_kanade(
                    prev_gray, curr_gray, prev_points, self.config
                )

            if new_points is not None:
                tracked_quads[curr_idx] = Quad(points=new_points)
