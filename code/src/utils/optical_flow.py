"""Optical flow tracking utilities for quad point propagation."""

from __future__ import annotations

import logging

import cv2
import numpy as np

logger = logging.getLogger(__name__)


def track_points_farneback(
    prev_gray: np.ndarray,
    curr_gray: np.ndarray,
    prev_points: np.ndarray,
    config,
) -> np.ndarray | None:
    """Track points using Farneback dense optical flow.

    Computes a dense flow field, then samples at quad corner locations.

    Args:
        prev_gray: Previous frame (grayscale, uint8).
        curr_gray: Current frame (grayscale, uint8).
        prev_points: (N, 2) points to track, (x, y) format.
        config: DetectionConfig with Farneback parameters.

    Returns:
        (N, 2) tracked points, or None if tracking failed.
    """
    flow = cv2.calcOpticalFlowFarneback(
        prev_gray,
        curr_gray,
        None,
        pyr_scale=config.farneback_pyr_scale,
        levels=config.farneback_levels,
        winsize=config.farneback_winsize,
        iterations=config.farneback_iterations,
        poly_n=config.farneback_poly_n,
        poly_sigma=config.farneback_poly_sigma,
        flags=0,
    )

    h, w = prev_gray.shape
    new_points = []
    for pt in prev_points:
        x = int(np.clip(round(pt[0]), 0, w - 1))
        y = int(np.clip(round(pt[1]), 0, h - 1))
        dx, dy = flow[y, x]
        new_points.append([pt[0] + dx, pt[1] + dy])

    return np.array(new_points, dtype=np.float32)


def track_points_lucas_kanade(
    prev_gray: np.ndarray,
    curr_gray: np.ndarray,
    prev_points: np.ndarray,
    config,
) -> np.ndarray | None:
    """Track points using Lucas-Kanade sparse optical flow.

    Directly tracks individual points — efficient for 4 corner points.

    Args:
        prev_gray: Previous frame (grayscale, uint8).
        curr_gray: Current frame (grayscale, uint8).
        prev_points: (N, 2) points to track.
        config: DetectionConfig with LK parameters.

    Returns:
        (N, 2) tracked points, or None if any point lost track.
    """
    pts = prev_points.reshape(-1, 1, 2).astype(np.float32)

    lk_params = dict(
        winSize=tuple(config.lk_win_size),
        maxLevel=config.lk_max_level,
        criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 30, 0.01),
    )

    next_pts, status, _err = cv2.calcOpticalFlowPyrLK(
        prev_gray, curr_gray, pts, None, **lk_params
    )

    if next_pts is None or status is None:
        return None

    if not np.all(status):
        return None

    return next_pts.reshape(-1, 2)


class CoTrackerFlowTracker:
    """Batch point tracker using Meta's CoTracker3.

    Unlike pairwise methods, CoTracker processes the entire video at once
    and tracks query points across all frames simultaneously.
    """

    def __init__(self, config):
        self.config = config
        self._model = None

    def _init_model(self):
        if self._model is not None:
            return
        import torch
        from cotracker.predictor import CoTrackerPredictor

        device = (
            "cuda" if torch.cuda.is_available()
            else "mps" if torch.backends.mps.is_available()
            else "cpu"
        )
        self._model = CoTrackerPredictor(
            checkpoint=self.config.cotracker_checkpoint,
            v2=False,
            offline=True,
            window_len=self.config.cotracker_window_len,
        ).to(device)
        self._device = device
        logger.info("CoTracker3 initialized on %s", device)

    def track_points_batch(
        self,
        frames: dict[int, np.ndarray],
        all_frame_idxs: list[int],
        ref_idx: int,
        ref_points: np.ndarray,
    ) -> dict[int, np.ndarray]:
        """Track points from a reference frame to all frames in one shot.

        Args:
            frames: frame_idx -> BGR image array.
            all_frame_idxs: sorted list of all frame indices.
            ref_idx: index of the reference frame.
            ref_points: (N, 2) query points in (x, y) pixel coords.

        Returns:
            dict mapping frame_idx -> (N, 2) tracked points.
        """
        import torch

        self._init_model()

        # Build video tensor: (1, T, C, H, W) in RGB
        video_frames = []
        for idx in all_frame_idxs:
            frame_rgb = cv2.cvtColor(frames[idx], cv2.COLOR_BGR2RGB)
            video_frames.append(frame_rgb)
        video = (
            torch.tensor(np.stack(video_frames))
            .permute(0, 3, 1, 2)  # T C H W
            .unsqueeze(0)         # 1 T C H W
            .float()
            .to(self._device)
        )

        # Build queries: (1, N, 3) with format (t, x, y)
        t_in_video = all_frame_idxs.index(ref_idx)
        n_points = ref_points.shape[0]
        queries = torch.zeros(1, n_points, 3, device=self._device)
        queries[0, :, 0] = t_in_video
        queries[0, :, 1] = torch.tensor(ref_points[:, 0], dtype=torch.float32)
        queries[0, :, 2] = torch.tensor(ref_points[:, 1], dtype=torch.float32)

        pred_tracks, pred_visibility = self._model(
            video, queries=queries, backward_tracking=True,
        )
        # pred_tracks: (1, T, N, 2), pred_visibility: (1, T, N)

        tracks_np = pred_tracks[0].cpu().numpy()      # (T, N, 2)
        vis_np = pred_visibility[0].cpu().numpy()      # (T, N)

        result: dict[int, np.ndarray] = {}
        for t, frame_idx in enumerate(all_frame_idxs):
            # Always use CoTracker's predicted positions, even when some
            # points are marked as not-visible. CoTracker predicts through
            # occlusion via temporal attention — the positions are often
            # still accurate. Dropping these frames causes fallback to OCR
            # quads (which only cover the visible text portion) and is the
            # root cause of the "ROI shrinks near occlusion" artifact.
            result[frame_idx] = tracks_np[t].astype(np.float32)
            if not vis_np[t].all():
                n_occluded = int((~vis_np[t]).sum())
                logger.debug(
                    "CoTracker: frame %d has %d/%d occluded points "
                    "(positions kept)",
                    frame_idx, n_occluded, vis_np[t].shape[0],
                )

        return result
