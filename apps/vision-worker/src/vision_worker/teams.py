"""Team assignment by jersey colour.

1. Per detection: mean CIE-Lab colour of the torso crop, with grass-green pixels masked out.
2. Per track: median of its per-detection colours (robust to occlusion frames).
3. k-means (k=2) over track colours, weighted by how long each track was seen.
4. Outliers (referees, goalkeepers, mis-detections) are rejected by distance to the nearest
   centroid, relative to centroid separation and to the robust spread of the cluster.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

import numpy as np


def torso_color(image: np.ndarray, xyxy: np.ndarray) -> np.ndarray | None:
    """Mean Lab colour of the torso region of a person box (None if crop is degenerate).

    Torso ≈ 15-50% of box height, central 50% of width: skips head, shorts, socks and
    most background.
    """
    import cv2

    h_img, w_img = image.shape[:2]
    x1, y1, x2, y2 = (float(v) for v in xyxy)
    bw, bh = x2 - x1, y2 - y1
    if bw < 4 or bh < 8:
        return None
    cx1 = int(max(0, x1 + 0.25 * bw))
    cx2 = int(min(w_img, x2 - 0.25 * bw))
    cy1 = int(max(0, y1 + 0.15 * bh))
    cy2 = int(min(h_img, y1 + 0.50 * bh))
    if cx2 - cx1 < 2 or cy2 - cy1 < 2:
        return None
    crop = image[cy1:cy2, cx1:cx2]
    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
    # OpenCV hue is 0..179: green grass ≈ 35..85 with decent saturation.
    grass = (hsv[..., 0] >= 35) & (hsv[..., 0] <= 85) & (hsv[..., 1] >= 50)
    lab = cv2.cvtColor(crop, cv2.COLOR_BGR2LAB).reshape(-1, 3).astype(np.float32)
    keep = ~grass.reshape(-1)
    pixels = lab[keep] if keep.sum() >= 0.2 * keep.size else lab
    return pixels.mean(axis=0)


@dataclass(frozen=True)
class TeamAssignment:
    labels: dict[int, int]  # track id -> cluster 0/1 (outliers absent)
    centroids: np.ndarray  # (2, 3)
    outliers: frozenset[int]


def assign_teams(
    track_colors: Mapping[int, np.ndarray],
    track_weights: Mapping[int, float] | None = None,
    separation_ratio: float = 0.45,
    mad_k: float = 3.5,
    seed: int = 0,
) -> TeamAssignment:
    """Cluster track colours into two teams and flag outliers.

    A track is an outlier if its distance to the nearest centroid exceeds
    ``separation_ratio`` x centroid separation, or ``median + mad_k * 1.4826 * MAD`` of all
    nearest-centroid distances.
    """
    ids = sorted(track_colors)
    if not ids:
        return TeamAssignment({}, np.zeros((2, 3), dtype=np.float32), frozenset())
    x = np.stack([np.asarray(track_colors[i], dtype=np.float64) for i in ids])
    if len(ids) < 2:
        return TeamAssignment({ids[0]: 0}, np.stack([x[0], x[0]]), frozenset())

    from sklearn.cluster import KMeans

    w = np.array([float((track_weights or {}).get(i, 1.0)) for i in ids])
    km = KMeans(n_clusters=2, n_init=10, random_state=seed).fit(x, sample_weight=w)
    centroids = km.cluster_centers_
    dist = np.linalg.norm(x[:, None, :] - centroids[None, :, :], axis=2)
    nearest = dist.argmin(axis=1)
    d_near = dist[np.arange(len(ids)), nearest]
    sep = float(np.linalg.norm(centroids[0] - centroids[1]))

    med = float(np.median(d_near))
    mad = float(np.median(np.abs(d_near - med)))
    robust_thr = med + mad_k * 1.4826 * mad if mad > 1e-6 else np.inf
    sep_thr = separation_ratio * sep if sep > 1e-6 else np.inf
    is_out = (d_near > sep_thr) | (d_near > robust_thr)

    labels = {tid: int(nearest[k]) for k, tid in enumerate(ids) if not is_out[k]}
    outliers = frozenset(tid for k, tid in enumerate(ids) if is_out[k])
    return TeamAssignment(labels, centroids.astype(np.float32), outliers)


def home_cluster(centroids: np.ndarray, home_kit: str = "darker") -> int:
    """Which cluster is the home side. Colour alone can't tell home from away, so this is a
    configurable convention (Lab L* = lightness). See README "Limitations"."""
    darker = int(np.argmin(centroids[:, 0]))
    return darker if home_kit == "darker" else 1 - darker
