"""
Utility functions: discount factors, descriptive statistics, histogram binning.
"""

import math
import numpy as np


def compute_discount_factors(rate: float, n: int) -> list[float]:
    """
    Compute annual discount factors v^t for t = 0, 1, ..., n-1.

    Args:
        rate: Annual risk-free discount rate.
        n: Number of periods (including t=0).

    Returns:
        List of length n where element t = (1 / (1 + rate))^t.
    """
    v = 1.0 / (1.0 + rate)
    return [math.pow(v, t) for t in range(n)]


def compute_stats(arr: np.ndarray) -> dict:
    """
    Compute descriptive statistics for a 1-D array of scenario values.

    Args:
        arr: 1-D numpy array of floats.

    Returns:
        Dict with keys: mean, std_dev, median, p5, p25, p75, p95.
    """
    return {
        "mean": float(np.mean(arr)),
        "std_dev": float(np.std(arr)),
        "median": float(np.percentile(arr, 50)),
        "p5": float(np.percentile(arr, 5)),
        "p25": float(np.percentile(arr, 25)),
        "p75": float(np.percentile(arr, 75)),
        "p95": float(np.percentile(arr, 95)),
    }


def compute_histogram(arr: np.ndarray, bin_count: int = 30) -> list[dict]:
    """
    Compute a histogram for the given array.

    Args:
        arr: 1-D numpy array of values.
        bin_count: Number of bins.

    Returns:
        List of dicts with keys: bin_start, bin_end, label, count.
        Bin range spans the 5th–95th percentile (±20%) to avoid outlier distortion.
    """
    p5 = float(np.percentile(arr, 5))
    p95 = float(np.percentile(arr, 95))
    lo = p5 * 0.8
    hi = (p95 * 1.2) if p95 != 0 else 1.0
    if hi <= lo:
        hi = lo + 1.0

    edges = np.linspace(lo, hi, bin_count + 1)
    counts, _ = np.histogram(arr, bins=edges)

    bins = []
    for i in range(bin_count):
        mid = (edges[i] + edges[i + 1]) / 2
        label = f"${mid / 1000:.0f}K" if abs(mid) < 1e6 else f"${mid / 1e6:.2f}M"
        bins.append({
            "bin_start": float(edges[i]),
            "bin_end": float(edges[i + 1]),
            "label": label,
            "count": int(counts[i]),
        })
    return bins
