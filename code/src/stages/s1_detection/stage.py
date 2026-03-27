"""Stage 1: Detection & Selection orchestrator.

Detects text ROIs in video frames, performs OCR, translates text,
groups detections into tracks, selects reference frames, and fills
gaps via optical flow.
"""

from __future__ import annotations

import logging

import numpy as np

from src.config import PipelineConfig
from src.data_types import TextDetection, TextTrack
from src.stages.s1_detection.detector import TextDetector
from src.stages.s1_detection.selector import ReferenceSelector
from src.stages.s1_detection.tracker import TextTracker

logger = logging.getLogger(__name__)


class DetectionStage:
    """Orchestrates S1: detect -> group -> translate -> select -> fill gaps."""

    def __init__(self, config: PipelineConfig):
        self.config = config.detection
        self.detector = TextDetector(config.detection)
        self.tracker = TextTracker(config.detection)
        self.selector = ReferenceSelector(config.detection, config.translation)
        self.translation_config = config.translation

    def run(
        self, frames: list[tuple[int, np.ndarray]]
    ) -> list[TextTrack]:
        """Full S1: detect -> group -> translate -> select -> fill gaps."""
        logger.info("S1: Starting detection on %d frames", len(frames))
        sample_rate = self.config.frame_sample_rate
        all_detections: dict[int, list[TextDetection]] = {}

        for frame_idx, frame in frames:
            if frame_idx % sample_rate != 0:
                continue
            dets = self.detector.detect_text_in_frame(frame, frame_idx)
            if dets:
                all_detections[frame_idx] = dets
            logger.debug("S1: Frame %d -> %d detections", frame_idx, len(dets))

        tracks = self.tracker.group_detections_into_tracks(
            all_detections,
            self.selector.translate_text,
            source_lang=self.translation_config.source_lang,
            target_lang=self.translation_config.target_lang,
        )
        tracks = self.selector.select_reference_frames(tracks)

        # Update source/target text from reference frame's OCR (more reliable)
        for track in tracks:
            ref_det = track.detections.get(track.reference_frame_idx)
            if ref_det is not None and ref_det.text != track.source_text:
                logger.debug(
                    "Track %d: updating text '%s' -> '%s' (from reference frame)",
                    track.track_id, track.source_text, ref_det.text,
                )
                track.source_text = ref_det.text
                try:
                    track.target_text = self.selector.translate_text(ref_det.text)
                except Exception:
                    logger.warning(
                        "Track %d: re-translation failed, keeping original",
                        track.track_id,
                    )

        # Fill gaps via optical flow
        frames_dict = {idx: f for idx, f in frames}
        tracks = self.tracker.fill_gaps(tracks, frames_dict)

        logger.info("S1: Found %d text tracks", len(tracks))
        return tracks
