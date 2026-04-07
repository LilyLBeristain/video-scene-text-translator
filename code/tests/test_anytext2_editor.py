"""Tests for AnyText2Editor (mocked — no server needed)."""

from __future__ import annotations

import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import cv2
import numpy as np
import pytest

from src.config import TextEditorConfig
from src.models.anytext2_editor import AnyText2Editor


@pytest.fixture
def editor_config() -> TextEditorConfig:
    return TextEditorConfig(
        backend="anytext2",
        server_url="http://fake-server:7860/",
        server_timeout=10,
        anytext2_ddim_steps=5,
        anytext2_cfg_scale=7.5,
        anytext2_strength=1.0,
        anytext2_img_count=1,
    )


@pytest.fixture
def editor(editor_config: TextEditorConfig) -> AnyText2Editor:
    return AnyText2Editor(editor_config)


class TestColorExtraction:
    def test_dark_text_on_light_bg(self):
        """Dark text on a white background should extract a dark color."""
        img = np.full((100, 200, 3), 240, dtype=np.uint8)  # light bg
        # Draw dark text-like pixels in center
        img[25:75, 50:150] = 30
        color = AnyText2Editor._extract_text_color(img)
        # Should be a dark color (low RGB values)
        assert color.startswith("#")
        assert len(color) == 7
        r = int(color[1:3], 16)
        g = int(color[3:5], 16)
        b = int(color[5:7], 16)
        assert r < 100 and g < 100 and b < 100

    def test_light_text_on_dark_bg(self):
        """Light text on a dark background should extract a light color."""
        img = np.full((100, 200, 3), 20, dtype=np.uint8)  # dark bg
        img[25:75, 50:150] = 220  # light text
        color = AnyText2Editor._extract_text_color(img)
        r = int(color[1:3], 16)
        g = int(color[3:5], 16)
        b = int(color[5:7], 16)
        assert r > 150 and g > 150 and b > 150

    def test_tiny_image_returns_black(self):
        """Very small image where interior is empty should return black."""
        img = np.zeros((4, 4, 3), dtype=np.uint8)
        color = AnyText2Editor._extract_text_color(img)
        assert color == "#000000"

    def test_hex_format(self):
        """Color should always be a valid 7-char hex string."""
        img = np.random.randint(0, 256, (80, 160, 3), dtype=np.uint8)
        color = AnyText2Editor._extract_text_color(img)
        assert color.startswith("#")
        assert len(color) == 7
        # Should be parseable
        int(color[1:], 16)


class TestClampDimensions:
    def test_within_bounds_unchanged(self):
        """Image already within [256, 1024] should not be resized."""
        img = np.zeros((300, 500, 3), dtype=np.uint8)
        result = AnyText2Editor._clamp_dimensions(img)
        assert result.shape == (300, 500, 3)

    def test_too_large_scaled_down(self):
        """Image wider than 1024 should be scaled down."""
        img = np.zeros((600, 2000, 3), dtype=np.uint8)
        result = AnyText2Editor._clamp_dimensions(img)
        assert result.shape[1] <= 1024
        assert result.shape[0] <= 1024

    def test_too_small_padded_up(self):
        """Image smaller than 256 should be padded to reach minimum."""
        img = np.zeros((50, 100, 3), dtype=np.uint8)
        result = AnyText2Editor._clamp_dimensions(img)
        assert result.shape[0] >= 256 and result.shape[1] >= 256

    def test_aspect_ratio_preserved_for_extreme(self):
        """Very wide image should use padding, not distortion."""
        img = np.zeros((30, 800, 3), dtype=np.uint8)
        result = AnyText2Editor._clamp_dimensions(img)
        # Width should scale down to 1024, height scales proportionally
        # then gets padded to 256. Aspect ratio of the content is preserved.
        assert result.shape[1] <= 1024
        assert result.shape[0] >= 256


class TestEdgeCase:
    def test_empty_roi_returns_as_is(self, editor: AnyText2Editor):
        roi = np.array([], dtype=np.uint8).reshape(0, 0, 3)
        result = editor.edit_text(roi, "TEST")
        assert result.size == 0

    def test_tiny_roi_returns_as_is(self, editor: AnyText2Editor):
        roi = np.zeros((3, 3, 3), dtype=np.uint8)
        result = editor.edit_text(roi, "TEST")
        assert result.shape == (3, 3, 3)

    def test_no_server_url_raises(self):
        config = TextEditorConfig(backend="anytext2", server_url=None)
        editor = AnyText2Editor(config)
        with pytest.raises(ValueError, match="server_url"):
            editor._get_client()


def _make_mock_handle_file():
    """Create a mock handle_file that returns the path string as-is."""
    return lambda path: path


