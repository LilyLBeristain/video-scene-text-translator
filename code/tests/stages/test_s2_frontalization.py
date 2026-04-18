"""Tests for Stage 2: Frontalization."""

import numpy as np
import pytest

from src.data_types import Quad, TextDetection, TextTrack
from src.stages.s2_frontalization import FrontalizationStage


@pytest.fixture
def frontalization_stage(default_config):
    return FrontalizationStage(default_config)


class _FakeRefiner:
    """In-test stand-in for RefinerInference.

    Returns a caller-controlled sequence of ΔH matrices per call, or
    ``None`` to simulate rejection. Also records the inputs it was
    called with so tests can assert e.g. that the reference frame is
    never fed through the refiner.
    """

    def __init__(self, outputs):
        self._outputs = list(outputs)
        self.calls: list[tuple] = []

    def predict_delta_H(self, ref_canonical, target_canonical):
        self.calls.append(
            (ref_canonical.shape, target_canonical.shape)
        )
        if not self._outputs:
            return None
        return self._outputs.pop(0)


def _make_track_two_frames(ref_quad, tgt_quad):
    return TextTrack(
        track_id=0, source_text="A", target_text="B",
        source_lang="en", target_lang="es",
        detections={
            0: TextDetection(
                frame_idx=0, quad=ref_quad, bbox=ref_quad.to_bbox(),
                text="A", ocr_confidence=0.9,
            ),
            1: TextDetection(
                frame_idx=1, quad=tgt_quad, bbox=tgt_quad.to_bbox(),
                text="A", ocr_confidence=0.9,
            ),
        },
        reference_frame_idx=0,
    )


def _dummy_frame(h=200, w=400):
    # Low-entropy textured frame so cv2.warpPerspective produces a
    # non-empty canonical crop without needing real scene content.
    frame = np.full((h, w, 3), 128, dtype=np.uint8)
    frame[::4, :] = 200
    frame[:, ::4] = 80
    return frame


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


