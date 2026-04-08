"""Real end-to-end test: full pipeline with GPU, PaddleOCR, CoTracker, AnyText2.

Requires:
  - CUDA GPU
  - AnyText2 server running (URL from adv.yaml)
  - Test video at test_data/real_video6.mp4

Run explicitly: pytest tests/e2e/ -v
Skipped automatically on machines without GPU/server (via e2e/conftest.py).
"""

from __future__ import annotations

import tempfile
from pathlib import Path

import cv2
import numpy as np
import pytest

from src.config import PipelineConfig
from src.pipeline import VideoPipeline


@pytest.mark.gpu
@pytest.mark.network
@pytest.mark.slow
class TestRealPipeline:
    """Full pipeline on a real video with real backends — zero mocks."""

    def test_full_pipeline_produces_output(self, test_video_path, adv_config_path):
        """Pipeline should detect text, translate, edit via AnyText2, and produce output."""
        with tempfile.TemporaryDirectory() as tmpdir:
            output_path = Path(tmpdir) / "output.mp4"

            config = PipelineConfig.from_yaml(str(adv_config_path))
            config.input_video = str(test_video_path)
            config.output_video = str(output_path)
            config.translation.source_lang = "en"
            config.translation.target_lang = "es"

            pipeline = VideoPipeline(config)
            result = pipeline.run()

            # Output video was written
            assert output_path.exists(), "Output video was not created"
            assert output_path.stat().st_size > 0, "Output video is empty"

            # Frame count matches input
            cap = cv2.VideoCapture(str(test_video_path))
            expected_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            cap.release()
            assert len(result.output_frames) == expected_frames

            # Resolution matches input
            cap = cv2.VideoCapture(str(output_path))
            out_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            out_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            cap.release()
            assert result.frame_size == (out_w, out_h)

    def test_detects_at_least_one_track(self, test_video_path, adv_config_path):
        """Pipeline should find at least one text track in the test video."""
        with tempfile.TemporaryDirectory() as tmpdir:
            output_path = Path(tmpdir) / "output.mp4"

            config = PipelineConfig.from_yaml(str(adv_config_path))
            config.input_video = str(test_video_path)
            config.output_video = str(output_path)
            config.translation.source_lang = "en"
            config.translation.target_lang = "es"

            pipeline = VideoPipeline(config)
            result = pipeline.run()

            assert len(result.tracks) >= 1, "No text tracks detected"

            track = result.tracks[0]
            assert track.source_text, "Source text is empty"
            assert track.target_text, "Target text is empty"
            assert track.edited_roi is not None, "Edited ROI was not produced"

    def test_edited_roi_is_not_degenerate(self, test_video_path, adv_config_path):
        """AnyText2 output should not be all-black or uniform color."""
        with tempfile.TemporaryDirectory() as tmpdir:
            output_path = Path(tmpdir) / "output.mp4"

            config = PipelineConfig.from_yaml(str(adv_config_path))
            config.input_video = str(test_video_path)
            config.output_video = str(output_path)
            config.translation.source_lang = "en"
            config.translation.target_lang = "es"

            pipeline = VideoPipeline(config)
            result = pipeline.run()

            assert len(result.tracks) >= 1
            roi = result.tracks[0].edited_roi
            assert roi is not None

            # Not all-black
            assert roi.mean() > 5.0, f"Edited ROI is near-black (mean={roi.mean():.1f})"

            # Not uniform (has texture/variation)
            assert roi.std() > 10.0, f"Edited ROI is near-uniform (std={roi.std():.1f})"

    def test_output_differs_from_input(self, test_video_path, adv_config_path):
        """Output video frames should differ from input (text was replaced)."""
        with tempfile.TemporaryDirectory() as tmpdir:
            output_path = Path(tmpdir) / "output.mp4"

            config = PipelineConfig.from_yaml(str(adv_config_path))
            config.input_video = str(test_video_path)
            config.output_video = str(output_path)
            config.translation.source_lang = "en"
            config.translation.target_lang = "es"

            pipeline = VideoPipeline(config)
            result = pipeline.run()

            # Read a frame from input for comparison
            cap = cv2.VideoCapture(str(test_video_path))
            ret, input_frame = cap.read()
            cap.release()
            assert ret

            output_frame = result.output_frames[0]
            diff = np.abs(input_frame.astype(float) - output_frame.astype(float)).mean()
            assert diff > 0.1, "Output frame is identical to input — nothing was replaced"
