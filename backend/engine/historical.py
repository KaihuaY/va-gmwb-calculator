"""
Deterministic single-path projection using historical S&P 500 monthly returns.

Runs the same GMWB/GMDB projection logic as `projection.py`, but feeds in actual
historical returns instead of GBM-sampled returns. Output is a single path
(no percentiles) with year-by-year AV, cumulative withdrawals, total fee/claim
PV, and a depletion flag — what the user sees if they ran the contract through
a specific market period.

Uses the existing mortality / lapse / discount machinery — only the return
stream changes.
"""
import json
from pathlib import Path
from typing import Optional

from .projection import SimulationParams
from .mortality import compute_survival_probs, adjust_lapse_for_itm
from .utils import compute_discount_factors


_DATA_PATH = Path(__file__).parent.parent / "data" / "sp500_monthly_returns.json"
_CACHE: Optional[list] = None


def _load_monthly_returns() -> list[tuple[str, float]]:
    global _CACHE
    if _CACHE is None:
        with _DATA_PATH.open() as f:
            data = json.load(f)
        _CACHE = [(m["month"], float(m["return"])) for m in data["months"]]
    return _CACHE


def list_available_window() -> dict:
    """Return the first/last month available for the scenario picker."""
    months = _load_monthly_returns()
    return {"first_month": months[0][0], "last_month": months[-1][0], "count": len(months)}


def _resolve_returns(
    start_month: str, total_periods: int, periods_per_year: int
) -> tuple[list[float], list[str]]:
    """
    Return up to `total_periods` (1 + r) factors starting at `start_month`.
    If history runs out, returns however many periods are available.

    For annual frequency, aggregates 12 months into one annual factor.
    """
    monthly = _load_monthly_returns()
    # Find first month >= start_month
    idx = next((i for i, (mo, _) in enumerate(monthly) if mo >= start_month), None)
    if idx is None:
        raise ValueError(f"start_month {start_month!r} is after the available history")

    if periods_per_year == 12:
        slice_ = monthly[idx : idx + total_periods]
        factors = [1.0 + r for _, r in slice_]
        labels = [m for m, _ in slice_]
        return factors, labels

    # Annual aggregation
    factors: list[float] = []
    labels: list[str] = []
    cursor = idx
    for _ in range(total_periods):
        year_slice = monthly[cursor : cursor + 12]
        if len(year_slice) < 12:
            break
        cum = 1.0
        for _, r in year_slice:
            cum *= 1.0 + r
        factors.append(cum)
        labels.append(year_slice[0][0])
        cursor += 12
    return factors, labels


