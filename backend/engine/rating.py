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

from .historical import _resolve_returns
from .mortality import compute_survival_probs
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

    # Resolve withdrawal rate at age 65 (the scoring scenario's election age)
    wd_rate_by_age = rider.get("withdrawal_rate_by_age", {})
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


def gv_score(spec: dict, mc_result: dict, premium: float, horizon_years: int) -> tuple[float, str]:
    """
    GV = Monte Carlo PV of rider claims / PV of rider fees.
    Higher ratio = better. Products without riders neutral 50.
    """
    rider = spec.get("rider")
    if not rider or rider.get("type") != "glwb":
        return 50.0, "No income rider — guarantee value is neutral (50)."

    glwb_pv = mc_result["glwb_pv_mean"]
    rider_fee_annual = rider.get("rider_fee_annual", 0.0)
    # PV(rider fees) ≈ rider_fee * premium * survival/discount summed
    # Already in mc_result["fees_pv_mean"] but that's all-in. Approximate rider PV:
    rider_fees_pv = rider_fee_annual * premium * horizon_years * 0.7  # rough discount/survival adj
    if rider_fees_pv <= 0:
        return 50.0, "Rider fee is zero — guarantee value undefined."
    ratio = glwb_pv / rider_fees_pv
    # Map ratio to score: 1.0x = 50 (break-even), 2.0x = 100, 0.5x = 25
    score = 50.0 * ratio
    score = max(0.0, min(100.0, score))
    return score, (
        f"PV(GLWB claims) / PV(rider fees) ≈ {ratio:.2f}x. "
        f"GLWB PV ${glwb_pv:,.0f}; rider fee PV ${rider_fees_pv:,.0f}."
    )


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

