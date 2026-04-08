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

from .mortality import compute_survival_probs, compute_persistency, adjust_lapse_for_itm
from .stochastic import make_rng, generate_gbm_returns
from .utils import compute_discount_factors, compute_stats, compute_histogram


@dataclass
class SimulationParams:
    # Policyholder
    current_age: int = 65
    gender: str = "male"
    max_age: int = 100

    # Contract
    account_value: float = 500_000.0
    gmwb_enabled: bool = True              # Guaranteed Minimum Withdrawal Benefit rider
    benefit_base: float = 500_000.0        # GMWB benefit base (BB)
    election_age: int = 65                 # age at first withdrawal; < current_age treated as current_age
    withdrawal_rate: float = 0.05
    rider_fee: float = 0.01                # GMWB rider fee (% of GMWB BB per year)
    gmdb_enabled: bool = False             # Guaranteed Minimum Death Benefit rider
    gmdb_benefit_base: float = 500_000.0   # GMDB benefit base (often = AV at issue)
    gmdb_rider_fee: float = 0.005          # GMDB rider fee (% of GMDB BB per year)
    gmdb_rollup_rate: float = 0.0          # Annual GMDB BB growth (applies every anniversary)
    gmdb_step_up: bool = False             # GMDB BB ratchets to AV at each anniversary
    me_fee: float = 0.014
    rollup_rate: float = 0.0
    step_up: bool = False

    # Economic
    mu: float = 0.07
    sigma: float = 0.18
    discount_rate: float = 0.04
    frequency: str = "annual"              # 'annual' or 'monthly'
    fixed_account_pct: float = 0.0         # proportion of AV in fixed/guaranteed SA (0–1)
    fixed_account_rate: float = 0.03       # guaranteed annual crediting rate on fixed SA

    # Mortality
    mortality_table: str = "2012iam"
    mort_multiplier: float = 1.0

    # Lapse
    lapse_rate: float = 0.03
    dynamic_lapse: bool = False
    lapse_sensitivity: float = 0.5
    lapse_min_multiplier: float = 0.1

    # Policyholder Behavior
    benefit_utilization: float = 1.0

    # Simulation
    num_scenarios: int = 1000
    seed: Optional[int] = 42