def run_historical(params: SimulationParams, start_month: str) -> dict:
    """
    Single-path deterministic projection using historical returns starting at
    `start_month` (YYYY-MM). Mirrors `_run_all_scenarios` logic for one path.
    """
    base_year = 2026
    projection_years = params.max_age - params.current_age
    periods_per_year = 12 if params.frequency == "monthly" else 1
    dt = 1.0 / periods_per_year
    total_periods = projection_years * periods_per_year
    accum_years = max(0, params.election_age - params.current_age)

    return_factors, period_labels = _resolve_returns(
        start_month, total_periods, periods_per_year
    )
    n_periods = len(return_factors)
    n_years = n_periods // periods_per_year if periods_per_year > 1 else n_periods

    # Mortality and discount machinery (unchanged from Monte Carlo path)
    survival_probs = compute_survival_probs(
        params.current_age, params.gender, base_year,
        params.max_age, params.mort_multiplier, params.mortality_table,
    )
    discount_factors = compute_discount_factors(params.discount_rate, projection_years + 1)

    # Resolve locked-in withdrawal rate (same logic as projection.py)
    if params.withdrawal_rate_bands:
        sorted_bands = sorted(params.withdrawal_rate_bands, key=lambda b: b["min_age"])
        wd_rate_locked = params.withdrawal_rate
        for band in sorted_bands:
            if params.election_age >= band["min_age"]:
                wd_rate_locked = band["rate"]
    else:
        wd_rate_locked = params.withdrawal_rate

    av = params.account_value
    bb = params.benefit_base
    gmdb_bb = params.gmdb_benefit_base

    av_path = [av]
    bb_path = [bb]
    cw_path = [0.0]
    year_labels = [period_labels[0][:4] if period_labels else start_month[:4]]

    total_claim_pv = 0.0
    total_fee_pv = 0.0
    total_gmdb_pv = 0.0
    period_in_year = 0
    running_lapse_factor = 1.0
    running_cw = 0.0
    annual_income_taken = 0.0
    depletion_age: Optional[int] = None

    for p in range(1, n_periods + 1):
        t_years = p * dt
        year_idx = min(int(t_years), projection_years)
        annual_idx = min(year_idx, len(survival_probs) - 1)
        in_accumulation = t_years <= accum_years

        # Lapse
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

        # 1. Investment return (with optional fixed-account blend)
        var_factor = return_factors[p - 1]
        if params.fixed_account_pct > 0.0:
            fixed_factor = 1.0 + params.fixed_account_rate * dt
            blend = (1.0 - params.fixed_account_pct) * var_factor + params.fixed_account_pct * fixed_factor
            av *= blend
        else:
            av *= var_factor

        # 2. Fees
        gmwb_rider_fee_p = params.rider_fee * bb * dt if params.gmwb_enabled else 0.0
        gmdb_rider_fee_p = params.gmdb_rider_fee * av * dt if params.gmdb_enabled else 0.0
        base_fee_p = params.me_fee * av * dt
        av = max(0.0, av - gmwb_rider_fee_p - gmdb_rider_fee_p - base_fee_p)

        # 3. GMWB withdrawal
        if in_accumulation or not params.gmwb_enabled:
            gaw = 0.0
            claim = 0.0
        else:
            gaw = bb * wd_rate_locked * dt * params.benefit_utilization
            av_before = av
            actual_wd = min(gaw, av)
            av = max(0.0, av - actual_wd)
            claim = max(0.0, gaw - av_before)
            annual_income_taken = bb * wd_rate_locked * params.benefit_utilization
            if depletion_age is None and av == 0.0:
                depletion_age = params.current_age + year_idx
        running_cw += gaw

        # 4. Anniversary updates
        period_in_year += 1
        if period_in_year >= periods_per_year:
            period_in_year = 0
            if params.gmwb_enabled:
                if in_accumulation and params.rollup_rate > 0:
                    bb *= 1.0 + params.rollup_rate
                if params.step_up and av > bb:
                    bb = av
            if params.gmdb_enabled:
                if params.gmdb_rollup_rate > 0:
                    gmdb_bb *= 1.0 + params.gmdb_rollup_rate
                if params.gmdb_step_up and av > gmdb_bb:
                    gmdb_bb = av
            av_path.append(av)
            bb_path.append(bb)
            cw_path.append(running_cw)
            # x-axis label: year-of-period
            year_offset = year_idx
            label_idx = min(year_offset * periods_per_year, len(period_labels) - 1) if periods_per_year == 1 else year_offset * periods_per_year
            label_idx = min(label_idx, len(period_labels) - 1)
            year_labels.append(period_labels[label_idx][:4] if period_labels else "")

        # 5. PV accumulation
        total_claim_pv += claim * persist_f * disc_f
        total_fee_pv += (gmwb_rider_fee_p + gmdb_rider_fee_p) * persist_f * disc_f

        if params.gmdb_enabled and av > 0:
            prev_idx = max(0, annual_idx - 1)
            q_annual = max(0.0, survival_probs[prev_idx] - survival_probs[annual_idx])
            prob_dying_period = q_annual * dt * running_lapse_factor
            gmdb_shortfall = max(0.0, gmdb_bb - av)
            total_gmdb_pv += gmdb_shortfall * prob_dying_period * disc_f

    return {
        "av_path": av_path,
        "bb_path": bb_path,
        "cw_path": cw_path,
        "year_labels": year_labels,
        "claim_pv": total_claim_pv,
        "fee_pv": total_fee_pv,
        "gmdb_pv": total_gmdb_pv,
        "net": total_claim_pv + total_gmdb_pv - total_fee_pv,
        "annual_income": annual_income_taken,
        "depletion_age": depletion_age,
        "start_month": start_month,
        "end_month": period_labels[-1] if period_labels else start_month,
        "projection_years": n_years,
        "n_periods": n_periods,
        "history_truncated": n_periods < total_periods,
    }
