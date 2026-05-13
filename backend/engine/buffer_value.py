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
    persistency: Optional[list[float]] = None,
    av_path: Optional[list[float]] = None,
) -> dict:
    """
    PV of buffer + floor absorption across a product's segments over
    `horizon_years`, weighted by allocation_pct.

    v1.3.1 enhancements:
      - `persistency` (list of length horizon_years+1): in-force probability
        at each year. When provided, each segment-period payoff at t=kT is
        weighted by persistency[t], matching the persistency basis the
        Monte Carlo uses for rider PV. The buffer/rider ratios then become
        directly comparable.
      - `av_path` (list of length horizon_years+1): per-year average AV. When
        provided, the segment notional at the start of each period is taken
        from this path rather than held flat at `alloc * premium`. Reflects
        AV depletion (GLWB drawdown phase) or growth (no-rider products).

    Defaults preserve legacy v1.2.0 behavior (no persistency, flat AV).
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

    # Normalize persistency / av_path to length horizon_years+1
    n = horizon_years + 1
    if persistency is None:
        persistency = [1.0] * n
    persistency = list(persistency)[:n] + [persistency[-1]] * max(0, n - len(persistency))
    if av_path is None:
        av_path = [premium] * n
    av_path = list(av_path)[:n] + [av_path[-1]] * max(0, n - len(av_path))

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

        # PV over horizon: end-of-term payoffs at t = T, 2T, ... up to H.
        # Segment notional at start of each period is allocation × AV at t-1.
        # Discount and persistency applied at the payoff date t.
        n_terms = horizon_years // term
        seg_pv = 0.0
        for k in range(1, n_terms + 1):
            t = k * term
            t_start = (k - 1) * term
            seg_notional_t = alloc * av_path[min(t_start, n - 1)]
            df = math.exp(-discount_rate * t)
            persist = persistency[min(t, n - 1)]
            seg_pv += per_period * seg_notional_t * df * persist

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
    mu: float,
    discount_rate: float,
    av_path: Optional[list[float]] = None,
    persistency: Optional[list[float]] = None,
) -> float:
    """
    PV of "what the policyholder pays for the buffer" — denominator of the
    buffer value ratio.

    The holder pays for buffer/floor protection through the M&E load PLUS
    the implicit cap-spread drag (the carrier's option-replication margin
    embedded in the foregone uncapped upside):

       PV(M&E rate × AV(t)) + PV(cap-spread drag × AV(t))

    If `av_path` (length horizon_years+1) is provided, fees scale with the
    actual reconciled AV at each year-end — this is more accurate than
    holding AV flat at premium for products that deplete (GLWB drawdown)
    or compound (no-rider buffer products).

    If `persistency` is provided, each year's fee is weighted by the
    in-force probability — matching the persistency basis used for rider
    PV in the Monte Carlo result. This is required for an apples-to-apples
    comparison between the buffer ratio and the rider ratio.

    Both `av_path` and `persistency` default to None, in which case the
    function falls back to flat AV ≈ premium with no persistency weighting
    (legacy v1.2.0 behavior, kept for callers that pre-date the v1.3.1
    enhancement).
    """
    base = spec.get("base", {}) or {}
    me_fee_annual = float(base.get("me_fee_annual", 0.0))
    cap_drag = _cap_spread_drag_local(spec, mu)
    annual_cost_rate = me_fee_annual + cap_drag

    # Discrete year-end summation when AV path / persistency are supplied.
    if av_path is not None or persistency is not None:
        # Build year-end AV and persistency vectors of length horizon_years+1
        # (index 0 = inception). If only one is given, the other defaults
        # to the constant case so the sum is still well-formed.
        n = horizon_years + 1
        if av_path is None:
            av_path = [premium] * n
        if persistency is None:
            persistency = [1.0] * n
        av_path = list(av_path)[:n] + [av_path[-1]] * max(0, n - len(av_path))
        persistency = list(persistency)[:n] + [persistency[-1]] * max(0, n - len(persistency))
        total = 0.0
        for year in range(1, horizon_years + 1):
            # Mid-year average AV for the fee accrual over [year-1, year]
            av_mid = 0.5 * (av_path[year - 1] + av_path[year])
            df = math.exp(-discount_rate * year)
            total += annual_cost_rate * av_mid * persistency[year] * df
        return total

    # Continuous-annuity closed form, AV held flat at premium (legacy path).
    if discount_rate <= 1e-12:
        return annual_cost_rate * premium * horizon_years
    return (
        annual_cost_rate * premium
        * (1.0 - math.exp(-discount_rate * horizon_years))
        / discount_rate
    )


def _cap_spread_drag_local(spec: dict, mu: float) -> float:
    """Local mirror of rating._cap_spread_drag (avoids import cycle)."""
    segs = spec.get("segments_available", []) or []
    allocations = spec.get(
        "default_allocation_pcts",
        [1.0 / len(segs)] * len(segs) if segs else [],
    )
    cap_drag = 0.0
    for seg, alloc in zip(segs, allocations):
        method = seg.get("crediting_method")
        T = max(1, seg.get("term_years", 1))
        if method == "cap" and seg.get("cap_rate") is not None:
            ann_cap = (1.0 + seg["cap_rate"]) ** (1.0 / T) - 1.0
            drag_component = max(0.0, mu - ann_cap)
        elif method == "participation":
            part = seg.get("participation_rate", 1.0) or 1.0
            drag_component = max(0.0, mu * (1.0 - min(1.0, part)))
        elif method == "spread":
            drag_component = (seg.get("spread", 0.0) or 0.0) / T
        elif method == "trigger":
            trig = seg.get("trigger_rate", 0.0) or 0.0
            ann_trig = (1.0 + trig) ** (1.0 / T) - 1.0
            drag_component = max(0.0, mu - ann_trig)
        else:
            drag_component = 0.0
        cap_drag += alloc * drag_component
    return cap_drag


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
    persistency: Optional[list[float]] = None,
    av_path: Optional[list[float]] = None,
) -> tuple[float, str, dict]:
    """
    Map buffer-absorption value to a 0–100 score: ratio = PV(absorption) / PV(cost base).
    1.0× → 50, 2.0× → 100, 0.5× → 25, clamped to [0, 100].

    Persistency and av_path are passed through to both numerator and denominator
    so the ratio is internally consistent and comparable to the rider ratio.
    """
    pv = buffer_value_pv(
        spec,
        premium=premium,
        horizon_years=horizon_years,
        mu=mu,
        sigma=sigma,
        discount_rate=discount_rate,
        persistency=persistency,
        av_path=av_path,
    )
    cost = buffer_cost_base_pv(
        spec,
        premium=premium,
        horizon_years=horizon_years,
        mu=mu,
        discount_rate=discount_rate,
        persistency=persistency,
        av_path=av_path,
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
