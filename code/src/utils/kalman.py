from __future__ import annotations

import numpy as np


class Kalman2D:
    """
    Simple Kalman Filter for 2D points with constant velocity model.
    State: [x, y, vx, vy]
    """

    def __init__(self):
        # State vector [x, y, vx, vy]
        self.x = np.zeros((4, 1), dtype=np.float32)

        # State covariance
        self.P = np.eye(4, dtype=np.float32)

        # State transition matrix
        self.dt = 1.0
        self.F = np.array([
            [1, 0, self.dt, 0],
            [0, 1, 0, self.dt],
            [0, 0, 1, 0],
            [0, 0, 0, 1],
        ], dtype=np.float32)

        # Measurement matrix
        self.H = np.array([
            [1, 0, 0, 0],
            [0, 1, 0, 0],
        ], dtype=np.float32)

        # Noise parameters (TUNED FOR FLUID VIDEO TRACKING)
        self.process_noise = 5e-3   # antes: 1e-2
        self.measurement_noise = 3e-2  # antes: 5e-2

        # Process noise covariance
        self.Q = np.eye(4, dtype=np.float32) * self.process_noise

        # Measurement noise covariance
        self.R = np.eye(2, dtype=np.float32) * self.measurement_noise

        self.initialized = False

    def predict(self):
        self.x = self.F @ self.x
        self.P = self.F @ self.P @ self.F.T + self.Q

    def update(self, z: np.ndarray):
        """
        z: measurement [x, y]
        """
        if not self.initialized:
            self.x[0:2] = z.reshape(2, 1)
            self.initialized = True
            return self.x[0:2].flatten()

        # Predict
        self.predict()

        # Update
        z = z.reshape(2, 1)

        y = z - (self.H @ self.x)
        S = self.H @ self.P @ self.H.T + self.R
        K = self.P @ self.H.T @ np.linalg.inv(S)

        self.x = self.x + K @ y
        self.P = (np.eye(4) - K @ self.H) @ self.P

        return self.x[0:2].flatten()


class QuadKalmanFilter:
    """
    Kalman filter applied independently to each point of a quad (4 points).
    """

    def __init__(self):
        self.filters = [Kalman2D() for _ in range(4)]

    def reset(self):
        self.filters = [Kalman2D() for _ in range(4)]

    def update(self, quad_points: np.ndarray) -> np.ndarray:
        """
        quad_points: shape (4, 2)
        """
        quad_points = np.asarray(quad_points, dtype=np.float32)

        if quad_points.shape != (4, 2):
            raise ValueError("Quad must have shape (4,2)")

        filtered = []

        for i in range(4):
            pt = quad_points[i]
            f = self.filters[i]
            new_pt = f.update(pt)
            filtered.append(new_pt)

        return np.array(filtered, dtype=np.float32)