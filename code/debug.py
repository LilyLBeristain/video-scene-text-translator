import cv2
import sys
import inspect
from types import SimpleNamespace
import logging
import os
import numpy as np

# =======================
# PATH DEL REPO
# =======================
REPO_PATH = "/content/video-scene-text-translator"
sys.path.append(os.path.join(REPO_PATH, "code"))

# =======================
# IMPORTS
# =======================
from src.stages.s1_detection.stage import DetectionStage

# =======================
# DEBUG LOGGER (opcional)
# =======================
logging.getLogger("src.stages.s1_detection.tracker").setLevel(logging.DEBUG)

# =======================
# HARDCODED ARGUMENTS
# =======================
INPUT_VIDEO = "../Chili.mp4"
OUTPUT_VIDEO = "./output.mp4"
CONFIG_PATH = os.path.join(REPO_PATH, "config/adv.yaml")

# =======================
# CONFIG
# =======================
def build_config():
    config = SimpleNamespace(
        detection=SimpleNamespace(
            ocr_backend="paddleocr",
            ocr_languages=["en"],
            ocr_confidence_threshold=0.3,
            min_text_area=100,

            weight_ocr_confidence=1.0,
            weight_sharpness=0.5,
            weight_contrast=0.5,
            weight_frontality=0.5,

            word_whitelist=None,
            frame_sample_rate=1,

            ref_ocr_min_confidence=0.5,
            ref_sharpness_top_k=3,
            ref_weight_contrast=0.7,
            ref_weight_frontality=0.3,

            track_break_threshold=5,

            optical_flow_method="farneback",
            flow_fill_strategy="none",
        ),

        translation=SimpleNamespace(
            backend="deep-translator",
            source_lang="en",
            target_lang="es",
        ),
    )

    flow_defaults = {
        "farneback_pyr_scale": 0.5,
        "farneback_levels": 3,
        "farneback_winsize": 15,
        "farneback_iterations": 3,
        "farneback_poly_n": 5,
        "farneback_poly_sigma": 1.2,
        "farneback_flags": 0,
    }

    for k, v in flow_defaults.items():
        setattr(config.detection, k, v)

    for k, v in flow_defaults.items():
        setattr(config, k, v)

    return config


# =======================
# DRAW QUAD FUNCTION
# =======================
def draw_quad(frame, det, color=(0, 255, 0)):
    """
    Draw OCR quad (polygon) instead of bbox.
    """
    pts = np.array(det.quad.points, dtype=np.int32)

    # Draw polygon
    cv2.polylines(frame, [pts], isClosed=True, color=color, thickness=2)

    # Put text near first point
    x, y = pts[0]
    label = det.text if det.text else "text"

    cv2.putText(
        frame,
        label,
        (int(x), int(y) - 5),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.5,
        color,
        1,
        cv2.LINE_AA,
    )

    return frame


# =======================
# MAIN
# =======================
def main():
    config = build_config()

    # =======================
    # LOAD VIDEO
    # =======================
    cap = cv2.VideoCapture(INPUT_VIDEO)
    frames = []

    frame_idx = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        frames.append((frame_idx, frame))
        frame_idx += 1

    cap.release()

    print(f"Loaded {len(frames)} frames")

    # =======================
    # RUN STAGE 1
    # =======================
    stage1 = DetectionStage(config)

    print("Running Stage 1...")
    tracks = stage1.run(frames)

    print(f"\nGenerated {len(tracks)} tracks\n")

    # =======================
    # MAP FRAMES
    # =======================
    frame_dict = {idx: frame.copy() for idx, frame in frames}

    # =======================
    # DRAW QUADS
    # =======================
    for track in tracks:
        for frame_idx, det in track.detections.items():
            if frame_idx in frame_dict:
                frame_dict[frame_idx] = draw_quad(frame_dict[frame_idx], det)

    # =======================
    # SAVE VIDEO
    # =======================
    h, w, _ = frames[0][1].shape
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    out = cv2.VideoWriter(OUTPUT_VIDEO, fourcc, 30, (w, h))

    for idx in sorted(frame_dict.keys()):
        out.write(frame_dict[idx])

    out.release()

    # =======================
    # DEBUG OUTPUT
    # =======================
    for t in tracks:
        print(f"\n=== Track {t.track_id} ===")
        print("Text:", t.source_text)
        print("Translated:", t.target_text)
        print("Reference frame:", t.reference_frame_idx)

        print("Detections:")
        for frame_idx, det in sorted(t.detections.items()):
            print(f"  Frame {frame_idx} -> {det.text}")

    print("\nOutput video path:", OUTPUT_VIDEO)
    print("Config path:", CONFIG_PATH)


if __name__ == "__main__":
    main()