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

import numpy as np

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


# ---------------------------------------------------------------------------
# Regime backtest — interactive what-if (NOT a composite input)
# ---------------------------------------------------------------------------

def _advance_month(year: int, month: int, delta: int) -> tuple[int, int]:
    """Return the (year, month) `delta` months after (year, month)."""
    idx = (year * 12 + (month - 1)) + delta
    return idx // 12, (idx % 12) + 1


def _slice_monthly(start_month: str, total_months: int) -> tuple[list[tuple[str, float]], bool]:
    """Return up to `total_months` (label, monthly_return) pairs starting at start_month.

    Returns the slice and a flag indicating whether the history ran out.
    """
    monthly = _load_monthly_returns()
    idx = next((i for i, (mo, _) in enumerate(monthly) if mo >= start_month), None)
    if idx is None:
        raise ValueError(f"start_month {start_month!r} is after the available history")
    slice_ = monthly[idx : idx + total_months]
    return slice_, len(slice_) < total_months


def compute_regime_backtest_path(
    product_spec: dict,
    methodology: dict,
    regime_key: str,
    starting_av: Optional[float] = None,
) -> dict:
    """
    Deterministically replay `product_spec` against actual S&P 500 monthly returns
    for the named regime. When `starting_av` is None (default), uses the
    methodology's scoring-scenario premium ($250K) so the backtest matches the
    same dollar basis as the composite rating's PV(rider claims) / PV(fees).
    Pass an explicit `starting_av` to override (e.g. an advisor running with a
    specific client premium).

    The annual crediting math is delegated to `project_rila_path` (the same
    routine the rating engine already uses), which credits each year via the
    annualized cap / buffer mechanic. Within each year, the AV is interpolated
    monthly by scaling the in-year drawdown / recovery shape from the actual
    monthly S&P 500 returns onto the year's reconciled AV endpoints. The
    monthly path therefore reflects real intra-year drawdowns (load-bearing
    for the max-drawdown figure) while the year-end AV values agree exactly
    with what `compute_regime_outcomes` would compute for the same regime.

    Resolution note: per-period RILA crediting is annual (consistent with
    `project_rila_path`). The monthly path is a deterministic interpolation
    of the annual reconciled AV between year boundaries, NOT independent
    per-month crediting. This keeps byte-reproducibility intact and matches
    the rating engine's annual-credit assumption documented in `rila.py`.

    All outputs are deterministic functions of (product_spec, methodology,
    regime_key, starting_av) — no random number generation.
    """
    # Local imports to avoid circulars at module load
    from .rating import product_spec_to_rila
    from .rila import project_rila_path

    regimes_meta = methodology.get("regimes", [])
    regime = next((r for r in regimes_meta if r["key"] == regime_key), None)
    if regime is None:
        raise ValueError(f"unknown regime key: {regime_key!r}")

    scenario = methodology["scoring_scenario"]
    age = scenario["age"]
    election_age = scenario["election_age"]
    requested_years = int(regime["years"])
    start_month = regime["start_month"]
    if starting_av is None:
        starting_av = float(scenario["premium"])

    # Aggregate to annual factors for the RILA crediting engine
    annual_factors, year_start_labels = _resolve_returns(
        start_month=start_month,
        total_periods=requested_years,
        periods_per_year=1,
    )
    actual_years = len(annual_factors)
    history_truncated = actual_years < requested_years

    # Mortality / discount machinery: 50/50 blended-gender cohort, matching
    # the composite scoring scenario (methodology v1.3.0). AV path is
    # mortality-independent so gender choice doesn't move the chart values;
    # using "blend" keeps every scoring path on the same mortality basis.
    survival = compute_survival_probs(
        current_age=age,
        gender="blend",
        base_calendar_year=2026,
        max_age=age + max(1, actual_years),
        multiplier=1.0,
        table_name=scenario["mortality_table"],
    )
    discount = compute_discount_factors(scenario["discount_rate"], max(1, actual_years) + 1)

    rila = product_spec_to_rila(product_spec, float(starting_av))

    if actual_years == 0:
        # Degenerate window — should not happen for the 5 named regimes
        return {
            "regime_key": regime_key,
            "regime_display_name": regime["display_name"],
            "start_month": start_month,
            "years": 0,
            "starting_av": round(float(starting_av), 2),
            "av_path": [{"month": start_month, "av": round(float(starting_av), 2)}],
            "terminal_av": round(float(starting_av), 2),
            "terminal_av_multiple": 1.0,
            "max_drawdown_pct": 0.0,
            "max_drawdown_month": start_month,
            "fees_paid_total": 0.0,
            "fee_drag_annualized_pct": 0.0,
            "history_truncated": True,
        }

    result = project_rila_path(
        rila,
        np.array(annual_factors, dtype=float),
        actual_years,
        glwb_election_age=election_age,
        current_age=age,
        survival_probs=survival,
        discount_factors=discount,
    )
    annual_av_path = list(result["av_path"])  # length actual_years + 1

    # Monthly slice for the regime window (used for intra-year interpolation only).
    # If the monthly history truncates within the requested window, we walk only
    # the months actually available.
    total_months_target = actual_years * 12
    monthly_pairs, _truncated_monthly = _slice_monthly(start_month, total_months_target)

    # Build the monthly AV path. The first point is the starting AV; each year
    # is then walked month-by-month, scaling the year's monthly cumulative
    # return shape so that the year-end AV exactly matches annual_av_path[y+1].
    sy, sm = (int(start_month[:4]), int(start_month[5:7]))
    av_path: list[dict] = [{"month": f"{sy:04d}-{sm:02d}", "av": round(float(starting_av), 2)}]

    cursor = 0  # index into monthly_pairs
    for y in range(actual_years):
        av_start_y = float(annual_av_path[y])
        av_end_y = float(annual_av_path[y + 1])
        # Cumulative factors within this year from the actual monthly series.
        # If history ran out partway, we still want a chart point per month
        # using the cumulative factor seen so far.
        cum = 1.0
        year_slice = monthly_pairs[cursor : cursor + 12]
        if not year_slice:
            break
        cum_factors: list[float] = []
        for _, r in year_slice:
            cum *= 1.0 + float(r)
            cum_factors.append(cum)
        year_total_factor = cum_factors[-1] if cum_factors else 1.0

        # Annual reconciliation: project_rila_path applies credited return,
        # fees, and (if elected) GLWB withdrawals once per year. The combined
        # impact on AV over the year is
        #     av_end_y - av_start_y * year_total_factor
        # i.e. the leakage relative to the raw market return. We spread that
        # leakage linearly across the 12 months so each monthly AV sits on the
        # actual market path minus a pro-rata share of the year's cash-outflow.
        leakage_year = av_end_y - av_start_y * year_total_factor
        for k, (label, _r) in enumerate(year_slice):
            f_k = cum_factors[k]
            # Pro-rata leakage allocation by (k+1)/12 — equal monthly share.
            share = (k + 1) / len(year_slice)
            av_m = av_start_y * f_k + leakage_year * share
            # AV cannot be negative
            if av_m < 0.0:
                av_m = 0.0
            # Stamp month one period AFTER the year_start label (so first point of
            # the loop is start_month + 1 month; last is start_month + 12 months).
            ay, am = _advance_month(sy, sm, y * 12 + k + 1)
            av_path.append({"month": f"{ay:04d}-{am:02d}", "av": round(av_m, 4)})

        cursor += len(year_slice)
        if len(year_slice) < 12:
            # History ran out inside this year; do not continue further years.
            history_truncated = True
            actual_years_effective = y + (len(year_slice) / 12.0)
            break
    else:
        actual_years_effective = float(actual_years)

    # Summary stats — computed off the monthly path so drawdowns reflect
    # intra-year troughs.
    av_values = [pt["av"] for pt in av_path]
    terminal_av = float(av_values[-1])

    # Max drawdown across the path (peak-to-trough), as a positive fraction
    peak = av_values[0]
    max_dd = 0.0
    max_dd_idx = 0
    for i, v in enumerate(av_values):
        if v > peak:
            peak = v
        dd = (peak - v) / peak if peak > 0 else 0.0
        if dd > max_dd:
            max_dd = dd
            max_dd_idx = i
    max_dd = max(0.0, min(1.0, max_dd))
    max_dd_month = av_path[max_dd_idx]["month"]

    fees_paid_total = float(result.get("fees_paid_pv", 0.0))
    if actual_years_effective > 0 and starting_av > 0:
        # PV-of-fees divided by starting AV, annualised
        fee_drag = fees_paid_total / float(starting_av) / actual_years_effective
    else:
        fee_drag = 0.0

    terminal_multiple = terminal_av / float(starting_av) if starting_av > 0 else 0.0

    return {
        "regime_key": regime_key,
        "regime_display_name": regime["display_name"],
        "start_month": start_month,
        "years": actual_years,
        "starting_av": round(float(starting_av), 2),
        "av_path": av_path,
        "terminal_av": round(terminal_av, 2),
        "terminal_av_multiple": round(terminal_multiple, 4),
        "max_drawdown_pct": round(max_dd, 4),
        "max_drawdown_month": max_dd_month,
        "fees_paid_total": round(fees_paid_total, 2),
        "fee_drag_annualized_pct": round(fee_drag, 4),
        "history_truncated": history_truncated,
    }