class TestRefinerIntegration:
    """Verify the S2 refiner path: ΔH is folded into H_to_frontal.

    Backward-compat: with ``use_refiner=False`` the loop must not
    touch H_to_frontal beyond the existing baseline computation.
    """

    def test_refiner_disabled_no_change(self, default_config):
        """use_refiner=False: pipeline output matches the pre-refiner baseline."""
        assert default_config.frontalization.use_refiner is False
        ref_quad = Quad(points=np.array([
            [100, 100], [200, 100], [200, 150], [100, 150]
        ], dtype=np.float32))
        tgt_quad = Quad(points=np.array([
            [110, 110], [210, 110], [210, 160], [110, 160]
        ], dtype=np.float32))
        track = _make_track_two_frames(ref_quad, tgt_quad)

        stage = FrontalizationStage(default_config)
        # Even when frames are provided, the disabled refiner path must
        # not mutate H_to_frontal.
        frames = {0: _dummy_frame(), 1: _dummy_frame()}
        stage.run([track], frames)

        # Recompute expected baseline.
        baseline = FrontalizationStage(default_config)
        track_baseline = _make_track_two_frames(ref_quad, tgt_quad)
        baseline.run([track_baseline])

        np.testing.assert_allclose(
            track.detections[1].H_to_frontal,
            track_baseline.detections[1].H_to_frontal,
        )
        np.testing.assert_allclose(
            track.detections[1].H_from_frontal,
            track_baseline.detections[1].H_from_frontal,
        )

    def test_refiner_enabled_folds_delta_into_h_to_frontal(self, default_config):
        """H_to_frontal_corrected == inv(ΔH) @ H_to_frontal_unrefined.

        This is the direction pinning test the plan calls out.
        """
        default_config.frontalization.use_refiner = True
        ref_quad = Quad(points=np.array([
            [100, 100], [200, 100], [200, 150], [100, 150]
        ], dtype=np.float32))
        tgt_quad = Quad(points=np.array([
            [110, 110], [210, 110], [210, 160], [110, 160]
        ], dtype=np.float32))

        # Unrefined baseline first (refiner-disabled config).
        default_config.frontalization.use_refiner = False
        unrefined_track = _make_track_two_frames(ref_quad, tgt_quad)
        FrontalizationStage(default_config).run([unrefined_track])
        H_unrefined = unrefined_track.detections[1].H_to_frontal
        assert H_unrefined is not None

        # Now with a fake refiner returning a known ΔH.
        default_config.frontalization.use_refiner = True
        stage = FrontalizationStage(default_config)
        delta_H = np.array([
            [1.0, 0.01, 2.0],
            [0.02, 1.0, -1.0],
            [0.0, 0.0, 1.0],
        ], dtype=np.float64)
        stage._refiner = _FakeRefiner([delta_H])

        track = _make_track_two_frames(ref_quad, tgt_quad)
        frames = {0: _dummy_frame(), 1: _dummy_frame()}
        stage.run([track], frames)

        expected = np.linalg.inv(delta_H) @ H_unrefined
        np.testing.assert_allclose(
            track.detections[1].H_to_frontal, expected, atol=1e-8,
        )
        # And H_from_frontal should be H_from_frontal_unrefined @ ΔH.
        expected_from = unrefined_track.detections[1].H_from_frontal @ delta_H
        np.testing.assert_allclose(
            track.detections[1].H_from_frontal, expected_from, atol=1e-8,
        )

    def test_reference_frame_skipped(self, default_config):
        """The reference frame's homography is never fed through the refiner."""
        default_config.frontalization.use_refiner = True
        ref_quad = Quad(points=np.array([
            [100, 100], [200, 100], [200, 150], [100, 150]
        ], dtype=np.float32))
        tgt_quad = Quad(points=np.array([
            [110, 110], [210, 110], [210, 160], [110, 160]
        ], dtype=np.float32))

        stage = FrontalizationStage(default_config)
        fake = _FakeRefiner([np.eye(3, dtype=np.float64)])
        stage._refiner = fake

        track = _make_track_two_frames(ref_quad, tgt_quad)
        frames = {0: _dummy_frame(), 1: _dummy_frame()}

        # Snapshot reference homography before run.
        stage.run([track], frames)

        # Exactly one refiner call — for frame 1 only.
        assert len(fake.calls) == 1

    def test_refiner_rejection_keeps_unrefined_baseline(self, default_config):
        """When ΔH is None, H_to_frontal stays at the unrefined baseline."""
        default_config.frontalization.use_refiner = False
        ref_quad = Quad(points=np.array([
            [100, 100], [200, 100], [200, 150], [100, 150]
        ], dtype=np.float32))
        tgt_quad = Quad(points=np.array([
            [110, 110], [210, 110], [210, 160], [110, 160]
        ], dtype=np.float32))
        baseline = _make_track_two_frames(ref_quad, tgt_quad)
        FrontalizationStage(default_config).run([baseline])
        baseline_H = baseline.detections[1].H_to_frontal.copy()

        default_config.frontalization.use_refiner = True
        stage = FrontalizationStage(default_config)
        stage._refiner = _FakeRefiner([None])  # simulate rejection

        track = _make_track_two_frames(ref_quad, tgt_quad)
        frames = {0: _dummy_frame(), 1: _dummy_frame()}
        stage.run([track], frames)

        np.testing.assert_allclose(
            track.detections[1].H_to_frontal, baseline_H,
        )

    def test_run_without_frames_skips_refinement(self, default_config):
        """Backward-compat: calling run(tracks) with no frames uses unrefined path.

        Used by the TPM data gen pipeline.
        """
        default_config.frontalization.use_refiner = True
        ref_quad = Quad(points=np.array([
            [100, 100], [200, 100], [200, 150], [100, 150]
        ], dtype=np.float32))
        tgt_quad = Quad(points=np.array([
            [110, 110], [210, 110], [210, 160], [110, 160]
        ], dtype=np.float32))

        stage = FrontalizationStage(default_config)
        fake = _FakeRefiner([np.eye(3, dtype=np.float64)])
        stage._refiner = fake

        track = _make_track_two_frames(ref_quad, tgt_quad)
        # Omit frames — refinement must be silently skipped.
        stage.run([track])

        assert fake.calls == []
        # And the baseline homography is in place.
        assert track.detections[1].homography_valid

    def test_refiner_direction_pinning(self, default_config):
        """Given ΔH, a ref-canonical point maps correctly under H_to_frontal_corrected.

        Construction: put a target quad identical to the reference quad
        (so unrefined H_to_frontal ≈ identity composed with the
        reference's H). A known ΔH maps ref → target canonical. After
        correction, warping a ref-canonical point back through the
        *inverse* of H_to_frontal_corrected should round-trip to the
        original frame-space point. This pins the inv(ΔH) composition
        direction.
        """
        default_config.frontalization.use_refiner = True
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
                1: TextDetection(
                    frame_idx=1, quad=quad, bbox=quad.to_bbox(),
                    text="A", ocr_confidence=0.9,
                ),
            },
            reference_frame_idx=0,
        )

        stage = FrontalizationStage(default_config)
        # ΔH: a pure 3-pixel x-translation in canonical pixel space.
        delta_H = np.array([
            [1.0, 0.0, 3.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
        ], dtype=np.float64)
        stage._refiner = _FakeRefiner([delta_H])

        frames = {0: _dummy_frame(), 1: _dummy_frame()}
        stage.run([track], frames)

        # Pin the derivation:
        #   p_frame → unrefined p_tgt_canonical via H_to_frontal_unrefined
        #   ΔH says ref-canonical p' + 3 = tgt-canonical p'
        #   so H_to_frontal_corrected = inv(ΔH) @ H_to_frontal_unrefined
        # Concretely: a frame-space point that unrefined-maps to canonical
        # (10, 20) should, under the corrected H, map to (7, 20) — shifted
        # left by the 3px ΔH offset.
        from src.utils.geometry import warp_points
        # The unrefined H maps quad.points to the canonical rect. The
        # target quad == reference quad, so that canonical rect starts at
        # (0, 0). Pick a frame-space point inside the quad and see.
        # Midpoint of quad top edge is (200, 100) — frame space.
        pt_frame = np.array([[200.0, 100.0]], dtype=np.float32)
        H_corrected = track.detections[1].H_to_frontal
        warped = warp_points(pt_frame, H_corrected)
        # Under an unrefined identity-equivalent H, this would map to
        # (100, 0) in canonical space. After inv(ΔH)=(-3, 0) translate,
        # the expected point is (100 - 3, 0) = (97, 0).
        np.testing.assert_allclose(warped, [[97.0, 0.0]], atol=1e-5)