def _run_all_scenarios(
    params: SimulationParams,
    returns: np.ndarray,            # shape (n_scenarios, total_periods)
    survival_probs: list[float],
    discount_factors: list[float],
    projection_years: int,
    periods_per_year: int,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """
    Vectorised-friendly scenario runner.

    Runs each scenario independently in a Python loop (scenarios are independent).
    NumPy is used for the return matrix generation; the projection loop itself
    is kept readable/auditable.

    When dynamic_lapse is True, the lapse rate is adjusted each period based on
    the ITM ratio (BB / AV), so persistency is tracked as a running scalar inside
    each scenario rather than being precomputed.

    Returns:
        claims, fees, nets, gmdb_claims: 1-D arrays of shape (n_scenarios,)
        av_paths: 2-D array of shape (n_scenarios, projection_years + 1)
        cw_paths: 2-D array of shape (n_scenarios, projection_years + 1) — cumulative guaranteed withdrawals
        gmdb_bb_paths: 2-D array of shape (n_scenarios, projection_years + 1) — GMDB benefit base trajectory
    """
    n = params.num_scenarios
    dt = 1.0 / periods_per_year
    total_periods = projection_years * periods_per_year
    accum_years = max(0, params.election_age - params.current_age)

    claims_arr = np.zeros(n)
    fees_arr = np.zeros(n)
    gmdb_arr = np.zeros(n)
    av_paths = np.zeros((n, projection_years + 1))
    cw_paths = np.zeros((n, projection_years + 1))       # cumulative guaranteed withdrawals
    gmdb_bb_paths = np.zeros((n, projection_years + 1))  # GMDB benefit base over time

    for i in range(n):
        av = params.account_value
        bb = params.benefit_base          # GMWB benefit base (may roll-up/step-up)
        gmdb_bb = params.gmdb_benefit_base  # GMDB benefit base (may roll-up/step-up independently)
        av_paths[i, 0] = av
        gmdb_bb_paths[i, 0] = gmdb_bb

        total_claim_pv = 0.0
        total_fee_pv = 0.0
        total_gmdb_pv = 0.0
        period_in_year = 0
        running_lapse_factor = 1.0  # cumulative (1 - lapse_t)^dt product
        running_cw = 0.0            # cumulative guaranteed withdrawals paid this scenario

        for p in range(1, total_periods + 1):
            t_years = p * dt
            year_idx = min(int(t_years), projection_years)
            annual_idx = min(year_idx, len(survival_probs) - 1)
            in_accumulation = t_years <= accum_years

            # Dynamic or static lapse rate for this period
            if params.dynamic_lapse:
                period_lapse = adjust_lapse_for_itm(
                    params.lapse_rate, bb, av,
                    params.lapse_sensitivity, params.lapse_min_multiplier,
                )
            else:
                period_lapse = params.lapse_rate

            running_lapse_factor *= (1.0 - period_lapse) ** dt
            persist_f = survival_probs[annual_idx] * running_lapse_factor
            disc_f = discount_factors[annual_idx]

            # 1. Investment return (blended variable + fixed SA)
            var_factor = returns[i, p - 1]
            if params.fixed_account_pct > 0.0:
                fixed_factor = 1.0 + params.fixed_account_rate * dt
                blend = (1.0 - params.fixed_account_pct) * var_factor + params.fixed_account_pct * fixed_factor
                av *= blend
            else:
                av *= var_factor

            # 2. Fees: rider fee(s) + M&E
            gmwb_rider_fee_p = params.rider_fee * bb * dt if params.gmwb_enabled else 0.0
            gmdb_rider_fee_p = params.gmdb_rider_fee * gmdb_bb * dt if params.gmdb_enabled else 0.0
            base_fee_p = params.me_fee * av * dt
            av = max(0.0, av - gmwb_rider_fee_p - gmdb_rider_fee_p - base_fee_p)

            # 3. GMWB withdrawal (none during accumulation phase or if rider disabled)
            if in_accumulation or not params.gmwb_enabled:
                gaw = 0.0
                claim = 0.0
            else:
                gaw = bb * params.withdrawal_rate * dt * params.benefit_utilization
                av_before = av
                actual_withdrawal = min(gaw, av)
                av = max(0.0, av - actual_withdrawal)
                claim = max(0.0, gaw - av_before)
            running_cw += gaw  # total guaranteed income this scenario (insurer honours full GAW)

            # 4. Anniversary updates
            period_in_year += 1
            if period_in_year >= periods_per_year:
                period_in_year = 0
                # GMWB base updates
                if params.gmwb_enabled:
                    if in_accumulation and params.rollup_rate > 0:
                        bb *= (1.0 + params.rollup_rate)
                    if params.step_up and av > bb:
                        bb = av
                # GMDB base updates (rollup applies every year; step-up anytime)
                if params.gmdb_enabled:
                    if params.gmdb_rollup_rate > 0:
                        gmdb_bb *= (1.0 + params.gmdb_rollup_rate)
                    if params.gmdb_step_up and av > gmdb_bb:
                        gmdb_bb = av
                if year_idx <= projection_years:
                    av_paths[i, year_idx] = av
                    cw_paths[i, year_idx] = running_cw
                    gmdb_bb_paths[i, year_idx] = gmdb_bb

            # 5. Accumulate PV of rider fees (GMWB + GMDB, not M&E)
            total_claim_pv += claim * persist_f * disc_f
            total_fee_pv += (gmwb_rider_fee_p + gmdb_rider_fee_p) * persist_f * disc_f

            # 6. GMDB: max(0, GMDB_BB - AV) paid at death, weighted by prob of dying in period
            if params.gmdb_enabled:
                prev_idx = max(0, annual_idx - 1)
                q_annual = max(0.0, survival_probs[prev_idx] - survival_probs[annual_idx])
                prob_dying_period = q_annual * dt * running_lapse_factor
                gmdb_shortfall = max(0.0, gmdb_bb - av)
                total_gmdb_pv += gmdb_shortfall * prob_dying_period * disc_f

        claims_arr[i] = total_claim_pv
        fees_arr[i] = total_fee_pv
        gmdb_arr[i] = total_gmdb_pv

    nets_arr = claims_arr + gmdb_arr - fees_arr
    return claims_arr, fees_arr, nets_arr, gmdb_arr, av_paths, cw_paths, gmdb_bb_paths


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

    # Run scenarios (pass survival_probs so dynamic lapse can vary per period)
    claims, fees, nets, gmdb_claims, av_paths, cw_paths, gmdb_bb_paths = _run_all_scenarios(
        params, returns, survival_probs, discount_factors,
        projection_years, periods_per_year,
    )

    # Percentile band helper
    def make_bands(paths):
        bands = []
        for y in range(projection_years + 1):
            col = paths[:, y]
            bands.append({
                "year": y,
                "age": params.current_age + y,
                "mean":   float(np.mean(col)),
                "p5":     float(np.percentile(col, 5)),
                "p25":    float(np.percentile(col, 25)),
                "median": float(np.percentile(col, 50)),
                "p75":    float(np.percentile(col, 75)),
                "p95":    float(np.percentile(col, 95)),
            })
        return bands

    return {
        "claim_stats": compute_stats(claims),
        "gmdb_stats": compute_stats(gmdb_claims),
        "fee_stats": compute_stats(fees),
        "net_stats": compute_stats(nets),
        "av_bands": make_bands(av_paths),
        "cw_bands": make_bands(cw_paths),
        "gmdb_bb_bands": make_bands(gmdb_bb_paths),
        "histogram": compute_histogram(claims),
        "survival_probs": survival_probs,
        "persistency": persistency,
        "num_scenarios": params.num_scenarios,
        "projection_years": projection_years,
    }
