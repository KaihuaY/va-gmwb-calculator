"""
Closed-form PV of buffer / floor absorption for non-rider RILAs.

A buffer on an indexed RILA segment is an embedded put-spread: the insurer
absorbs the first `b` of equity loss inside each segment term.  A floor
is an embedded deep put: the insurer absorbs all loss beyond `−f`.  Both
have non-zero expected value under any real-world equity model with
σ > 0, so they MUST be monetised for the Guarantee Value sub-score
to be defensible for products that lack a GLWB / GMDB rider.

Math (lognormal, real-world drift μ, vol σ, segment term T years):

  Per-segment-period return R = exp(X) − 1,   X ~ N(m, v²)
    where m = (μ − 0.5σ²)·T,  v = σ·√T.
  Let S = 1 + R   (lognormal: ln S ~ N(m, v²))
  Real-world expectation E[S] = exp(μT) = exp(m + v²/2).

  Buffer payoff (to policyholder, per $1 of segment principal):
    P_buf(R) = min(max(−R, 0), b)
             = max(0, 1 − S) − max(0, (1 − b) − S)

    E[max(0, K − S)] = K·Φ(−d) − exp(m + v²/2)·Φ(−d − v),
      where d = (ln K − m) / v.

  Floor payoff (insurer eats loss beyond −f):
    P_flr(R) = max(−R − f, 0)
             = max(0, (1 − f) − S)
    Same closed form with K = 1 − f.

PV across the projection horizon:
  Each segment term ends every T years.  We approximate
  segment-period payoffs as occurring at the END of each term, discounted
  at the methodology's discount rate (no mortality/lapse weighting — the
  buffer accrues to the in-force AV regardless of the holder's state).

  Per-segment PV per $1 = Σ_{k=1..floor(H/T)} payoff_per_period · DF(kT)
  Scaled by allocation_pct and product premium.

Output is divided by PV of M&E + spread/cap drag fees (the "non-rider
cost base"), and mapped 1.0× = 50, 2.0× = 100 (same shape as the rider-
PV path).  See `gv_score()` for combination logic.
"""

from __future__ import annotations

import math
from typing import Optional


# ---------------------------------------------------------------------------
# Normal CDF (math.erf-based — vectorisation not needed for closed-form)
# ---------------------------------------------------------------------------

def _phi(x: float) -> float:
    """Standard normal CDF."""
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def _expected_put(strike: float, m: float, v: float) -> float:
    """
    Real-world E[max(K − S, 0)] where ln S ~ N(m, v²), K = strike.

    Derivation:
      E[(K − S)⁺] = K · Pr(S < K) − E[S · 1{S < K}]
                  = K · Φ(d) − exp(m + v²/2) · Φ(d − v),
      with  d = (ln K − m) / v.

    Degenerate v → 0 collapses to deterministic max(K − exp(m), 0).
    """
    if strike <= 0.0:
        return 0.0
    if v <= 1e-12:
        return max(0.0, strike - math.exp(m))
    d = (math.log(strike) - m) / v
    return strike * _phi(d) - math.exp(m + 0.5 * v * v) * _phi(d - v)


# ---------------------------------------------------------------------------
# Per-segment expected absorption (per $1 of segment principal, per period)
# ---------------------------------------------------------------------------

def expected_buffer_absorption(
    *, protection_level: float, term_years: float, mu: float, sigma: float
) -> float:
    """
    Per-$1, per-segment-period expected payoff absorbed by the buffer.

    Buffer absorbs the first `b` of loss:
       P(R) = max(0, 1 − S) − max(0, (1 − b) − S)
    """
    if protection_level <= 0.0 or term_years <= 0.0:
        return 0.0
    m = (mu - 0.5 * sigma * sigma) * term_years
    v = sigma * math.sqrt(term_years)
    # E[max(0, 1 − S)] − E[max(0, (1−b) − S)]
    return _expected_put(1.0, m, v) - _expected_put(1.0 - protection_level, m, v)