def draft_narrative(spec: dict, sub_scores: dict, composite: float, letter: str) -> str:
    """Template-driven narrative; no LLM call. FSA edits this at sign time."""
    name = spec["name"]
    carrier = spec["carrier"]
    parts = [
        f"{carrier}'s {name} earns a composite score of {composite:.1f}, "
        f"which maps to a letter grade of {letter} under AnnuityVoice "
        f"Methodology v1.0.0.",
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
    regime_cfg = methodology.get("regime_scoring", {})
    premium = scenario["premium"]
    age = scenario["age"]
    election_age = scenario["election_age"]

    floor_mult = regime_cfg.get("av_floor_multiple_of_premium", 0.5)
    ceiling_mult = regime_cfg.get("av_ceiling_multiple_of_premium", 2.0)

    max_years = max((r.get("years", 1) for r in regimes_meta), default=1)
    # Gender-neutral default for regime survival (uses male; regime is comparative
    # across products, so gender is held constant rather than blended).
    survival = compute_survival_probs(
        current_age=age,
        gender="male",
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

def _score_for_gender(
    product_spec: dict,
    methodology: dict,
    gender_code: str,
    cohort_tco_drags: list[float],
) -> tuple[dict, dict, dict]:
    """
    Run the scoring scenario for a single gender ("M" or "F").

    Returns:
        (sub_scores, monte_carlo_summary, composite_info)
        composite_info = {"composite": float, "letter": str}
    """
    scenario = methodology["scoring_scenario"]
    weights = methodology["weights"]
    letter_bands = methodology["letter_bands"]

    premium = scenario["premium"]
    horizon = scenario["horizon_years"]

    survival = compute_survival_probs(
        current_age=scenario["age"],
        gender="male" if gender_code == "M" else "female",
        base_calendar_year=2026,
        max_age=scenario["age"] + horizon,
        multiplier=1.0,
        table_name=scenario["mortality_table"],
    )
    discount = compute_discount_factors(scenario["discount_rate"], horizon + 1)

    rila = product_spec_to_rila(product_spec, premium)
    mc = project_rila_monte_carlo(
        rila,
        mu=scenario["mu"],
        sigma=scenario["sigma"],
        projection_years=horizon,
        n_scenarios=scenario["num_scenarios"],
        seed=scenario["seed"],
        survival_probs=survival,
        discount_factors=discount,
        glwb_election_age=scenario["election_age"],
        current_age=scenario["age"],
    )

    tco_s, tco_rationale = tco_score(product_spec, mc, cohort_tco_drags, premium)
    gv_s,  gv_rationale  = gv_score(product_spec, mc, premium, horizon)
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


def _blend_sub_scores(male: dict, female: dict) -> dict:
    """Element-wise 50/50 average of sub-scores. Rationales come from male (gender-invariant)."""
    out = {}
    for key in ("tco", "gv", "sf", "ic", "bf"):
        m_s = male[key]["score"]
        f_s = female[key]["score"]
        blended = (m_s + f_s) / 2.0
        # Use male rationale unless GV (which is the only one that varies meaningfully by mortality);
        # for GV give a blended summary.
        if key == "gv":
            rationale = (
                f"{male[key]['rationale']} (male) / "
                f"{female[key]['rationale']} (female)"
            )
        else:
            rationale = male[key]["rationale"]
        out[key] = {"score": round(blended, 1), "rationale": rationale}
    return out


def _blend_monte_carlo(male: dict, female: dict) -> dict:
    """50/50 average of Monte Carlo summary stats."""
    return {
        k: round((male[k] + female[k]) / 2.0, 2) for k in male
    }


def compute_rating(
    product_spec: dict,
    methodology: dict,
    cohort_tco_drags: Optional[list[float]] = None,
    scored_at: str = "1970-01-01T00:00:00Z",
    gender_override: Optional[str] = None,
) -> dict:
    """
    Run the standardized scoring scenario for `product_spec` and return rating JSON.

    Args:
        product_spec: parsed product JSON
        methodology: parsed methodology JSON
        cohort_tco_drags: list of TCO drag values for all products in cohort
                          (needed for relative TCO scoring). If None, uses
                          a synthetic anchor cohort.
        scored_at: ISO timestamp to embed in output. Pass a fixed string
                   for reproducibility; CLI usually sets this from product
                   spec mtime or an explicit arg.
        gender_override: if "M" or "F", emit only that single-gender rating
                         (no male/female/blended split). Used by API callers
                         that want a single-perspective view. The default
                         (None) produces the blended composite as the
                         published score and exposes male_scores /
                         female_scores / blended_scores breakdowns.
    """
    scenario = methodology["scoring_scenario"]

    if cohort_tco_drags is None:
        # Synthetic anchor cohort — the spec demands a relative measure even
        # before all 25 ratings are computed. Anchors derived from typical
        # RILA cost profiles.
        cohort_tco_drags = [0.020, 0.025, 0.030, 0.035, 0.040]

    spec_hash = hashlib.sha256(
        json.dumps(product_spec, sort_keys=True).encode("utf-8")
    ).hexdigest()

    # ------------------------------------------------------------------
    # Single-gender override path — emit a focused rating (no blend split)
    # ------------------------------------------------------------------
    if gender_override in ("M", "F"):
        sub_scores, mc_summary, comp = _score_for_gender(
            product_spec, methodology, gender_override, cohort_tco_drags,
        )
        narrative = draft_narrative(
            product_spec, sub_scores, comp["composite"], comp["letter"]
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
                "gender": gender_override,
                "gender_blend": False,
            },
            "monte_carlo": mc_summary,
            "sub_scores": sub_scores,
            "composite": comp["composite"],
            "letter_grade": comp["letter"],
            "narrative": narrative,
            "signed_by": None,
            "signed_credentials": None,
            "signed_at": None,
            "status": "draft",
        }

    # ------------------------------------------------------------------
    # Default path — produce M, F, and a 50/50 blended composite
    # ------------------------------------------------------------------
    genders = scenario.get("genders", [scenario.get("gender", "M")])

    male_sub, male_mc, male_comp = _score_for_gender(
        product_spec, methodology, "M", cohort_tco_drags,
    )
    if "F" in genders:
        female_sub, female_mc, female_comp = _score_for_gender(
            product_spec, methodology, "F", cohort_tco_drags,
        )
    else:
        # Methodology asks for male-only; mirror male into female for shape stability.
        female_sub, female_mc, female_comp = male_sub, male_mc, male_comp

    blended_sub = _blend_sub_scores(male_sub, female_sub)
    blended_mc = _blend_monte_carlo(male_mc, female_mc)
    blended_composite = round(
        (male_comp["composite"] + female_comp["composite"]) / 2.0, 1
    )
    blended_letter = composite_to_letter(
        blended_composite, methodology["letter_bands"]
    )

    # Carrier feature snapshot — surfaced on the index so advisors can compare
    # contract terms without opening every product. Pure spec lookup; no engine.
    feature_snapshot = _carrier_feature_snapshot(product_spec)

    # Historical regime backtests — supplementary detail, NOT in composite.
    regimes = compute_regime_outcomes(product_spec, methodology)

    narrative = draft_narrative(
        product_spec, blended_sub, blended_composite, blended_letter
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
            "gender_blend": True,
            "genders_blended": list(genders),
        },
        "monte_carlo": blended_mc,
        "monte_carlo_male": male_mc,
        "monte_carlo_female": female_mc,
        "sub_scores": blended_sub,
        "male_scores": male_sub,
        "female_scores": female_sub,
        "blended_scores": blended_sub,
        "male_composite": male_comp["composite"],
        "female_composite": female_comp["composite"],
        "male_letter_grade": male_comp["letter"],
        "female_letter_grade": female_comp["letter"],
        "composite": blended_composite,
        "letter_grade": blended_letter,
        "feature_snapshot": feature_snapshot,
        "regimes": regimes,
        "narrative": narrative,
        "verdict": _build_verdict(blended_sub),
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