class TestGradioCall:
    @patch("src.models.anytext2_editor.AnyText2Editor._get_client")
    @patch.dict("sys.modules", {"gradio_client": MagicMock(handle_file=_make_mock_handle_file())})
    def test_edit_text_calls_predict(self, mock_get_client, editor: AnyText2Editor):
        """edit_text should call the Gradio submit endpoint."""
        with tempfile.TemporaryDirectory() as tmpdir:
            fake_result_path = str(Path(tmpdir) / "result.png")
            fake_img = np.full((300, 500, 3), 128, dtype=np.uint8)
            cv2.imwrite(fake_result_path, fake_img)

            mock_client = MagicMock()
            mock_job = MagicMock()
            mock_job.result.return_value = (
                [{"image": fake_result_path}],
                "debug info",
            )
            mock_client.submit.return_value = mock_job
            mock_get_client.return_value = mock_client

            roi = np.full((300, 500, 3), 200, dtype=np.uint8)
            result = editor.edit_text(roi, "HOLA")

            # Verify submit was called with /process_1
            mock_client.submit.assert_called_once()
            call_kwargs = mock_client.submit.call_args
            assert call_kwargs.kwargs.get("api_name") == "/process_1"
            assert call_kwargs.kwargs.get("text_prompt") == '"HOLA"'

            # Result should match original dimensions
            assert result.shape == (300, 500, 3)

    @patch("src.models.anytext2_editor.AnyText2Editor._get_client")
    @patch.dict("sys.modules", {"gradio_client": MagicMock(handle_file=_make_mock_handle_file())})
    def test_empty_gallery_raises(self, mock_get_client, editor: AnyText2Editor):
        """Empty gallery response should raise RuntimeError."""
        mock_client = MagicMock()
        mock_job = MagicMock()
        mock_job.result.return_value = ([], "error info")
        mock_client.submit.return_value = mock_job
        mock_get_client.return_value = mock_client

        roi = np.full((300, 500, 3), 200, dtype=np.uint8)
        with pytest.raises(RuntimeError, match="empty gallery"):
            editor.edit_text(roi, "FAIL")

    @patch("src.models.anytext2_editor.AnyText2Editor._get_client")
    @patch.dict("sys.modules", {"gradio_client": MagicMock(handle_file=_make_mock_handle_file())})
    def test_result_resized_to_original(self, mock_get_client, editor: AnyText2Editor):
        """If ROI was clamped, result should be resized back to original dims."""
        with tempfile.TemporaryDirectory() as tmpdir:
            fake_result_path = str(Path(tmpdir) / "result.png")
            fake_img = np.full((256, 256, 3), 128, dtype=np.uint8)
            cv2.imwrite(fake_result_path, fake_img)

            mock_client = MagicMock()
            mock_job = MagicMock()
            mock_job.result.return_value = (
                [{"image": fake_result_path}],
                "",
            )
            mock_client.submit.return_value = mock_job
            mock_get_client.return_value = mock_client

            roi = np.full((50, 100, 3), 200, dtype=np.uint8)
            result = editor.edit_text(roi, "SMALL")

            assert result.shape == (50, 100, 3)


class TestParseResult:
    def test_unexpected_gallery_format_raises(self, editor: AnyText2Editor):
        """Gallery with unexpected entry format should raise RuntimeError."""
        with pytest.raises(RuntimeError, match="Unexpected gallery format"):
            editor._parse_result(([{"not_image": "value"}], "debug"))

    def test_failed_image_read_raises(self, editor: AnyText2Editor):
        """Gallery pointing to non-existent file should raise RuntimeError."""
        with pytest.raises(RuntimeError, match="Failed to read"):
            editor._parse_result(
                ([{"image": "/nonexistent/file.png"}], "debug")
            )


class TestConnectionError:
    @patch.dict("sys.modules", {"gradio_client": MagicMock()})
    def test_connection_error_wraps(self):
        """Failed connection should raise ConnectionError with clear message."""
        import sys
        mock_gc = sys.modules["gradio_client"]
        mock_gc.Client.side_effect = Exception("Connection refused")

        config = TextEditorConfig(
            backend="anytext2", server_url="http://bad-host:9999/"
        )
        ed = AnyText2Editor(config)
        with pytest.raises(ConnectionError, match="Cannot connect"):
            ed._get_client()


class TestConfigValidation:
    def test_anytext2_without_url_fails_validation(self):
        """Pipeline config with anytext2 backend but no URL should fail."""
        from src.config import PipelineConfig

        config = PipelineConfig()
        config.text_editor.backend = "anytext2"
        config.text_editor.server_url = None
        config.input_video = "test.mp4"
        config.output_video = "out.mp4"
        errors = config.validate()
        assert any("server_url" in e for e in errors)

    def test_anytext2_with_url_passes_validation(self):
        """Pipeline config with anytext2 backend and URL should pass."""
        from src.config import PipelineConfig

        config = PipelineConfig()
        config.text_editor.backend = "anytext2"
        config.text_editor.server_url = "http://localhost:45843/"
        config.input_video = "test.mp4"
        config.output_video = "out.mp4"
        errors = config.validate()
        assert not any("server_url" in e for e in errors)


class TestS3Integration:
    def test_anytext2_backend_init(self):
        """S3 stage should create AnyText2Editor when backend is 'anytext2'."""
        from src.config import PipelineConfig
        from src.stages.s3_text_editing import TextEditingStage

        config = PipelineConfig()
        config.text_editor.backend = "anytext2"
        config.text_editor.server_url = "http://fake:7860/"
        stage = TextEditingStage(config)

        # _init_editor should create an AnyText2Editor (won't connect yet — lazy)
        editor = stage._init_editor()
        assert isinstance(editor, AnyText2Editor)
