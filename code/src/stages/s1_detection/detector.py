"""Text detection via EasyOCR or PaddleOCR with quality scoring."""

from __future__ import annotations

import logging

import numpy as np

from src.config import DetectionConfig
from src.data_types import Quad, TextDetection
from src.utils.geometry import quad_bbox_area_ratio
from src.utils.image_processing import (
    compute_contrast_otsu,
    compute_sharpness,
)

logger = logging.getLogger(__name__)


class TextDetector:
    """Detects text in frames using EasyOCR or PaddleOCR and computes quality scores."""

    def __init__(self, config: DetectionConfig):
        self.config = config
        self._reader = None  # Lazy-init EasyOCR
        self._paddle_ocr = None  # Lazy-init PaddleOCR

    def _init_easyocr(self):
        if self._reader is None:
            import easyocr
            self._reader = easyocr.Reader(
                self.config.ocr_languages, gpu=True
            )

    def _init_paddleocr(self):
        if self._paddle_ocr is None:
            from paddleocr import PaddleOCR
            lang = self.config.ocr_languages[0] if self.config.ocr_languages else "en"
            self._paddle_ocr = PaddleOCR(
                lang=lang,
                use_doc_orientation_classify=False,
                use_doc_unwarping=False,
                use_textline_orientation=False,
            )
    
    def _filter_detected_texts(self, detections: list[TextDetection]) -> list[TextDetection]:
        """filter out numbers, symbols, or very short texts that are unlikely to be meaningful for translation."""
        from wordfreq import zipf_frequency

        filtered = []
        if self.config.ocr_languages[0].startswith("ch"):
            # For chinese, only filter out digits
            for det in detections:
                text = det.text.strip()
                if text.isdigit():
                    continue
                filtered.append(det)
        else:
            for det in detections:
                text = det.text.strip()
                if len(text) < 2:
                    continue
                if text.isdigit():
                    continue
                if self.config.word_whitelist is not None:
                    words = text.lower().split()
                    if not all(w in self.config.word_whitelist for w in words):
                        logger.debug("Filtered non-whitelisted text: %r", text)
                        continue
                elif not self._is_plausible_text(text, zipf_frequency):
                    logger.debug("Filtered gibberish text: %r", text)
                    continue
                filtered.append(det)
        return filtered

    @staticmethod
    def _is_plausible_text(
        text: str, zipf_frequency, lang: str = "en", threshold: float = 2.0
    ) -> bool:
        """Return True if the average word frequency suggests real language."""
        words = text.lower().split()
        if not words:
            return False
        min_freq = min(zipf_frequency(w, lang) for w in words)
        return min_freq >= threshold

    def detect_text_in_frame(
        self, frame: np.ndarray, frame_idx: int
    ) -> list[TextDetection]:
        """Detect all text regions in a single frame."""
        backend = self.config.ocr_backend
        detection_results = []
        if backend == "easyocr":
            detection_results = self._detect_easyocr(frame, frame_idx)
        elif backend == "paddleocr":
            detection_results = self._detect_paddleocr(frame, frame_idx)
        else:
            raise ValueError(f"Unknown ocr_backend: {backend!r}")

        detection_results = self._filter_detected_texts(detection_results)
        return detection_results

    def _detect_easyocr(
        self, frame: np.ndarray, frame_idx: int
    ) -> list[TextDetection]:
        """Detect text using EasyOCR."""
        self._init_easyocr()
        results = self._reader.readtext(frame)

        detections = []
        for bbox_points, text, confidence in results:
            det = self._build_detection(
                frame, frame_idx,
                points=np.array(bbox_points, dtype=np.float32),
                text=text.strip(),
                confidence=confidence,
            )
            if det is not None:
                detections.append(det)

        return detections

    def _detect_paddleocr(
        self, frame: np.ndarray, frame_idx: int
    ) -> list[TextDetection]:
        """Detect text using PaddleOCR."""
        self._init_paddleocr()
        results = self._paddle_ocr.predict(input=frame)

        detections = []
        for res in results:
            rec_texts = res["rec_texts"]
            rec_polys = res["rec_polys"]
            rec_scores = res["rec_scores"]

            for text, poly, score in zip(rec_texts, rec_polys, rec_scores, strict=False):
                # poly is (4, 2) array with quad corners [TL, TR, BR, BL]
                det = self._build_detection(
                    frame, frame_idx,
                    points=np.array(poly, dtype=np.float32),
                    text=text.strip(),
                    confidence=float(score),
                )
                if det is not None:
                    detections.append(det)

        return detections

    def _build_detection(
        self,
        frame: np.ndarray,
        frame_idx: int,
        points: np.ndarray,
        text: str,
        confidence: float,
    ) -> TextDetection | None:
        """Build a TextDetection from raw OCR output, applying filters and scoring."""
        if confidence < self.config.ocr_confidence_threshold:
            return None

        quad = Quad(points=points)
        bbox = quad.to_bbox()

        if bbox.area() < self.config.min_text_area:
            return None

        roi = frame[bbox.to_slice()]
        if roi.size == 0:
            return None

        detection = TextDetection(
            frame_idx=frame_idx,
            quad=quad,
            bbox=bbox,
            text=text,
            ocr_confidence=confidence,
            sharpness_score=compute_sharpness(roi),
            contrast_score=compute_contrast_otsu(roi),
            frontality_score=quad_bbox_area_ratio(quad),
        )
        detection.composite_score = self.compute_composite_score(detection)
        return detection

    def compute_composite_score(self, det: TextDetection) -> float:
        """Weighted combination of quality metrics for reference selection."""
        return (
            self.config.weight_ocr_confidence * det.ocr_confidence
            + self.config.weight_sharpness * det.sharpness_score
            + self.config.weight_contrast * det.contrast_score
            + self.config.weight_frontality * det.frontality_score
        )
