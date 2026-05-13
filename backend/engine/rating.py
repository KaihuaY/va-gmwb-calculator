"""
AnnuityVoice rating engine.

Given a product spec JSON + methodology JSON, compute the 5 sub-scores,
composite score, and letter grade.  Output is deterministic for a fixed
seed — byte-identical re-runs are required for the rating to be defensible.

Five sub-scores, each 0–100:
  TCO — Total Cost of Ownership (lower fee drag = higher score)
  GV  — Guarantee Value (more rider value per rider $ = higher score)
  SF  — Surrender Flexibility (shorter/lighter surrender + waivers = higher)
  IC  — Insurer Credit (carrier rating - PE / Level 3 penalties)
  BF  — Behavioral Fairness (cap-reset history, complaints, fines)

Composite = weighted sum (default equal-weight); mapped to letter grade
via methodology's letter_bands.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict
from pathlib import Path
from typing import Any, Optional

import numpy as np

from .buffer_value import buffer_value_score
from .historical import _resolve_returns
from .mortality import compute_persistency, compute_survival_probs
from .rila import RILAProduct, RILASegment, project_rila_monte_carlo, project_rila_path
from .utils import compute_discount_factors


# ---------------------------------------------------------------------------
# Product spec → RILAProduct adapter
# ---------------------------------------------------------------------------

def product_spec_to_rila(spec: dict, premium: float) -> RILAProduct:
    """Construct a RILAProduct from a product-spec JSON, scaled to `premium`."""
    segments_data = spec.get("segments_available", [])
    segments = [
        RILASegment(
            term_years=s["term_years"],
            index=s.get("index", "sp500"),
            crediting_method=s["crediting_method"],
            protection_type=s["protection_type"],
            protection_level=s["protection_level"],
            cap_rate=s.get("cap_rate"),
            participation_rate=s.get("participation_rate"),
            spread=s.get("spread"),
            trigger_rate=s.get("trigger_rate"),
        )
        for s in segments_data
    ]
    # Default allocation: equal across segments, normalized
    allocations = spec.get(
        "default_allocation_pcts",
        [1.0 / len(segments)] * len(segments) if segments else [],
    )
    if segments and abs(sum(allocations) - 1.0) > 1e-6:
        # renormalize defensively
        total = sum(allocations) or 1.0
        allocations = [a / total for a in allocations]

    base = spec.get("base", {})
    rider = spec.get("rider", {}) or {}
    has_glwb = rider.get("type") == "glwb"

    # Resolve withdrawal rate at age 65 (the scoring scenario's election age).
    # US single-life withdrawal rates are unisex (Title VII / Norris 1983), so
    # we use the single published curve.
    wd_rate_by_age = rider.get("withdrawal_rate_by_age", {}) or {}
    glwb_wd_rate = 0.05
    if "65+" in wd_rate_by_age:
        glwb_wd_rate = wd_rate_by_age["65+"]
    elif "60-64" in wd_rate_by_age:
        glwb_wd_rate = wd_rate_by_age["60-64"]

    return RILAProduct(
        name=spec["name"],
        carrier=spec["carrier"],
        base_av=premium,
        segments=segments,
        allocation_pcts=allocations,
        me_fee_annual=base.get("me_fee_annual", 0.0125),
        surrender_schedule=base.get("surrender_schedule", []),
        free_withdrawal_pct=base.get("free_withdrawal_pct", 0.10),
        nursing_home_waiver=base.get("nursing_home_waiver", False),
        terminal_illness_waiver=base.get("terminal_illness_waiver", False),
        disability_waiver=base.get("disability_waiver", False),
        has_glwb=has_glwb,
        glwb_rider_fee=rider.get("rider_fee_annual", 0.0) if has_glwb else 0.0,
        glwb_rollup_rate=rider.get("rollup_rate", 0.0) if has_glwb else 0.0,
        glwb_withdrawal_rate=glwb_wd_rate if has_glwb else 0.0,
        glwb_step_up=rider.get("step_up", False) if has_glwb else False,
        has_gmdb=spec.get("has_gmdb", False),
        gmdb_rider_fee=spec.get("gmdb_rider_fee", 0.0),
    )


# ---------------------------------------------------------------------------
# Sub-score functions
# ---------------------------------------------------------------------------

def _tco_drag(spec: dict, mc_result: dict, premium: float) -> float:
    """
    TCO drag = (PV(M&E + rider fees) + cap-spread drag estimate) / premium / horizon_years.

    Returns annualized drag rate (decimal).  Higher = more expensive.
    """
    base = spec.get("base", {})
    explicit_annual = base.get("me_fee_annual", 0.0125)
    rider_fee = 0.0
    if spec.get("rider", {}).get("type") == "glwb":
        rider_fee = spec["rider"].get("rider_fee_annual", 0.0)

    # Cap-spread drag estimate: weighted by allocation
    # If a segment is capped at C and uncapped expected upside is U (annualized),
    # the drag is approximately max(0, U - C) * P(upside) * partition.
    # Use a simple heuristic: drag = (0.06 - effective_cap_annualized) capped at 0.04
    segs = spec.get("segments_available", [])
    allocations = spec.get(
        "default_allocation_pcts",
        [1.0 / len(segs)] * len(segs) if segs else [],
    )
    cap_drag = 0.0
    for seg, alloc in zip(segs, allocations):
        if seg.get("crediting_method") == "cap" and seg.get("cap_rate") is not None:
            ann_cap = seg["cap_rate"] / max(1, seg["term_years"])
            # Expected uncapped index ≈ 7% real → drag = max(0, 0.07 - ann_cap)
            drag_component = max(0.0, 0.07 - ann_cap)
        elif seg.get("crediting_method") == "participation":
            part = seg.get("participation_rate", 1.0)
            drag_component = max(0.0, 0.07 * (1.0 - min(1.0, part)))
        elif seg.get("crediting_method") == "spread":
            drag_component = seg.get("spread", 0.0) / max(1, seg["term_years"])
        elif seg.get("crediting_method") == "trigger":
            trig = seg.get("trigger_rate", 0.0)
            ann_trig = trig / max(1, seg["term_years"])
            drag_component = max(0.0, 0.07 - ann_trig)
        else:
            drag_component = 0.0
        cap_drag += alloc * drag_component

    return explicit_annual + rider_fee + cap_drag


def tco_score(spec: dict, mc_result: dict, cohort_drags: list[float], premium: float) -> tuple[float, str]:
    """Score 100 = lowest drag in cohort; 0 = highest."""
    this_drag = _tco_drag(spec, mc_result, premium)
    if not cohort_drags or len(cohort_drags) == 1:
        # Single-product cohort — neutral 70 score
        return 70.0, f"Estimated annualised fee + cap-spread drag: {this_drag*100:.2f}% (no cohort comparison available)."
    best = min(cohort_drags)
    worst = max(cohort_drags)
    if worst - best < 1e-9:
        return 70.0, f"All cohort products have identical fee drag of {this_drag*100:.2f}%."
    score = 100.0 * (1.0 - (this_drag - best) / (worst - best))
    score = max(0.0, min(100.0, score))
    return score, (
        f"Annualised fee + cap-spread drag: {this_drag*100:.2f}%. "
        f"Cohort best: {best*100:.2f}%; cohort worst: {worst*100:.2f}%."
    )


def gv_score(
    spec: dict,
    mc_result: dict,
    premium: float,
    horizon_years: int,
    *,
    mu: float = 0.07,
    sigma: float = 0.18,
    discount_rate: float = 0.04,
) -> tuple[float, str]:
    """
    Guarantee Value sub-score.

    Two monetised guarantees can contribute (v1.2.0):

      1. Income / death rider — PV of GLWB / GMDB claims vs PV of rider fees
         (Monte Carlo, already computed in `mc_result`).
      2. Buffer / floor absorption on indexed segments — closed-form PV of
         downside absorption vs PV of M&E + cap-spread cost base.

    Rationale for the two-denominator design: the rider charge funds
    rider claims directly (clean ratio); the buffer is funded implicitly
    through M&E + cap-spread drag (the carrier's option-replication cost
    embedded in the explicit fee + the foregone uncapped upside). Using
    rider fees as the denominator for buffer value would understate the
    buffer's cost-effectiveness for non-rider products that have non-zero
    M&E. The two ratios are computed separately, then mapped to scores
    and AVERAGED (weighted by their PV contributions to avoid a 50/50
    split when one guarantee dominates).

    Mapping (per ratio):  1.0x → 50,  2.0x → 100,  0.5x → 25, clamped.
    """
    rider = spec.get("rider")
    has_rider = bool(rider and rider.get("type") == "glwb")

    # --- Rider component --------------------------------------------------
    rider_pv = 0.0
    rider_fees_pv = 0.0
    rider_score: Optional[float] = None
    rider_msg = ""
    if has_rider:
        rider_pv = mc_result["glwb_pv_mean"]
        rider_fee_annual = rider.get("rider_fee_annual", 0.0)
        # PV(rider fees) ≈ rider_fee × premium × horizon × 0.7 survival/discount adj
        # (preserved from v1.1.0 — orthogonal to buffer pricing).
        rider_fees_pv = rider_fee_annual * premium * horizon_years * 0.7
        if rider_fees_pv > 0:
            ratio = rider_pv / rider_fees_pv
            rider_score = max(0.0, min(100.0, 50.0 * ratio))
            rider_msg = (
                f"Rider: PV(claims)/PV(rider fees) = {ratio:.2f}x "
                f"(${rider_pv:,.0f} / ${rider_fees_pv:,.0f})."
            )

    # --- Buffer / floor component ----------------------------------------
    buffer_s, buffer_msg, buffer_detail = buffer_value_score(
        spec,
        premium=premium,
        horizon_years=horizon_years,
        mu=mu,
        sigma=sigma,
        discount_rate=discount_rate,
    )
    buffer_pv = buffer_detail.get("pv_total", 0.0)

    # --- Combine ----------------------------------------------------------
    # If both components are present, weight by their absolute PV value
    # (so a $100k rider doesn't get out-voted by a $1k buffer or vice versa).
    if rider_score is not None and buffer_pv > 0:
        w_rider  = rider_pv  / (rider_pv + buffer_pv) if (rider_pv + buffer_pv) > 0 else 0.5
        w_buffer = 1.0 - w_rider
        combined = w_rider * rider_score + w_buffer * buffer_s
        combined = max(0.0, min(100.0, combined))
        msg = (
            f"GV combines rider and buffer guarantees. {rider_msg} {buffer_msg} "
            f"PV-weighted blend ({w_rider:.0%} rider / {w_buffer:.0%} buffer)."
        )
        return combined, msg
    if rider_score is not None:
        return rider_score, rider_msg
    # No rider — fall back to buffer-only score (v1.2.0 replacement for 50)
    return buffer_s, buffer_msg


def sf_score(spec: dict) -> tuple[float, str]:
    """Rule-based surrender flexibility scoring."""
    base = spec.get("base", {})
    schedule = base.get("surrender_schedule", [])
    surrender_years = len(schedule)
    max_pct = max(schedule) if schedule else 0.0
    free_wd = base.get("free_withdrawal_pct", 0.10)
    nh = base.get("nursing_home_waiver", False)
    ti = base.get("terminal_illness_waiver", False)
    dis = base.get("disability_waiver", False)

    score = 100.0
    score -= 5.0 * surrender_years
    score -= max(0.0, max_pct * 100 - 5) * 5.0  # max_pct is decimal
    score += (free_wd * 100 - 10) * 1.0
    score += 5.0 if nh else 0.0
    score += 5.0 if ti else 0.0
    score += 5.0 if dis else 0.0
    score = max(0.0, min(100.0, score))

    waivers = [w for w, present in [("nursing-home", nh), ("terminal-illness", ti), ("disability", dis)] if present]
    waiver_str = ", ".join(waivers) if waivers else "none"
    return score, (
        f"{surrender_years}-yr surrender schedule (max {max_pct*100:.1f}%); "
        f"{free_wd*100:.0f}% free withdrawal; waivers: {waiver_str}."
    )


_AM_BEST_TO_SCORE = {
    "A++": 100, "A+": 95, "A": 88, "A-": 82,
    "B++": 70, "B+": 60, "B": 50, "B-": 40,
    "C++": 30, "C+": 20, "C": 10, "F": 0,
}


def ic_score(spec: dict) -> tuple[float, str]:
    """Insurer credit score: AM Best rating + PE/Level 3 penalties."""
    insurer = spec.get("insurer", {})
    am_best = insurer.get("am_best", "B+")
    base = _AM_BEST_TO_SCORE.get(am_best, 50)
    pe = insurer.get("pe_owned", False)
    level_3 = insurer.get("level_3_pct_2024", 0.10)
    adj = 0
    if pe:
        adj -= 10
    if level_3 > 0.25:
        adj -= 10
    elif level_3 > 0.15:
        adj -= 5
    score = max(0.0, min(100.0, base + adj))
    pe_str = "PE-owned" if pe else "not PE-owned"
    return score, (
        f"AM Best {am_best}; {pe_str}; Level 3 assets {level_3*100:.0f}%."
    )


def bf_score(spec: dict) -> tuple[float, str]:
    """Behavioral fairness: cap-reset history, complaints, fines."""
    bd = spec.get("behavioral_data")
    if not bd:
        return 70.0, "Insufficient public data on cap-reset history (defaults to 70)."

    cap_history = bd.get("cap_history", [])
    major_cuts = 0
    minor_cuts = 0
    for i in range(1, len(cap_history)):
        prev_cap = cap_history[i - 1]["cap"]
        new_cap = cap_history[i]["cap"]
        if prev_cap <= 0:
            continue
        delta = (prev_cap - new_cap) / prev_cap
        if delta > 0.25:
            major_cuts += 1
        elif delta > 0.10:
            minor_cuts += 1

    illustration_delta = bd.get("illustration_actual_delta", 0.0)
    complaints_idx = bd.get("naic_complaints_index", 0.5)
    fines = min(3, bd.get("regulatory_fines_5yr", 0))

    score = 100.0
    score -= 10.0 * major_cuts
    score -= 5.0 * minor_cuts
    if illustration_delta > 0.10:
        score -= 5.0
    score -= 2.0 * complaints_idx * 10  # complaints idx is 0..2-ish; tune
    score -= 5.0 * fines
    score = max(0.0, min(100.0, score))

    return score, (
        f"{major_cuts} major / {minor_cuts} minor cap-rate cuts in 5yr; "
        f"NAIC complaints index {complaints_idx:.2f}; "
        f"{bd.get('regulatory_fines_5yr', 0)} regulatory fines in 5yr."
    )


# ---------------------------------------------------------------------------
# Composite → letter
# ---------------------------------------------------------------------------

def composite_to_letter(score: float, letter_bands: list[dict]) -> str:
    """letter_bands is a list of {"min": float, "grade": str}, sorted desc by min."""
    bands = sorted(letter_bands, key=lambda b: -b["min"])
    for band in bands:
        if score >= band["min"]:
            return band["grade"]
    return bands[-1]["grade"]


# ---------------------------------------------------------------------------
# Narrative templates
# ---------------------------------------------------------------------------

def draft_narrative(spec: dict, sub_scores: dict, composite: float, letter: str,
                    methodology_version: str = "current") -> str:
    """Template-driven narrative; no LLM call. FSA edits this at sign time."""
    name = spec["name"]
    carrier = spec["carrier"]
    parts = [
        f"{carrier}'s {name} earns a composite score of {composite:.1f}, "
        f"which maps to a letter grade of {letter} under AnnuityVoice "
        f"Methodology {methodology_version}.",
    ]

    strengths = []
    weaknesses = []
    for label, key in [("Total Cost of Ownership", "tco"),
                       ("Guarantee Value", "gv"),
                       ("Surrender Flexibility", "sf"),
                       ("Insurer Credit", "ic"),
                       ("Behavioral Fairness", "bf")]:
        s = sub_scores[key]["score"]
        if s >= 80:
            strengths.append(f"{label} ({s:.0f})")
        elif s < 60:
            weaknesses.append(f"{label} ({s:.0f})")

    if strengths:
        parts.append(
            "Relative strengths versus the cohort include " + ", ".join(strengths) + "."
        )
    if weaknesses:
        parts.append(
            "Areas where this product scores below cohort median: "
            + ", ".join(weaknesses) + "."
        )

    parts.append(
        "This rating reflects the standardized scoring scenario (60-year-old male, "
        "$250,000 premium, income election at 65, 30-year horizon, 7% / 18% equity "
        "drift / vol, 4% discount rate). Contract terms vary; consult the product "
        "prospectus and a qualified advisor before purchase."
    )
    return " ".join(parts)


# ---------------------------------------------------------------------------
# Historical regime backtests (supplementary detail — NOT in composite)
# ---------------------------------------------------------------------------

def _regime_score_from_terminal_av(
    av_end: float,
    premium: float,
    floor_multiple: float = 0.5,
    ceiling_multiple: float = 2.0,
) -> float:
    """
    Map terminal AV to a 0-100 regime score.
      AV <= floor_multiple * premium  → 0
      AV >= ceiling_multiple * premium → 100
      linear in between.

    Heuristic — surfaces regime-dependent terminal-wealth differences across
    products in a transparent, deterministic way.  Not a probabilistic measure.
    """
    if premium <= 0:
        return 0.0
    lo = floor_multiple * premium
    hi = ceiling_multiple * premium
    if hi <= lo:
        return 50.0
    pct = (av_end - lo) / (hi - lo)
    return max(0.0, min(100.0, 100.0 * pct))


def compute_regime_outcomes(
    product_spec: dict,
    methodology: dict,
) -> dict:
    """
    Run `product_spec` through every regime in `methodology["regimes"]`,
    using deterministic single-path projections against actual S&P 500
    monthly returns (aggregated to annual factors).

    All outputs are deterministic functions of (product_spec, methodology) —
    no random number generation. Byte-reproducible by construction.
    """
    regimes_meta = methodology.get("regimes", [])
    if not regimes_meta:
        return {}

    scenario = methodology["scoring_scenario"]
    regime_cfg = methodology.get("regime_role", methodology.get("regime_scoring", {}))
    premium = scenario["premium"]
    age = scenario["age"]
    election_age = scenario["election_age"]

    floor_mult = regime_cfg.get("av_floor_multiple_of_premium", 0.5)
    ceiling_mult = regime_cfg.get("av_ceiling_multiple_of_premium", 2.0)

    max_years = max((r.get("years", 1) for r in regimes_meta), default=1)
    # Use the same 50/50 blended-gender cohort as the composite scoring
    # (v1.3.0). AV path is mortality-independent (fees and GLWB withdrawals
    # decrement AV directly, not via survival weights), so this is mainly
    # for documentation consistency with the composite scenario.
    survival = compute_survival_probs(
        current_age=age,
        gender="blend",
        base_calendar_year=2026,
        max_age=age + max_years,
        multiplier=1.0,
        table_name=scenario["mortality_table"],
    )
    discount = compute_discount_factors(scenario["discount_rate"], max_years + 1)

    rila = product_spec_to_rila(product_spec, premium)

    out: dict = {}
    for r in regimes_meta:
        key = r["key"]
        start_month = r["start_month"]
        requested_years = int(r["years"])

        factors, labels = _resolve_returns(
            start_month=start_month,
            total_periods=requested_years,
            periods_per_year=1,
        )
        actual_years = len(factors)
        history_truncated = actual_years < requested_years

        if actual_years == 0:
            out[key] = {
                "display_name": r["display_name"],
                "start_month":  start_month,
                "end_month":    start_month,
                "years":        0,
                "av_end":       premium,
                "av_min":       premium,
                "fees_pv":      0.0,
                "glwb_pv":      0.0,
                "gmdb_pv":      0.0,
                "shortfall_probability": 0.0,
                "regime_score": 50.0,
                "history_truncated": True,
            }
            continue

        annual_returns = np.array(factors, dtype=float)
        result = project_rila_path(
            rila,
            annual_returns,
            actual_years,
            glwb_election_age=election_age,
            current_age=age,
            survival_probs=survival,
            discount_factors=discount,
        )

        av_path = result["av_path"]
        av_end = float(result["av_end"])
        av_min = float(np.min(av_path)) if len(av_path) else premium
        shortfall = 1.0 if av_min <= 1e-6 else 0.0
        regime_score = _regime_score_from_terminal_av(
            av_end, premium, floor_mult, ceiling_mult
        )

        last_start_label = labels[-1] if labels else start_month
        try:
            ly, lm = last_start_label.split("-")
            lm_int = int(lm) + 11
            ly_int = int(ly) + lm_int // 12
            lm_int = (lm_int % 12)
            if lm_int == 0:
                lm_int = 12
                ly_int -= 1
            end_month = f"{ly_int:04d}-{lm_int:02d}"
        except Exception:
            end_month = last_start_label

        out[key] = {
            "display_name": r["display_name"],
            "start_month":  start_month,
            "end_month":    end_month,
            "years":        actual_years,
            "av_end":       round(av_end, 2),
            "av_min":       round(av_min, 2),
            "fees_pv":      round(float(result["fees_paid_pv"]), 2),
            "glwb_pv":      round(float(result["glwb_pv"]), 2),
            "gmdb_pv":      round(float(result["gmdb_pv"]), 2),
            "shortfall_probability": shortfall,
            "regime_score": round(regime_score, 1),
            "history_truncated": history_truncated,
        }

    return out


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def _score_blended(
    product_spec: dict,
    methodology: dict,
    cohort_tco_drags: list[float],
) -> tuple[dict, dict, dict]:
    """Run the scoring scenario once with 50/50 blended-gender mortality."""
    scenario = methodology["scoring_scenario"]
    weights = methodology["weights"]
    letter_bands = methodology["letter_bands"]

    premium = scenario["premium"]
    horizon = scenario["horizon_years"]

    survival = compute_survival_probs(
        current_age=scenario["age"],
        gender="blend",
        base_calendar_year=2026,
        max_age=scenario["age"] + horizon,
        multiplier=1.0,
        table_name=scenario["mortality_table"],
    )
    discount = compute_discount_factors(scenario["discount_rate"], horizon + 1)
    persistency = compute_persistency(survival, scenario.get("base_lapse", 0.0))

    rila = product_spec_to_rila(product_spec, premium)
    mc = project_rila_monte_carlo(
        rila,
        mu=scenario["mu"],
        sigma=scenario["sigma"],
        projection_years=horizon,
        n_scenarios=scenario["num_scenarios"],
        seed=scenario["seed"],
        survival_probs=persistency,
        discount_factors=discount,
        glwb_election_age=scenario["election_age"],
        current_age=scenario["age"],
    )

    tco_s, tco_rationale = tco_score(product_spec, mc, cohort_tco_drags, premium)
    gv_s,  gv_rationale  = gv_score(
        product_spec, mc, premium, horizon,
        mu=scenario["mu"], sigma=scenario["sigma"],
        discount_rate=scenario["discount_rate"],
    )
    sf_s,  sf_rationale  = sf_score(product_spec)
    ic_s,  ic_rationale  = ic_score(product_spec)
    bf_s,  bf_rationale  = bf_score(product_spec)

    sub_scores = {
        "tco": {"score": round(tco_s, 1), "rationale": tco_rationale},
        "gv":  {"score": round(gv_s,  1), "rationale": gv_rationale},
        "sf":  {"score": round(sf_s,  1), "rationale": sf_rationale},
        "ic":  {"score": round(ic_s,  1), "rationale": ic_rationale},
        "bf":  {"score": round(bf_s,  1), "rationale": bf_rationale},
    }
    composite = (
        weights["tco"] * tco_s + weights["gv"] * gv_s + weights["sf"] * sf_s
        + weights["ic"] * ic_s + weights["bf"] * bf_s
    )
    letter = composite_to_letter(composite, letter_bands)
    mc_summary = {
        "fees_pv_mean":  round(mc["fees_pv_mean"], 2),
        "glwb_pv_mean":  round(mc["glwb_pv_mean"], 2),
        "gmdb_pv_mean":  round(mc["gmdb_pv_mean"], 2),
        "av_end_p5":     round(mc["av_end_p5"], 2),
        "av_end_p50":    round(mc["av_end_p50"], 2),
        "av_end_p95":    round(mc["av_end_p95"], 2),
    }
    return sub_scores, mc_summary, {"composite": round(composite, 1), "letter": letter}


def compute_rating(
    product_spec: dict,
    methodology: dict,
    cohort_tco_drags: Optional[list[float]] = None,
    scored_at: str = "1970-01-01T00:00:00Z",
) -> dict:
    """Score `product_spec` against `methodology` and return rating JSON.

    A single scoring run uses 50/50 blended-gender mortality. The rating
    output exposes one composite, one set of sub-scores, and one Monte
    Carlo summary — no M/F split.
    """
    scenario = methodology["scoring_scenario"]

    if cohort_tco_drags is None:
        cohort_tco_drags = [0.020, 0.025, 0.030, 0.035, 0.040]

    spec_hash = hashlib.sha256(
        json.dumps(product_spec, sort_keys=True).encode("utf-8")
    ).hexdigest()

    sub_scores, mc_summary, comp = _score_blended(
        product_spec, methodology, cohort_tco_drags,
    )
    feature_snapshot = _carrier_feature_snapshot(product_spec)
    regimes = compute_regime_outcomes(product_spec, methodology)
    narrative = draft_narrative(
        product_spec, sub_scores, comp["composite"], comp["letter"],
        methodology_version=methodology["version"],
    )

    return {
        "product_slug": product_spec["slug"],
        "product_name": product_spec["name"],
        "carrier": product_spec["carrier"],
        "methodology_version": methodology["version"],
        "product_spec_hash": spec_hash,
        "scored_at": scored_at,
        "scoring_inputs": {
            "premium": scenario["premium"],
            "horizon_years": scenario["horizon_years"],
            "age": scenario["age"],
            "gender": "blend",
        },
        "monte_carlo": mc_summary,
        "sub_scores": sub_scores,
        "composite": comp["composite"],
        "letter_grade": comp["letter"],
        "feature_snapshot": feature_snapshot,
        "regimes": regimes,
        "narrative": narrative,
        "verdict": _build_verdict(sub_scores),
        "signed_by": None,
        "signed_credentials": None,
        "signed_at": None,
        "status": "draft",
    }


# ---------------------------------------------------------------------------
# Verdict + feature snapshot — UX helpers, deterministic / algorithmic
# ---------------------------------------------------------------------------

_SCORE_LABELS = {
    "tco": "low fees",
    "gv":  "strong guarantee value",
    "sf":  "flexible surrender terms",
    "ic":  "strong insurer credit",
    "bf":  "consistent carrier behavior",
}
_WEAK_LABELS = {
    "tco": "high fee drag",
    "gv":  "weak guarantee value",
    "sf":  "restrictive surrender terms",
    "ic":  "below-average insurer credit",
    "bf":  "uneven carrier behavior",
}


def _build_verdict(sub_scores: dict) -> str:
    """
    One-sentence synthesised verdict from strongest + weakest sub-score.

    Algorithmic (no LLM); used as the top-of-detail summary line.
    """
    items = [(k, sub_scores[k]["score"]) for k in ("tco", "gv", "sf", "ic", "bf")]
    items.sort(key=lambda x: x[1], reverse=True)
    top_k, top_s = items[0]
    bot_k, bot_s = items[-1]

    # All-strong or all-weak edge cases
    if top_s >= 75 and bot_s >= 75:
        return f"Solid across the board — top-ranked area is {_SCORE_LABELS[top_k]} ({top_s:.0f})."
    if top_s < 50 and bot_s < 50:
        return f"Weak across the board — biggest concern is {_WEAK_LABELS[bot_k]} ({bot_s:.0f})."
    if bot_s >= 60:
        return f"Mostly solid; strongest in {_SCORE_LABELS[top_k]} ({top_s:.0f}), softest in {_WEAK_LABELS[bot_k]} ({bot_s:.0f})."
    return f"{_SCORE_LABELS[top_k].capitalize()} ({top_s:.0f}) offset by {_WEAK_LABELS[bot_k]} ({bot_s:.0f})."


def _carrier_feature_snapshot(spec: dict) -> dict:
    """
    Spec-derived feature summary surfaced on the ratings index.

    Pure projection of contract terms — no engine, no Monte Carlo.
    Whatever is added here becomes available to the lens-based index columns.
    """
    base = spec.get("base", {}) or {}
    rider = spec.get("rider", {}) or {}
    insurer = spec.get("insurer", {}) or {}
    behavioral = spec.get("behavioral_data", {}) or {}

    schedule = base.get("surrender_schedule", []) or []
    has_glwb = rider.get("type") == "glwb"

    # Headline cap — first cap segment encountered, if any
    headline_cap = None
    for seg in spec.get("segments_available", []) or []:
        if seg.get("crediting_method") == "cap" and seg.get("cap_rate") is not None:
            headline_cap = seg["cap_rate"]
            break

    waivers = [
        name for name, present in [
            ("nursing-home", base.get("nursing_home_waiver", False)),
            ("terminal-illness", base.get("terminal_illness_waiver", False)),
            ("disability", base.get("disability_waiver", False)),
        ] if present
    ]

    return {
        "me_fee_annual":          base.get("me_fee_annual", 0.0),
        "rider_fee_annual":       rider.get("rider_fee_annual", 0.0) if has_glwb else 0.0,
        "rollup_rate":            rider.get("rollup_rate", 0.0) if has_glwb else 0.0,
        "withdrawal_rate_65":     (rider.get("withdrawal_rate_by_age", {}) or {}).get("65+", 0.0) if has_glwb else 0.0,
        "surrender_years":        len(schedule),
        "surrender_max_pct":      max(schedule) if schedule else 0.0,
        "free_withdrawal_pct":    base.get("free_withdrawal_pct", 0.0),
        "waivers":                waivers,
        "waiver_count":           len(waivers),
        "step_up":                bool(rider.get("step_up", False)) if has_glwb else False,
        "has_glwb":               has_glwb,
        "headline_cap":           headline_cap,
        "am_best":                insurer.get("am_best"),
        "pe_owned":               bool(insurer.get("pe_owned", False)),
        "level_3_pct_2024":       insurer.get("level_3_pct_2024"),
        "cap_cut_count_5yr":      max(0, len(behavioral.get("cap_history", []) or []) - 1),
        "product_type":           spec.get("product_type"),
        "first_offered":          spec.get("first_offered"),
    }
