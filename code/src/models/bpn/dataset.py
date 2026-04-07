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

import numpy as np
import torch
from torch.utils.data import Dataset
from torchvision.transforms import functional as TF
from PIL import Image
from tqdm import tqdm


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
        cache_in_ram: bool = False,
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
            cache_in_ram: If True, load and transform all images into RAM
                during __init__. Eliminates disk I/O during training.
        """
        super().__init__()
        self.n_neighbors = n_neighbors
        self.image_size = image_size
        self.window = n_neighbors + 1  # total frames needed per sample
        self.cache_in_ram = cache_in_ram

        # Discover tracks — initially stores paths
        self.samples: list[tuple[list, int]] = []
        # Parallel list of track IDs (one per sample), preserved across cache conversion
        self.sample_track_ids: list[str] = []
        self._build_samples(data_root, video_indices, max_tracks_per_video,
                            min_track_length, stride, seed)

        # Optionally cache all images in a single contiguous numpy array.
        # This avoids CoW issues with forked workers: one big memory block
        # with no per-element Python objects, so workers can read without
        # triggering refcount writes.
        # At 64x128x3 uint8 = 24 KB/img, ~87 GB for 3.5M images.
        self._image_data: np.ndarray | None = None  # (N_unique, H, W, 3) uint8
        if cache_in_ram:
            self._preload_cache()

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
                track_id = str(tdir)
                for start in range(0, len(frames) - self.window + 1, stride):
                    self.samples.append((frame_paths, start))
                    self.sample_track_ids.append(track_id)

    def _preload_cache(self):
        """Decode, resize, and pack all images into one contiguous numpy array.

        Stores a single (N_unique, H, W, 3) uint8 array instead of millions of
        small Python objects. Workers forked by DataLoader share this via CoW
        with minimal page faults since reads are pure C-level array indexing
        with no Python refcount mutations.

        Also converts sample path lists to integer index lists so __getitem__
        does zero dict lookups.
        """
        # Collect all unique paths referenced by samples
        unique_paths: set[str] = set()
        for frame_paths, start in self.samples:
            for p in frame_paths[start:start + self.window]:
                unique_paths.add(p)

        sorted_paths = sorted(unique_paths)
        path_to_idx = {p: i for i, p in enumerate(sorted_paths)}
        n_unique = len(sorted_paths)
        H, W = self.image_size

        # Allocate single contiguous array
        print(f"Caching {n_unique} images (decoded {H}x{W} uint8) into RAM...")
        self._image_data = np.empty((n_unique, H, W, 3), dtype=np.uint8)
        for i, p in enumerate(tqdm(sorted_paths, desc="Loading into RAM", unit="img")):
            img = Image.open(p).convert("RGB")
            img = img.resize((W, H), Image.BILINEAR)
            self._image_data[i] = np.array(img)
        total_gb = self._image_data.nbytes / 1e9
        print(f"Cache complete ({n_unique} images, {total_gb:.1f} GB)")

        # Convert samples from (path_list, start) to (index_array, start)
        # so __getitem__ uses integer indexing into the contiguous array.
        # Only convert the window slice that's actually used per sample.
        new_samples = []
        for frame_paths, start in self.samples:
            window_indices = [
                path_to_idx[frame_paths[start + i]]
                for i in range(self.window)
            ]
            new_samples.append(np.array(window_indices, dtype=np.int32))
        self.samples = new_samples

    def _load_image(self, key: int | str) -> torch.Tensor:
        if self.cache_in_ram:
            # Pure C-level array read -> tensor, no Python object overhead
            return torch.from_numpy(
                self._image_data[key].copy()
            ).permute(2, 0, 1).float().div_(255.0)
        img = Image.open(key).convert("RGB")
        img = img.resize((self.image_size[1], self.image_size[0]), Image.BILINEAR)
        return torch.from_numpy(np.array(img)).permute(2, 0, 1).float().div_(255.0)

    def get_track_window(self, sample_idx: int, num_targets: int) -> tuple[torch.Tensor, torch.Tensor]:
        """Return (ref, targets) tensors from the same track as sample_idx.

        ref: (3, H, W) — first frame of the sample's window (the reference)
        targets: (T, 3, H, W) where T <= num_targets — consecutive frames
                 from the same track immediately following the reference

        Used by evaluation to visualize many target frames at once. The model
        can still only process n_neighbors targets per forward pass; callers
        should run it in sliding chunks.
        """
        track_id = self.sample_track_ids[sample_idx]

        # Collect all unique frame keys belonging to this track, in order
        if self.cache_in_ram:
            # Each sample is an int index array; flatten + dedupe across all
            # samples sharing the same track_id
            seen: set[int] = set()
            ordered: list[int] = []
            for i, tid in enumerate(self.sample_track_ids):
                if tid != track_id:
                    continue
                for k in self.samples[i]:
                    ki = int(k)
                    if ki not in seen:
                        seen.add(ki)
                        ordered.append(ki)
            ordered.sort()  # contiguous integer range within a track
            # Reference = first frame of the requested sample
            ref_key = int(self.samples[sample_idx][0])
        else:
            # Non-cached: samples are (frame_paths, start). All samples in a
            # track share the same frame_paths list, so just grab it once.
            frame_paths, start = self.samples[sample_idx]
            ordered = list(frame_paths)  # already sorted by build order
            ref_key = frame_paths[start]

        # Find ref position in ordered list, then take up to num_targets after
        ref_pos = ordered.index(ref_key)
        target_keys = ordered[ref_pos + 1 : ref_pos + 1 + num_targets]

        ref = self._load_image(ref_key)
        targets = torch.stack([self._load_image(k) for k in target_keys]) \
                  if target_keys else torch.empty(0, 3, *self.image_size)
        return ref, targets

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, idx: int) -> dict[str, torch.Tensor]:
        """Returns a dict with:
            images: (3*(N+1), H, W) concatenated ref + neighbor ROIs
            ref_image: (3, H, W) reference ROI (for loss computation)
            neighbor_images: (N, 3, H, W) neighbor ROIs
        """
        sample = self.samples[idx]
        if self.cache_in_ram:
            # sample is np.array of integer indices
            imgs = [self._load_image(int(i)) for i in sample]
        else:
            # sample is (frame_paths, start)
            frame_paths, start = sample
            window_paths = frame_paths[start:start + self.window]
            imgs = [self._load_image(p) for p in window_paths]

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
    cache_in_ram: bool = False,
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
        cache_in_ram=cache_in_ram,
    )
    val_ds = BPNDataset(
        data_root, n_neighbors=n_neighbors, image_size=image_size,
        video_indices=video_indices_val,
        max_tracks_per_video=max_tracks_per_video_val,
        seed=seed,
        cache_in_ram=cache_in_ram,
    )

    # With cache_in_ram, data is in a single contiguous numpy array — safe for
    # forked workers (pure C-level reads, no Python refcount CoW issues).
    persistent = num_workers > 0
    train_loader = torch.utils.data.DataLoader(
        train_ds, batch_size=batch_size, shuffle=True,
        num_workers=num_workers, pin_memory=True, drop_last=True,
        persistent_workers=persistent, prefetch_factor=4 if persistent else None,
    )
    val_loader = torch.utils.data.DataLoader(
        val_ds, batch_size=batch_size, shuffle=False,
        num_workers=num_workers, pin_memory=True,
        persistent_workers=persistent, prefetch_factor=4 if persistent else None,
    )

    return train_loader, val_loader
