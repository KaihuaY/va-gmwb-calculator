"""
Core GMWB projection engine: single-scenario and full Monte Carlo simulation.

Projection logic per time step t (annual or sub-annual):
  1. Apply GBM investment return to AV
  2. Deduct rider fee (% of BB) and M&E fee (% of AV)
  3. Compute guaranteed annual withdrawal (GAW = BB × withdrawal_rate × dt × utilization)
  4. Pay withdrawal (min of GAW and AV); recognize GMWB claim if AV < GAW
  5. At each anniversary: apply roll-up to BB; ratchet BB to AV if step-up enabled
  6. Accumulate PV(claims) and PV(fees) weighted by persistency and discount factors
"""

from dataclasses import dataclass
from typing import Optional

import numpy as np

from .mortality import compute_survival_probs, compute_persistency
from .stochastic import make_rng, generate_gbm_returns
from .utils import compute_discount_factors, compute_stats, compute_histogram


@dataclass
class SimulationParams:
    # Policyholder
    current_age: int = 65
    gender: str = "male"
    max_age: int = 100
    mortality_table: str = "2012iam"
    mort_multiplier: float = 1.0

    # Contract
    account_value: float = 500_000.0
    benefit_base: float = 500_000.0
    withdrawal_rate: float = 0.05
    rider_fee: float = 0.01
    me_fee: float = 0.014
    rollup_rate: float = 0.0
    step_up: bool = False

    # Economic
    mu: float = 0.07
    sigma: float = 0.18
    discount_rate: float = 0.04
    frequency: str = "annual"  # 'annual' or 'monthly'

    # Behavioral
    lapse_rate: float = 0.03
    benefit_utilization: float = 1.0

    # Simulation
    num_scenarios: int = 1000
    seed: Optional[int] = 42


def _run_all_scenarios(
    params: SimulationParams,
    returns: np.ndarray,          # shape (n_scenarios, total_periods)
    persistency: list[float],
    discount_factors: list[float],
    projection_years: int,
    periods_per_year: int,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """
    Vectorised-friendly scenario runner.

    Runs each scenario independently in a Python loop (scenarios are independent).
    NumPy is used for the return matrix generation; the projection loop itself
    is kept readable/auditable.

    Returns:
        claims, fees, nets: 1-D arrays of shape (n_scenarios,)
        av_paths: 2-D array of shape (n_scenarios, projection_years + 1)
    """
    n = params.num_scenarios
    dt = 1.0 / periods_per_year
    total_periods = projection_years * periods_per_year

    claims_arr = np.zeros(n)
    fees_arr = np.zeros(n)
    av_paths = np.zeros((n, projection_years + 1))

    for i in range(n):
        av = params.account_value
        bb = params.benefit_base
        av_paths[i, 0] = av

        total_claim_pv = 0.0
        total_fee_pv = 0.0
        period_in_year = 0

        for p in range(1, total_periods + 1):
            t_years = p * dt
            year_idx = min(int(t_years), projection_years)
            annual_idx = min(year_idx, len(persistency) - 1)
            persist_f = persistency[annual_idx]
            disc_f = discount_factors[annual_idx]

            # 1. Investment return
            ret_factor = returns[i, p - 1]
            av *= ret_factor

            # 2. Fees
            rider_fee_p = params.rider_fee * bb * dt
            base_fee_p = params.me_fee * av * dt
            av = max(0.0, av - rider_fee_p - base_fee_p)

            # 3. Withdrawal
            gaw = bb * params.withdrawal_rate * dt * params.benefit_utilization
            av_before = av
            actual_withdrawal = min(gaw, av)
            av = max(0.0, av - actual_withdrawal)

            # 4. GMWB claim (insurer covers shortfall)
            claim = max(0.0, gaw - av_before)

            # 5. Anniversary updates
            period_in_year += 1
            if period_in_year >= periods_per_year:
                period_in_year = 0
                if params.rollup_rate > 0:
                    bb = bb * (1.0 + params.rollup_rate)
                if params.step_up and av > bb:
                    bb = av
                if year_idx <= projection_years:
                    av_paths[i, year_idx] = av

            # 6. Accumulate PV
            total_claim_pv += claim * persist_f * disc_f
            total_fee_pv += rider_fee_p * persist_f * disc_f

        claims_arr[i] = total_claim_pv
        fees_arr[i] = total_fee_pv

    nets_arr = claims_arr - fees_arr
    return claims_arr, fees_arr, nets_arr, av_paths


def run_simulation(params: SimulationParams) -> dict:
    """
    Run the full Monte Carlo simulation and return aggregated results.

    Args:
        params: SimulationParams dataclass with all assumptions.

    Returns:
        Dict with keys:
          - claim_stats, fee_stats, net_stats: descriptive statistics dicts
          - av_bands: list of per-year percentile bands for the fan chart
          - histogram: binned distribution of PV(claims)
          - survival_probs: list of cumulative survival probabilities
          - persistency: list of in-force persistency factors
          - num_scenarios: int
          - projection_years: int
    """
    base_year = 2026
    projection_years = params.max_age - params.current_age
    periods_per_year = 12 if params.frequency == "monthly" else 1
    dt = 1.0 / periods_per_year
    total_periods = projection_years * periods_per_year

    # Pre-compute mortality, persistency, discount factors
    survival_probs = compute_survival_probs(
        params.current_age, params.gender, base_year,
        params.max_age, params.mort_multiplier, params.mortality_table,
    )
    persistency = compute_persistency(survival_probs, params.lapse_rate)
    discount_factors = compute_discount_factors(params.discount_rate, projection_years + 1)

    # Generate all return factors at once (vectorised)
    rng = make_rng(params.seed)
    returns = generate_gbm_returns(
        params.mu, params.sigma, dt,
        total_periods, params.num_scenarios, rng,
    )

    # Run scenarios
    claims, fees, nets, av_paths = _run_all_scenarios(
        params, returns, persistency, discount_factors,
        projection_years, periods_per_year,
    )

    # AV percentile bands for fan chart
    av_bands = []
    for y in range(projection_years + 1):
        col = av_paths[:, y]
        av_bands.append({
            "year": y,
            "age": params.current_age + y,
            "mean": float(np.mean(col)),
            "p5": float(np.percentile(col, 5)),
            "p25": float(np.percentile(col, 25)),
            "median": float(np.percentile(col, 50)),
            "p75": float(np.percentile(col, 75)),
            "p95": float(np.percentile(col, 95)),
        })

    return {
        "claim_stats": compute_stats(claims),
        "fee_stats": compute_stats(fees),
        "net_stats": compute_stats(nets),
        "av_bands": av_bands,
        "histogram": compute_histogram(claims),
        "survival_probs": survival_probs,
        "persistency": persistency,
        "num_scenarios": params.num_scenarios,
        "projection_years": projection_years,
    }