def expected_floor_absorption(
    *, protection_level: float, term_years: float, mu: float, sigma: float
) -> float:
    """
    Per-$1, per-segment-period expected payoff absorbed by the floor.

    Floor caps loss at −f; payoff = max(0, (1 − f) − S).
    """
    if protection_level <= 0.0 or term_years <= 0.0:
        return 0.0
    if protection_level >= 1.0:
        # Pathological 100% floor — would equate to a return-of-premium
        # guarantee; outside the parameter space for any real RILA.
        protection_level = 0.999
    m = (mu - 0.5 * sigma * sigma) * term_years
    v = sigma * math.sqrt(term_years)
    return _expected_put(1.0 - protection_level, m, v)


# ---------------------------------------------------------------------------
# PV of protection absorption across the projection horizon
# ---------------------------------------------------------------------------

def buffer_value_pv(
    spec: dict,
    *,
    premium: float,
    horizon_years: int,
    mu: float,
    sigma: float,
    discount_rate: float,
) -> dict:
    """
    Compute PV of all buffer + floor absorption across a product's segments
    over `horizon_years`, weighted by allocation_pct, discounted continuously.

    The user's allocation is assumed to re-roll into the same segment menu
    each period (the convention used elsewhere in the rating engine).

    Returns dict:
      pv_total      total $ PV of buffer + floor absorption
      pv_buffer     $ PV attributable to buffer segments
      pv_floor      $ PV attributable to floor segments
      detail        list of per-segment contributions
    """
    segments = spec.get("segments_available", []) or []
    if not segments:
        return {"pv_total": 0.0, "pv_buffer": 0.0, "pv_floor": 0.0, "detail": []}

    allocations = spec.get(
        "default_allocation_pcts",
        [1.0 / len(segments)] * len(segments),
    )
    if abs(sum(allocations) - 1.0) > 1e-6:
        total = sum(allocations) or 1.0
        allocations = [a / total for a in allocations]

    pv_buffer = 0.0
    pv_floor = 0.0
    detail = []

    for seg, alloc in zip(segments, allocations):
        term = max(1, int(seg.get("term_years", 1)))
        protection_type = seg.get("protection_type", "buffer")
        b = float(seg.get("protection_level", 0.0))

        if protection_type == "buffer":
            per_period = expected_buffer_absorption(
                protection_level=b, term_years=term, mu=mu, sigma=sigma
            )
        elif protection_type == "floor":
            per_period = expected_floor_absorption(
                protection_level=b, term_years=term, mu=mu, sigma=sigma
            )
        else:
            per_period = 0.0

        # PV over the horizon: end-of-term payoffs at t = T, 2T, ... up to H.
        # Per-period payoff is on $1 of segment principal at the start of
        # each period; we approximate by holding the allocation notional
        # constant at `alloc * premium` (the rating engine convention).
        seg_notional = alloc * premium
        n_terms = horizon_years // term
        seg_pv = 0.0
        for k in range(1, n_terms + 1):
            t = k * term
            df = math.exp(-discount_rate * t)
            seg_pv += per_period * seg_notional * df

        detail.append({
            "term_years": term,
            "protection_type": protection_type,
            "protection_level": b,
            "allocation_pct": alloc,
            "expected_per_period_per_dollar": per_period,
            "pv": seg_pv,
        })

        if protection_type == "buffer":
            pv_buffer += seg_pv
        elif protection_type == "floor":
            pv_floor += seg_pv

    return {
        "pv_total": pv_buffer + pv_floor,
        "pv_buffer": pv_buffer,
        "pv_floor":  pv_floor,
        "detail":    detail,
    }


# ---------------------------------------------------------------------------
# Cost base for the buffer-PV ratio
# ---------------------------------------------------------------------------

