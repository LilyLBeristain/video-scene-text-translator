"""Tests for Stage 2: Frontalization."""

import numpy as np
import pytest

from src.data_types import Quad, TextDetection, TextTrack
from src.stages.s2_frontalization import FrontalizationStage


@pytest.fixture
def frontalization_stage(default_config):
    return FrontalizationStage(default_config)


class TestComputeHomographies:
    def test_sets_canonical_size(self, frontalization_stage):
        """canonical_size should match reference quad dimensions."""
        quad = Quad(points=np.array([
            [100, 100], [300, 100], [300, 200], [100, 200]
        ], dtype=np.float32))
        track = TextTrack(
            track_id=0, source_text="A", target_text="B",
            source_lang="en", target_lang="es",
            detections={
                0: TextDetection(
                    frame_idx=0, quad=quad, bbox=quad.to_bbox(),
                    text="A", ocr_confidence=0.9,
                ),
            },
            reference_frame_idx=0,
        )
        frontalization_stage.compute_homographies(track)
        assert track.canonical_size == (200, 100)

    def test_writes_h_to_detection(self, frontalization_stage):
        """H_to_frontal and H_from_frontal should be set on each detection."""
        quad = Quad(points=np.array([
            [100, 100], [200, 100], [200, 150], [100, 150]
        ], dtype=np.float32))
        track = TextTrack(
            track_id=0, source_text="A", target_text="B",
            source_lang="en", target_lang="es",
            detections={
                0: TextDetection(
                    frame_idx=0, quad=quad, bbox=quad.to_bbox(),
                    text="A", ocr_confidence=0.9,
                ),
            },
            reference_frame_idx=0,
        )
        frontalization_stage.compute_homographies(track)
        det = track.detections[0]
        assert det.H_to_frontal is not None
        assert det.H_from_frontal is not None
        assert det.homography_valid is True

    def test_rect_quad_maps_to_canonical(self, frontalization_stage):
        """An axis-aligned rect quad should map to origin-based canonical."""
        quad = Quad(points=np.array([
            [100, 100], [300, 100], [300, 200], [100, 200]
        ], dtype=np.float32))
        track = TextTrack(
            track_id=0, source_text="A", target_text="B",
            source_lang="en", target_lang="es",
            detections={
                0: TextDetection(
                    frame_idx=0, quad=quad, bbox=quad.to_bbox(),
                    text="A", ocr_confidence=0.9,
                ),
            },
            reference_frame_idx=0,
        )
        frontalization_stage.compute_homographies(track)
        det = track.detections[0]
        # Warping quad corners through H_to_frontal should give canonical rect
        from src.utils.geometry import warp_points
        warped = warp_points(quad.points, det.H_to_frontal)
        expected = np.array([[0, 0], [200, 0], [200, 100], [0, 100]],
                            dtype=np.float32)
        np.testing.assert_allclose(warped, expected, atol=1.0)

    def test_shifted_quad_valid_homography(self, frontalization_stage):
        """A shifted quad should produce valid homography to canonical."""
        ref_quad = Quad(points=np.array([
            [100, 100], [200, 100], [200, 150], [100, 150]
        ], dtype=np.float32))
        shifted_quad = Quad(points=np.array([
            [110, 110], [210, 110], [210, 160], [110, 160]
        ], dtype=np.float32))
        track = TextTrack(
            track_id=0, source_text="A", target_text="B",
            source_lang="en", target_lang="es",
            detections={
                0: TextDetection(
                    frame_idx=0, quad=ref_quad, bbox=ref_quad.to_bbox(),
                    text="A", ocr_confidence=0.9,
                ),
                1: TextDetection(
                    frame_idx=1, quad=shifted_quad, bbox=shifted_quad.to_bbox(),
                    text="A", ocr_confidence=0.9,
                ),
            },
            reference_frame_idx=0,
        )
        frontalization_stage.compute_homographies(track)
        # Both frames should have valid homographies
        assert track.detections[0].homography_valid
        assert track.detections[1].homography_valid
        # Both should map to the same canonical size
        assert track.canonical_size == (100, 50)

    def test_skips_track_without_reference_quad(self, frontalization_stage):
        """Track without reference_quad should be skipped."""
        track = TextTrack(
            track_id=0, source_text="A", target_text="B",
            source_lang="en", target_lang="es",
            detections={},
        )
        frontalization_stage.compute_homographies(track)
        assert track.canonical_size is None

    def test_degenerate_quad_skipped(self, frontalization_stage):
        """Track with degenerate reference quad should be skipped."""
        degenerate = Quad(points=np.array([
            [0, 0], [0.5, 0], [0.5, 50], [0, 50]
        ], dtype=np.float32))
        det = TextDetection(
            frame_idx=0, quad=degenerate, bbox=degenerate.to_bbox(),
            text="A", ocr_confidence=0.9,
        )
        track = TextTrack(
            track_id=0, source_text="A", target_text="B",
            source_lang="en", target_lang="es",
            detections={0: det},
            reference_frame_idx=0,
        )
        frontalization_stage.compute_homographies(track)
        assert track.canonical_size is None


class TestFrontalizationRun:
    def test_run_populates_homographies(self, frontalization_stage):
        """run() should populate homography fields on all detections."""
        quad = Quad(points=np.array([
            [100, 100], [200, 100], [200, 150], [100, 150]
        ], dtype=np.float32))
        track = TextTrack(
            track_id=0, source_text="A", target_text="B",
            source_lang="en", target_lang="es",
            detections={
                0: TextDetection(
                    frame_idx=0, quad=quad, bbox=quad.to_bbox(),
                    text="A", ocr_confidence=0.9,
                ),
            },
            reference_frame_idx=0,
        )
        result = frontalization_stage.run([track])
        assert len(result) == 1
        assert result[0].detections[0].homography_valid
        assert result[0].canonical_size is not None
