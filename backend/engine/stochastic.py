"""
Stochastic return generation using Geometric Brownian Motion (GBM).

The equity return model is Black-Scholes GBM:
    r_t = exp((μ − ½σ²)Δt + σ√Δt · Z_t) − 1    where Z_t ~ N(0,1)

A seeded deterministic RNG (Mulberry32) is used for reproducibility.
For large scenario counts, numpy's vectorized Generator is used for speed.
"""

import math
import numpy as np
from numpy.random import Generator, SFC64


def make_rng(seed: int | None) -> Generator:
    """
    Create a seeded numpy random Generator.

    Args:
        seed: Integer seed for reproducibility. If None, uses a random seed.

    Returns:
        numpy Generator backed by SFC64 (fast, high-quality).
    """
    return Generator(SFC64(seed if seed is not None else 42))


def generate_gbm_returns(
    mu: float,
    sigma: float,
    dt: float,
    n_periods: int,
    n_scenarios: int,
    rng: Generator,
) -> np.ndarray:
    """
    Generate a matrix of GBM return factors.

    Args:
        mu: Expected annual return (drift).
        sigma: Annual volatility.
        dt: Time step in years (1/12 for monthly, 1 for annual).
        n_periods: Number of time periods per scenario.
        n_scenarios: Number of Monte Carlo scenarios.
        rng: Seeded numpy Generator.

    Returns:
        ndarray of shape (n_scenarios, n_periods) with multiplicative return
        factors (i.e., 1 + r_t, so multiply AV by these directly).
    """
    drift = (mu - 0.5 * sigma * sigma) * dt
    vol = sigma * math.sqrt(dt)
    z = rng.standard_normal((n_scenarios, n_periods))
    return np.exp(drift + vol * z)