def buffer_cost_base_pv(
    spec: dict,
    *,
    premium: float,
    horizon_years: int,
    discount_rate: float,
) -> float:
    """
    PV of "what the policyholder pays for the buffer" — used as the
    denominator when mapping buffer absorption value to a 0–100 score.

    Buffers are not separately priced; the holder pays for them through
    the M&E load PLUS the implicit cap-spread drag (the carrier's net
    profit on the protection-shorting / option-replication strategy).
    Both flow through to fees in practice, so we sum:

       PV(M&E annual × AV) + PV(cap-spread drag × AV)

    Approximated by holding AV ≈ premium across the horizon (consistent
    with the existing TCO drag heuristic — sufficient resolution for a
    cohort-relative score). Continuous discounting at the methodology rate.
    """
    base = spec.get("base", {}) or {}
    me_fee_annual = float(base.get("me_fee_annual", 0.0))

    # Cap-spread drag — same heuristic as _tco_drag, mirrored here to avoid
    # an import cycle.  Kept in sync by docstring discipline; covered by
    # tests in test_rating.py that pin both code paths to identical
    # assumption values (μ=7%, U=0.07).
    segs = spec.get("segments_available", []) or []
    allocations = spec.get(
        "default_allocation_pcts",
        [1.0 / len(segs)] * len(segs) if segs else [],
    )
    cap_drag = 0.0
    for seg, alloc in zip(segs, allocations):
        method = seg.get("crediting_method")
        if method == "cap" and seg.get("cap_rate") is not None:
            ann_cap = seg["cap_rate"] / max(1, seg.get("term_years", 1))
            drag_component = max(0.0, 0.07 - ann_cap)
        elif method == "participation":
            part = seg.get("participation_rate", 1.0) or 1.0
            drag_component = max(0.0, 0.07 * (1.0 - min(1.0, part)))
        elif method == "spread":
            drag_component = (seg.get("spread", 0.0) or 0.0) / max(1, seg.get("term_years", 1))
        elif method == "trigger":
            trig = seg.get("trigger_rate", 0.0) or 0.0
            ann_trig = trig / max(1, seg.get("term_years", 1))
            drag_component = max(0.0, 0.07 - ann_trig)
        else:
            drag_component = 0.0
        cap_drag += alloc * drag_component

    annual_cost_rate = me_fee_annual + cap_drag
    # PV of a continuous annuity of rate `c × premium` over H years at r:
    #   c × premium × (1 − e^{−rH}) / r
    if discount_rate <= 1e-12:
        return annual_cost_rate * premium * horizon_years
    return (
        annual_cost_rate * premium
        * (1.0 - math.exp(-discount_rate * horizon_years))
        / discount_rate
    )


# ---------------------------------------------------------------------------
# Score function
# ---------------------------------------------------------------------------

def buffer_value_score(
    spec: dict,
    *,
    premium: float,
    horizon_years: int,
    mu: float,
    sigma: float,
    discount_rate: float,
) -> tuple[float, str, dict]:
    """
    Map buffer-absorption value to a 0–100 score using the same shape as
    the rider-PV path: ratio = PV(absorption) / PV(cost base).
    1.0× → 50, 2.0× → 100, 0.5× → 25, clamped to [0, 100].

    Returns (score, rationale, detail).  `detail` is a dict the caller
    can fold into the GV rationale for transparency.
    """
    pv = buffer_value_pv(
        spec,
        premium=premium,
        horizon_years=horizon_years,
        mu=mu,
        sigma=sigma,
        discount_rate=discount_rate,
    )
    cost = buffer_cost_base_pv(
        spec,
        premium=premium,
        horizon_years=horizon_years,
        discount_rate=discount_rate,
    )
    pv_total = pv["pv_total"]

    if cost <= 0:
        # No fee load and no buffer → can't compute ratio.  Return neutral.
        if pv_total <= 0:
            return 50.0, "No buffer / floor segments and no explicit cost base — neutral (50).", pv
        # Buffer with zero cost base is an arbitrage-style structure; cap at 100.
        return 100.0, (
            f"Closed-form PV(buffer absorption) ${pv_total:,.0f} with zero cost base "
            f"— capped at 100."
        ), pv

    ratio = pv_total / cost
    score = max(0.0, min(100.0, 50.0 * ratio))
    rationale = (
        f"PV(buffer+floor absorption) / PV(M&E+cap-drag) = {ratio:.2f}x. "
        f"Buffer PV ${pv['pv_buffer']:,.0f}; floor PV ${pv['pv_floor']:,.0f}; "
        f"cost-base PV ${cost:,.0f}. Closed-form lognormal (μ={mu:.2%}, σ={sigma:.2%}, "
        f"r={discount_rate:.2%})."
    )
    return score, rationale, {**pv, "cost_base_pv": cost, "ratio": ratio}
