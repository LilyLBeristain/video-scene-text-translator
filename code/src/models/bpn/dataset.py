"""Dataset for BPN training: loads sequences of aligned ROI images from tracks.

Dataset structure:
    tpm_dataset/
        roi_extraction_robo_video_N/
            track_XX_TEXT/
                frame_XXXXXX.png
                ...

Each track contains frontalized text ROIs from consecutive video frames.
BPN training tuples: (reference_frame, neighbor_1, ..., neighbor_N).
"""

import os
import random
from pathlib import Path

import torch
from torch.utils.data import Dataset
from torchvision import transforms
from PIL import Image


class BPNDataset(Dataset):
    """Dataset yielding (ref + N neighbors) ROI tuples from video tracks.

    Supports easy subsetting by video index and max tracks per video.
    """

    def __init__(
        self,
        data_root: str,
        n_neighbors: int = 3,
        image_size: tuple[int, int] = (64, 128),
        video_indices: list[str] | None = None,
        max_tracks_per_video: int | None = None,
        min_track_length: int = 8,
        stride: int = 4,
        seed: int = 42,
    ):
        """
        Args:
            data_root: Path to tpm_dataset/.
            n_neighbors: Number of neighbor frames per sample (N).
            image_size: (H, W) to resize all ROIs to.
            video_indices: Which videos to include by folder name.
                None = all video folders.
            max_tracks_per_video: Limit tracks per video for quick testing.
            min_track_length: Skip tracks shorter than this.
            stride: Step between consecutive samples within a track.
            seed: RNG seed for deterministic track subsampling.
        """
        super().__init__()
        self.n_neighbors = n_neighbors
        self.image_size = image_size
        self.window = n_neighbors + 1  # total frames needed per sample

        self.transform = transforms.Compose([
            transforms.Resize(image_size),
            transforms.ToTensor(),  # -> [0,1] float, (C,H,W)
        ])

        # Discover tracks
        self.samples: list[tuple[list[str], int]] = []
        # Each sample is (sorted_frame_paths, start_index)
        self._build_samples(data_root, video_indices, max_tracks_per_video,
                            min_track_length, stride, seed)

    def _build_samples(self, data_root, video_indices, max_tracks,
                       min_length, stride, seed):
        data_root = Path(data_root)

        # Discover all video directories that contain track_* subdirs
        video_dirs = sorted([
            d for d in data_root.iterdir()
            if d.is_dir() and any(
                sd.is_dir() and sd.name.startswith("track_")
                for sd in d.iterdir()
            )
        ])

        if video_indices is not None:
            allowed = set(video_indices)
            video_dirs = [d for d in video_dirs if d.name in allowed]

        rng = random.Random(seed)

        for vdir in video_dirs:
            track_dirs = sorted([
                d for d in vdir.iterdir()
                if d.is_dir() and d.name.startswith("track_")
            ])

            if max_tracks is not None and len(track_dirs) > max_tracks:
                track_dirs = rng.sample(track_dirs, max_tracks)
                track_dirs.sort()

            for tdir in track_dirs:
                frames = sorted([
                    f for f in tdir.iterdir()
                    if f.suffix in (".png", ".jpg")
                ])
                if len(frames) < max(min_length, self.window):
                    continue

                # Generate samples: sliding window with stride
                frame_paths = [str(f) for f in frames]
                for start in range(0, len(frames) - self.window + 1, stride):
                    self.samples.append((frame_paths, start))

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, idx: int) -> dict[str, torch.Tensor]:
        """Returns a dict with:
            images: (3*(N+1), H, W) concatenated ref + neighbor ROIs
            ref_image: (3, H, W) reference ROI (for loss computation)
            neighbor_images: (N, 3, H, W) neighbor ROIs
        """
        frame_paths, start = self.samples[idx]
        window_paths = frame_paths[start:start + self.window]

        # Load and transform images
        imgs = []
        for p in window_paths:
            img = Image.open(p).convert("RGB")
            imgs.append(self.transform(img))

        # First image is reference, rest are neighbors
        ref = imgs[0]                          # (3, H, W)
        neighbors = torch.stack(imgs[1:])      # (N, 3, H, W)

        # Concatenate all along channel dim for network input
        all_concat = torch.cat(imgs, dim=0)    # (3*(N+1), H, W)

        return {
            "images": all_concat,
            "ref_image": ref,
            "neighbor_images": neighbors,
        }


def create_dataloaders(
    data_root: str,
    n_neighbors: int = 3,
    image_size: tuple[int, int] = (64, 128),
    video_indices_train: list[str] | None = None,
    video_indices_val: list[str] | None = None,
    max_tracks_per_video_train: int | None = None,
    max_tracks_per_video_val: int | None = None,
    batch_size: int = 32,
    num_workers: int = 4,
    seed: int = 42,
) -> tuple:
    """Create train/val dataloaders.

    video_indices_train/val must be provided as lists of folder names.
    Pass None to use all available video folders (not recommended — no split).
    """

    train_ds = BPNDataset(
        data_root, n_neighbors=n_neighbors, image_size=image_size,
        video_indices=video_indices_train,
        max_tracks_per_video=max_tracks_per_video_train,
        seed=seed,
    )
    val_ds = BPNDataset(
        data_root, n_neighbors=n_neighbors, image_size=image_size,
        video_indices=video_indices_val,
        max_tracks_per_video=max_tracks_per_video_val,
        seed=seed,
    )

    train_loader = torch.utils.data.DataLoader(
        train_ds, batch_size=batch_size, shuffle=True,
        num_workers=num_workers, pin_memory=True, drop_last=True,
    )
    val_loader = torch.utils.data.DataLoader(
        val_ds, batch_size=batch_size, shuffle=False,
        num_workers=num_workers, pin_memory=True,
    )

    return train_loader, val_loader
