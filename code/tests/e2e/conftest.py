"""E2E test fixtures: skip when GPU, AnyText2 server, or test video unavailable."""

from __future__ import annotations

import socket
from pathlib import Path
from urllib.parse import urlparse

import pytest
import yaml

# Path to the test video used by e2e tests
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
_TEST_VIDEO = _PROJECT_ROOT / "test_data" / "real_video6.mp4"
_ADV_CONFIG = Path(__file__).resolve().parent.parent.parent / "config" / "adv.yaml"


def _server_reachable(url: str, timeout: float = 3.0) -> bool:
    """Check if a server is reachable via TCP connect."""
    parsed = urlparse(url)
    host = parsed.hostname or "localhost"
    port = parsed.port or 80
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except (OSError, socket.timeout):
        return False


def _get_anytext2_url() -> str:
    """Read AnyText2 server URL from adv.yaml config."""
    if _ADV_CONFIG.exists():
        with open(_ADV_CONFIG) as f:
            cfg = yaml.safe_load(f)
        return cfg.get("text_editor", {}).get("server_url", "")
    return ""


@pytest.fixture(autouse=True)
def require_gpu():
    """Skip e2e tests if no CUDA GPU is available."""
    torch = pytest.importorskip("torch", reason="PyTorch not installed")
    if not torch.cuda.is_available():
        pytest.skip("No CUDA GPU available")


@pytest.fixture(autouse=True)
def require_anytext2_server():
    """Skip e2e tests if AnyText2 server is not reachable."""
    url = _get_anytext2_url()
    if not url:
        pytest.skip("No AnyText2 server_url configured in adv.yaml")
    if not _server_reachable(url):
        pytest.skip(f"AnyText2 server not reachable at {url}")


@pytest.fixture
def test_video_path() -> Path:
    """Path to the real test video, skipping if not found."""
    if not _TEST_VIDEO.exists():
        pytest.skip(f"Test video not found: {_TEST_VIDEO}")
    return _TEST_VIDEO


@pytest.fixture
def adv_config_path() -> Path:
    """Path to adv.yaml config."""
    if not _ADV_CONFIG.exists():
        pytest.skip(f"Config not found: {_ADV_CONFIG}")
    return _ADV_CONFIG
