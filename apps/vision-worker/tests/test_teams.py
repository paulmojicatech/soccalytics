import cv2
import numpy as np

from vision_worker.teams import assign_teams, home_cluster, torso_color


def _lab(bgr: tuple[int, int, int]) -> np.ndarray:
    px = np.array([[bgr]], dtype=np.uint8)
    return cv2.cvtColor(px, cv2.COLOR_BGR2LAB).reshape(3).astype(np.float32)


def test_kmeans_splits_two_kits_and_rejects_referee():
    rng = np.random.default_rng(42)
    red, white, yellow = _lab((30, 30, 200)), _lab((235, 235, 235)), _lab((0, 230, 230))
    colors: dict[int, np.ndarray] = {}
    for i in range(10):
        colors[i] = red + rng.normal(0, 3, 3)
    for i in range(10, 20):
        colors[i] = white + rng.normal(0, 3, 3)
    colors[99] = yellow  # referee
    res = assign_teams(colors)

    assert 99 in res.outliers and 99 not in res.labels
    red_labels = {res.labels[i] for i in range(10)}
    white_labels = {res.labels[i] for i in range(10, 20)}
    assert len(red_labels) == 1 and len(white_labels) == 1
    assert red_labels != white_labels


def test_home_cluster_convention():
    centroids = np.array([[200.0, 128, 128], [60.0, 150, 160]])  # L*: light, dark
    assert home_cluster(centroids, "darker") == 1
    assert home_cluster(centroids, "lighter") == 0


def test_degenerate_inputs():
    assert assign_teams({}).labels == {}
    assert assign_teams({7: np.array([1.0, 2, 3])}).labels == {7: 0}


def test_torso_color_ignores_grass():
    img = np.zeros((200, 200, 3), dtype=np.uint8)
    img[:] = (40, 160, 40)  # grass green (BGR)
    img[40:110, 70:130] = (30, 30, 200)  # red shirt in the torso region
    c = torso_color(img, np.array([50, 20, 150, 200]))
    assert c is not None
    np.testing.assert_allclose(c, _lab((30, 30, 200)), atol=3)
    assert torso_color(img, np.array([0, 0, 2, 2])) is None
