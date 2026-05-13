"""
RILA (Registered Index-Linked Annuity) segment mechanics.

A RILA buys exposure to a stock index over fixed terms (segments), with
upside capped/participation-rated/spread-reduced and downside cushioned
by either a buffer (carrier absorbs first X% loss) or a floor (max loss
capped at -X%).

This module is intentionally self-contained — it does NOT modify the
existing GMWB engine in projection.py.  The rating engine dispatches
to project_rila_path() based on product type.

Glossary
--------
  raw_return   compounded index return over the segment term (e.g. 6 yr)
  cap          maximum credited return for the segment
  participation %         multiplier applied to the raw return
  spread       fixed % subtracted from the raw return (upside only)
  trigger      flat payout if raw_return ≥ 0
  buffer       insurer absorbs first X% of loss; holder takes the rest
  floor        max loss is capped at -X%; insurer eats below the floor
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Optional

import numpy as np


CreditingMethod = Literal["cap", "participation", "spread", "trigger"]
ProtectionType  = Literal["buffer", "floor"]


@dataclass
class RILASegment:
    term_years:          int
    index:               str                       # "sp500" | "russell2000" | etc.
    crediting_method:    CreditingMethod
    protection_type:     ProtectionType
    protection_level:    float                     # decimal (0.10 = 10%)
    cap_rate:            Optional[float] = None
    participation_rate:  Optional[float] = None
    spread:              Optional[float] = None
    trigger_rate:        Optional[float] = None


@dataclass
class RILAProduct:
    # Policyholder side is set by the scoring scenario, not the product.
    # Contract
    name:                       str
    carrier:                    str
    base_av:                    float
    segments:                   list[RILASegment]   # available segment menu
    allocation_pcts:            list[float]         # sums to 1.0 across `segments`
    me_fee_annual:              float
    surrender_schedule:         list[float]
    free_withdrawal_pct:        float = 0.10
    nursing_home_waiver:        bool = False
    terminal_illness_waiver:    bool = False
    disability_waiver:          bool = False
    # GLWB rider (optional)
    has_glwb:                   bool = False
    glwb_rider_fee:             float = 0.0
    glwb_rollup_rate:           float = 0.0
    glwb_withdrawal_rate:       float = 0.05
    glwb_step_up:               bool = False
    # GMDB rider (optional)
    has_gmdb:                   bool = False
    gmdb_rider_fee:             float = 0.0
    gmdb_rollup_rate:           float = 0.0
    gmdb_step_up:               bool = False


# ---------------------------------------------------------------------------
# Crediting maths
# ---------------------------------------------------------------------------

def apply_crediting(segment: RILASegment, raw_return: float) -> float:
    """
    Apply the segment's crediting method + protection to a raw index return.
    Returns the *segment-period* credited return (e.g. over 1 yr or 6 yr).

    Upside (raw_return ≥ 0) is shaped by `crediting_method`.
    Downside (raw_return < 0) is shaped by `protection_type`.
    """
    if raw_return >= 0:
        method = segment.crediting_method
        if method == "cap":
            participation = segment.participation_rate if segment.participation_rate is not None else 1.0
            upside = raw_return * participation
            if segment.cap_rate is not None:
                upside = min(upside, segment.cap_rate)
            return upside
        if method == "participation":
            participation = segment.participation_rate if segment.participation_rate is not None else 1.0
            return raw_return * participation
        if method == "spread":
            spread = segment.spread if segment.spread is not None else 0.0
            return max(0.0, raw_return - spread)
        if method == "trigger":
            return segment.trigger_rate if segment.trigger_rate is not None else 0.0
        raise ValueError(f"unknown crediting method: {method}")

    # Downside
    if segment.protection_type == "buffer":
        # Buffer absorbs first `protection_level` of loss
        return min(0.0, raw_return + segment.protection_level)
    if segment.protection_type == "floor":
        # Floor caps the loss at -protection_level
        return max(raw_return, -segment.protection_level)
    raise ValueError(f"unknown protection type: {segment.protection_type}")


# ---------------------------------------------------------------------------
# Path projection
# ---------------------------------------------------------------------------

def _annualize_segment(seg: RILASegment) -> dict:
    """
    Convert a multi-year segment's cap / participation / spread / trigger and
    its buffer / floor into effective ONE-YEAR equivalents, so the projection
    loop can credit per-year and the fee base reflects realistic interim
    growth.  This is a standard rating-model simplification (RILAs publish
    interim-value mechanics, but the per-year approximation is well within
    the noise band of a 5,000-scenario Monte Carlo).
    """
    n = max(1, seg.term_years)
    out: dict = {
        "method": seg.crediting_method,
        "protection_type": seg.protection_type,
    }
    # Annualize cap: (1 + cap)^(1/n) - 1
    if seg.cap_rate is not None:
        out["cap"] = (1.0 + seg.cap_rate) ** (1.0 / n) - 1.0
    else:
        out["cap"] = None
    out["participation"] = seg.participation_rate if seg.participation_rate is not None else 1.0
    out["spread"] = (seg.spread / n) if seg.spread is not None else 0.0
    # Trigger paid pro-rata as an annual equivalent
    out["trigger"] = (seg.trigger_rate / n) if seg.trigger_rate is not None else 0.0
    # Buffer/floor: annualize the protection level the same way
    # (a 20% per 6-yr buffer → ~3.7% per yr effective protection of annual loss)
    out["protection"] = 1.0 - (1.0 - seg.protection_level) ** (1.0 / n)
    return out


def _credit_annualized(annseg: dict, raw_annual: float) -> float:
    """Apply one-year-equivalent crediting to a one-year raw return."""
    if raw_annual >= 0:
        method = annseg["method"]
        if method == "cap":
            upside = raw_annual * annseg["participation"]
            if annseg["cap"] is not None:
                upside = min(upside, annseg["cap"])
            return upside
        if method == "participation":
            return raw_annual * annseg["participation"]
        if method == "spread":
            return max(0.0, raw_annual - annseg["spread"])
        if method == "trigger":
            return annseg["trigger"]
        raise ValueError(f"unknown crediting method: {method}")
    # Downside
    if annseg["protection_type"] == "buffer":
        return min(0.0, raw_annual + annseg["protection"])
    if annseg["protection_type"] == "floor":
        return max(raw_annual, -annseg["protection"])
    raise ValueError(f"unknown protection type: {annseg['protection_type']}")


def project_rila_path(
    product: RILAProduct,
    annual_returns: np.ndarray,    # shape (years_total,), multiplicative factors
    projection_years: int,
    *,
    glwb_election_age: Optional[int] = None,
    current_age: int = 60,
    survival_probs: Optional[list[float]] = None,
    discount_factors: Optional[list[float]] = None,
) -> dict:
    """
    Project a single Monte Carlo path for a RILA.

    Per-year crediting uses an annualized cap/buffer derived from each segment's
    multi-year terms.  This keeps the fee base realistic and the rating-purpose
    AV trajectory smooth.

    Returns:
      av_end           terminal AV
      av_path          array of AV by year (length projection_years+1)
      fees_paid_pv     PV of M&E + rider fees
      glwb_pv          PV of GLWB rider claims (0 if no rider)
      gmdb_pv          PV of GMDB rider claims (0 if no rider)
    """
    n_slots = len(product.segments)
    if n_slots == 0:
        raise ValueError("RILAProduct must have at least one segment")
    if abs(sum(product.allocation_pcts) - 1.0) > 1e-6:
        raise ValueError(f"allocation_pcts must sum to 1.0, got {sum(product.allocation_pcts)}")

    # Annualize every segment once
    annsegs = [_annualize_segment(seg) for seg in product.segments]

    slot_av = np.array(
        [product.base_av * pct for pct in product.allocation_pcts],
        dtype=float,
    )
    av_path = np.zeros(projection_years + 1)
    av = float(np.sum(slot_av))
    av_path[0] = av

    total_fees_pv = 0.0
    total_me_fees_pv = 0.0
    total_rider_fees_pv = 0.0
    total_glwb_pv = 0.0
    total_gmdb_pv = 0.0

    glwb_bb = product.base_av
    gmdb_bb = product.base_av

    deferral_years = (glwb_election_age - current_age) if (glwb_election_age and product.has_glwb) else 0

    survival = survival_probs or [1.0] * (projection_years + 1)
    discount = discount_factors or [1.0] * (projection_years + 1)

    for year in range(projection_years):
        # 1. Apply annualized crediting per slot
        raw_annual = float(annual_returns[year]) - 1.0  # multiplicative → return
        for s in range(n_slots):
            credited = _credit_annualized(annsegs[s], raw_annual)
            slot_av[s] *= (1.0 + credited)

        av = float(np.sum(slot_av))

        # 2. Annual fees: M&E on AV + rider fees
        me_fee = product.me_fee_annual * av
        glwb_fee = product.glwb_rider_fee * glwb_bb if product.has_glwb else 0.0
        gmdb_fee = product.gmdb_rider_fee * av if product.has_gmdb else 0.0
        total_fee_year = me_fee + glwb_fee + gmdb_fee

        if av > 0:
            slot_av *= max(0.0, av - total_fee_year) / av
        av = float(np.sum(slot_av))

        # GLWB withdrawal phase
        in_glwb_phase = product.has_glwb and (year + 1 > deferral_years)
        if product.has_glwb:
            if not in_glwb_phase and product.glwb_rollup_rate > 0:
                glwb_bb *= (1.0 + product.glwb_rollup_rate)
            if product.glwb_step_up and av > glwb_bb:
                glwb_bb = av
            if in_glwb_phase:
                gaw = glwb_bb * product.glwb_withdrawal_rate
                actual = min(gaw, av)
                if av > 0:
                    slot_av *= max(0.0, av - actual) / av
                claim = max(0.0, gaw - av)
                # Mortality-weighted (we accumulate undiscounted claim and apply at end)
                age_idx = min(year + 1, len(survival) - 1)
                disc_idx = min(year + 1, len(discount) - 1)
                total_glwb_pv += claim * survival[age_idx] * discount[disc_idx]
                av = float(np.sum(slot_av))

        # GMDB shortfall PV (per year mortality decrement)
        if product.has_gmdb and av > 0:
            if product.gmdb_rollup_rate > 0:
                gmdb_bb *= (1.0 + product.gmdb_rollup_rate)
            if product.gmdb_step_up and av > gmdb_bb:
                gmdb_bb = av
            age_idx_prev = max(0, min(year, len(survival) - 1))
            age_idx = min(year + 1, len(survival) - 1)
            q_year = max(0.0, survival[age_idx_prev] - survival[age_idx])
            disc_idx = min(year + 1, len(discount) - 1)
            shortfall = max(0.0, gmdb_bb - av)
            total_gmdb_pv += shortfall * q_year * discount[disc_idx]

        # Fees PV (combined + split into M&E vs rider for downstream GV math)
        disc_idx = min(year + 1, len(discount) - 1)
        age_idx = min(year + 1, len(survival) - 1)
        weight = survival[age_idx] * discount[disc_idx]
        total_fees_pv       += total_fee_year * weight
        total_me_fees_pv    += me_fee * weight
        total_rider_fees_pv += (glwb_fee + gmdb_fee) * weight

        av_path[year + 1] = av

    return {
        "av_end": av,
        "av_path": av_path,
        "fees_paid_pv":     total_fees_pv,
        "me_fees_pv":       total_me_fees_pv,
        "rider_fees_pv":    total_rider_fees_pv,
        "glwb_pv": total_glwb_pv,
        "gmdb_pv": total_gmdb_pv,
    }


def project_rila_monte_carlo(
    product: RILAProduct,
    *,
    mu: float,
    sigma: float,
    projection_years: int,
    n_scenarios: int,
    seed: int,
    survival_probs: Optional[list[float]] = None,
    discount_factors: Optional[list[float]] = None,
    glwb_election_age: Optional[int] = None,
    current_age: int = 60,
) -> dict:
    """
    Run n_scenarios paths and return aggregate stats.
    """
    from .stochastic import make_rng, generate_gbm_returns

    rng = make_rng(seed)
    # Annual frequency; one factor per year per scenario
    returns = generate_gbm_returns(mu, sigma, 1.0, projection_years, n_scenarios, rng)

    fees_pv       = np.zeros(n_scenarios)
    me_fees_pv    = np.zeros(n_scenarios)
    rider_fees_pv = np.zeros(n_scenarios)
    glwb_pv       = np.zeros(n_scenarios)
    gmdb_pv       = np.zeros(n_scenarios)
    av_end        = np.zeros(n_scenarios)
    av_paths      = np.zeros((n_scenarios, projection_years + 1))

    for i in range(n_scenarios):
        out = project_rila_path(
            product,
            returns[i],
            projection_years,
            glwb_election_age=glwb_election_age,
            current_age=current_age,
            survival_probs=survival_probs,
            discount_factors=discount_factors,
        )
        fees_pv[i]       = out["fees_paid_pv"]
        me_fees_pv[i]    = out["me_fees_pv"]
        rider_fees_pv[i] = out["rider_fees_pv"]
        glwb_pv[i]  = out["glwb_pv"]
        gmdb_pv[i]  = out["gmdb_pv"]
        av_end[i]   = out["av_end"]
        av_paths[i] = out["av_path"]

    return {
        "fees_pv_mean":        float(np.mean(fees_pv)),
        "me_fees_pv_mean":     float(np.mean(me_fees_pv)),
        "rider_fees_pv_mean":  float(np.mean(rider_fees_pv)),
        "glwb_pv_mean":  float(np.mean(glwb_pv)),
        "gmdb_pv_mean":  float(np.mean(gmdb_pv)),
        "av_end_mean":   float(np.mean(av_end)),
        "av_end_p5":     float(np.percentile(av_end, 5)),
        "av_end_p50":    float(np.percentile(av_end, 50)),
        "av_end_p95":    float(np.percentile(av_end, 95)),
        "av_paths_p50":  np.percentile(av_paths, 50, axis=0).tolist(),
        "fees_pv_raw":   fees_pv,
        "glwb_pv_raw":   glwb_pv,
        "gmdb_pv_raw":   gmdb_pv,
    }
