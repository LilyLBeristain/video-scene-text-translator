"""Geometry utilities: homography computation, quad metrics, point warping."""

from __future__ import annotations

import cv2
import numpy as np

from src.data_types import Quad


def _to_np(points) -> np.ndarray:
    """Convert input points (list or ndarray) to numpy float32 array."""
    return np.asarray(points, dtype=np.float32)


def compute_homography(
    src_points,
    dst_points,
    method: str = "RANSAC",
    ransac_threshold: float = 5.0,
) -> tuple[np.ndarray | None, np.ndarray | None, bool]:
    """Compute homography from src_points to dst_points.

    Args:
        src_points: (N, 2) source points (list or ndarray).
        dst_points: (N, 2) destination points (list or ndarray).
        method: "RANSAC" or "LMEDS".
        ransac_threshold: Reprojection threshold for RANSAC.

    Returns:
        (H_forward, H_inverse, is_valid)
    """
    if len(src_points) < 4 or len(dst_points) < 4:
        return None, None, False

    cv_method = cv2.RANSAC if method == "RANSAC" else cv2.LMEDS

    H_forward, mask = cv2.findHomography(
        _to_np(src_points),
        _to_np(dst_points),
        cv_method,
        ransac_threshold,
    )

    if H_forward is None:
        return None, None, False

    if mask is not None and mask.sum() < 4:
        return None, None, False

    try:
        H_inverse = np.linalg.inv(H_forward)
    except np.linalg.LinAlgError:
        return None, None, False

    return H_forward, H_inverse, True


def quad_frontality_score(quad: Quad) -> float:
    """Estimate how frontal (rectangular) a text quad is."""
    pts = _to_np(quad.points)

    top = np.linalg.norm(pts[1] - pts[0])
    bottom = np.linalg.norm(pts[2] - pts[3])
    left = np.linalg.norm(pts[3] - pts[0])
    right = np.linalg.norm(pts[2] - pts[1])

    h_ratio = min(top, bottom) / max(top, bottom, 1e-6)
    v_ratio = min(left, right) / max(left, right, 1e-6)
    side_score = (h_ratio + v_ratio) / 2

    diag1 = pts[2] - pts[0]
    diag2 = pts[3] - pts[1]

    cos_angle = abs(np.dot(diag1, diag2)) / (
        np.linalg.norm(diag1) * np.linalg.norm(diag2) + 1e-6
    )
    angle_score = 1.0 - cos_angle

    return float(np.clip(0.6 * side_score + 0.4 * angle_score, 0, 1))


def quad_area(quad: Quad) -> float:
    """Compute the area of a quad using the Shoelace formula."""
    pts = _to_np(quad.points)
    n = len(pts)

    area = 0.0
    for i in range(n):
        j = (i + 1) % n
        area += pts[i, 0] * pts[j, 1]
        area -= pts[j, 0] * pts[i, 1]

    return abs(area) / 2.0


def quad_bbox_area_ratio(quad: Quad) -> float:
    """Compute frontality as the ratio of quad area to its bounding box area."""
    q_area = quad_area(quad)
    bbox = quad.to_bbox()
    bbox_area = bbox.area()

    if bbox_area < 1:
        return 0.0

    return float(np.clip(q_area / bbox_area, 0, 1))


def canonical_rect_from_quad(quad: Quad) -> tuple[np.ndarray, tuple[int, int]]:
    """Derive a canonical frontal rectangle from a quad's dimensions."""
    pts = _to_np(quad.points)

    top_w = float(np.linalg.norm(pts[1] - pts[0]))
    bot_w = float(np.linalg.norm(pts[2] - pts[3]))
    left_h = float(np.linalg.norm(pts[3] - pts[0]))
    right_h = float(np.linalg.norm(pts[2] - pts[1]))

    w = (top_w + bot_w) / 2
    h = (left_h + right_h) / 2

    if w < 1 or h < 1:
        raise ValueError(
            f"Degenerate quad: average width={w:.1f}, height={h:.1f}"
        )

    w_int = max(1, round(w))
    h_int = max(1, round(h))

    rect = np.array(
        [[0, 0], [w_int, 0], [w_int, h_int], [0, h_int]],
        dtype=np.float32,
    )

    return rect, (w_int, h_int)


def warp_points(points, H: np.ndarray) -> np.ndarray:
    """Apply homography H to a set of 2D points."""
    pts = _to_np(points).reshape(-1, 1, 2)
    warped = cv2.perspectiveTransform(pts, H)
    return warped.reshape(-1, 2)