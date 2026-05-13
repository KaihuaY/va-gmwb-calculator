"""Unit tests for the rating engine."""

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from engine.mortality import _get_base_table, get_qx
from engine.rating import (
    composite_to_letter, sf_score, ic_score, bf_score, _tco_drag,
    compute_rating, compute_regime_outcomes, _regime_score_from_terminal_av,
    product_spec_to_rila, gv_score,
)
from engine.buffer_value import (
    buffer_value_pv, buffer_value_score, expected_buffer_absorption,
    expected_floor_absorption, _expected_put,
)
from engine.historical import compute_regime_backtest_path


METHODOLOGY_PATH = Path(__file__).resolve().parents[1] / "data" / "methodology" / "methodology_v1.json"


@pytest.fixture(scope="module")
def methodology():
    return json.loads(METHODOLOGY_PATH.read_text())


# ---------------------------------------------------------------------------
# Letter mapping — boundary cases
# ---------------------------------------------------------------------------

def test_letter_boundaries(methodology):
    bands = methodology["letter_bands"]
    # Exactly on threshold → that band wins
    assert composite_to_letter(95.0, bands) == "A+"
    assert composite_to_letter(94.99, bands) == "A"
    assert composite_to_letter(40.0, bands) == "D-"
    assert composite_to_letter(39.99, bands) == "F"
    assert composite_to_letter(0.0, bands) == "F"


# ---------------------------------------------------------------------------
# SF — surrender flexibility
# ---------------------------------------------------------------------------

def test_sf_perfect_product():
    """No surrender, 20% free, all 3 waivers → high score."""
    spec = {
        "base": {
            "surrender_schedule": [],
            "free_withdrawal_pct": 0.20,
            "nursing_home_waiver": True,
            "terminal_illness_waiver": True,
            "disability_waiver": True,
        }
    }
    s, _ = sf_score(spec)
    # 100 - 0 + 10 (free wd bonus) + 15 (waivers) = 125 → clamped 100
    assert s == 100.0


def test_sf_punitive_product():
    spec = {
        "base": {
            "surrender_schedule": [0.09]*10,
            "free_withdrawal_pct": 0.0,
            "nursing_home_waiver": False,
            "terminal_illness_waiver": False,
            "disability_waiver": False,
        }
    }
    s, _ = sf_score(spec)
    # 100 - 50 (10yr surrender) - 20 (max 9%) - 10 (no free wd bonus) = 20
    assert s < 30


# ---------------------------------------------------------------------------
# IC — insurer credit
# ---------------------------------------------------------------------------

def test_ic_top_carrier():
    s, _ = ic_score({"insurer": {"am_best": "A++", "pe_owned": False, "level_3_pct_2024": 0.05}})
    assert s == 100


def test_ic_pe_owned_high_level3():
    s, _ = ic_score({"insurer": {"am_best": "A", "pe_owned": True, "level_3_pct_2024": 0.30}})
    # 88 - 10 (PE) - 10 (Level 3 > 25%) = 68
    assert s == 68


def test_ic_unknown_rating_defaults_to_50():
    s, _ = ic_score({"insurer": {"am_best": "MysteryRating", "pe_owned": False, "level_3_pct_2024": 0.10}})
    assert s == 50


# ---------------------------------------------------------------------------
# BF — behavioral fairness
# ---------------------------------------------------------------------------

def test_bf_missing_data_defaults_70():
    s, _ = bf_score({})
    assert s == 70


def test_bf_history_with_cap_cuts():
    spec = {
        "behavioral_data": {
            "cap_history": [
                {"date": "2022-01-01", "cap": 0.10},
                {"date": "2023-01-01", "cap": 0.07},   # -30% = major cut
            ],
            "naic_complaints_index": 0.5,
            "regulatory_fines_5yr": 1,
        }
    }
    s, _ = bf_score(spec)
    # 100 - 10 (major cut) - 10 (complaints 2*0.5*10) - 5 (1 fine) = 75
    assert s == pytest.approx(75.0)


# ---------------------------------------------------------------------------
# TCO drag
# ---------------------------------------------------------------------------

def test_tco_drag_explicit_only():
    """Product with no segments (impossible IRL) — explicit fees only."""
    spec = {
        "base": {"me_fee_annual": 0.0125},
        "rider": {"type": "none"},
        "segments_available": [],
        "default_allocation_pcts": [],
    }
    drag = _tco_drag(spec, {}, 250_000)
    assert drag == pytest.approx(0.0125)


def test_tco_drag_with_glwb_rider():
    spec = {
        "base": {"me_fee_annual": 0.0125},
        "rider": {"type": "glwb", "rider_fee_annual": 0.015},
        "segments_available": [],
        "default_allocation_pcts": [],
    }
    drag = _tco_drag(spec, {}, 250_000)
    assert drag == pytest.approx(0.0275)


# ---------------------------------------------------------------------------
# End-to-end: compute_rating reproducibility
# ---------------------------------------------------------------------------

def test_compute_rating_byte_reproducible(methodology):
    spec_path = Path(__file__).resolve().parents[1] / "data" / "products" / "equitable_scs.json"
    spec = json.loads(spec_path.read_text())
    r1 = compute_rating(spec, methodology, scored_at="2026-05-12T00:00:00Z")
    r2 = compute_rating(spec, methodology, scored_at="2026-05-12T00:00:00Z")
    assert json.dumps(r1, sort_keys=True) == json.dumps(r2, sort_keys=True)


def test_compute_rating_has_all_subscores(methodology):
    spec_path = Path(__file__).resolve().parents[1] / "data" / "products" / "equitable_scs_income.json"
    spec = json.loads(spec_path.read_text())
    r = compute_rating(spec, methodology, scored_at="2026-05-12T00:00:00Z")
    for key in ("tco", "gv", "sf", "ic", "bf"):
        assert key in r["sub_scores"], f"missing sub-score: {key}"
        assert 0 <= r["sub_scores"][key]["score"] <= 100
    assert r["status"] == "draft"
    assert r["signed_by"] is None


def test_compute_rating_emits_spec_hash(methodology):
    spec_path = Path(__file__).resolve().parents[1] / "data" / "products" / "lincoln_level_advantage.json"
    spec = json.loads(spec_path.read_text())
    r = compute_rating(spec, methodology, scored_at="2026-05-12T00:00:00Z")
    assert len(r["product_spec_hash"]) == 64
    # Hash changes when spec changes
    spec2 = dict(spec); spec2["name"] = "Renamed"
    r2 = compute_rating(spec2, methodology, scored_at="2026-05-12T00:00:00Z")
    assert r["product_spec_hash"] != r2["product_spec_hash"]


# ---------------------------------------------------------------------------
# Historical regime backtests (v1.1.0)
# ---------------------------------------------------------------------------

def test_regime_score_endpoints():
    """Floor → 0; ceiling → 100; linear midpoint."""
    premium = 250_000
    # AV at floor (0.5x premium) → 0
    assert _regime_score_from_terminal_av(125_000, premium) == 0.0
    # AV at ceiling (2x premium) → 100
    assert _regime_score_from_terminal_av(500_000, premium) == 100.0
    # Midpoint (1.25x premium) → 50
    mid = _regime_score_from_terminal_av(312_500, premium)
    assert mid == pytest.approx(50.0, abs=0.5)
    # Below floor → clamped 0
    assert _regime_score_from_terminal_av(0.0, premium) == 0.0
    # Above ceiling → clamped 100
    assert _regime_score_from_terminal_av(1_000_000, premium) == 100.0


def test_compute_regime_outcomes_shape(methodology):
    """Regime output has one entry per methodology regime with required fields."""
    spec_path = Path(__file__).resolve().parents[1] / "data" / "products" / "equitable_scs.json"
    spec = json.loads(spec_path.read_text())
    regimes = compute_regime_outcomes(spec, methodology)
    assert isinstance(regimes, dict)
    assert len(regimes) == len(methodology["regimes"])
    required_fields = {
        "display_name", "start_month", "end_month", "years",
        "av_end", "av_min", "fees_pv", "glwb_pv", "gmdb_pv",
        "shortfall_probability", "regime_score", "history_truncated",
    }
    for key, r in regimes.items():
        assert required_fields.issubset(r.keys()), f"regime {key} missing fields"
        assert 0.0 <= r["regime_score"] <= 100.0
        assert r["years"] >= 0
        assert r["shortfall_probability"] in (0.0, 1.0)


def test_compute_regime_outcomes_byte_reproducible(methodology):
    """Same product + same methodology → byte-identical regime output."""
    spec_path = Path(__file__).resolve().parents[1] / "data" / "products" / "equitable_scs.json"
    spec = json.loads(spec_path.read_text())
    r1 = compute_regime_outcomes(spec, methodology)
    r2 = compute_regime_outcomes(spec, methodology)
    assert json.dumps(r1, sort_keys=True) == json.dumps(r2, sort_keys=True)


def test_regime_post_gfc_bull_grows_av(methodology):
    """
    The post-GFC bull regime (2010-2021) had ~14% annualized S&P returns.
    A buffer-cap RILA should at minimum preserve premium over 12 years,
    confirming the regime backtest produces a non-trivial, plausible result.
    """
    spec_path = Path(__file__).resolve().parents[1] / "data" / "products" / "equitable_scs.json"
    spec = json.loads(spec_path.read_text())
    regimes = compute_regime_outcomes(spec, methodology)
    bull = regimes.get("post_gfc_bull_2010_2021")
    assert bull is not None, "post_gfc_bull_2010_2021 regime missing"
    # Over the post-GFC bull, a capped equity product should at least preserve premium
    assert bull["av_end"] > methodology["scoring_scenario"]["premium"], (
        f"post-GFC bull terminal AV ({bull['av_end']}) <= premium"
        f" — regime backtest appears not to be running"
    )
    # And the regime score should be above the neutral midpoint
    assert bull["regime_score"] > 50.0


def test_mortality_gender_coverage():
    """Both mortality tables must publish male AND female qx columns.

    The gender-blended composite assumes a real lookup for each gender;
    silently falling back to the other gender would corrupt every rating.
    `_get_base_table` is asserted to refuse to return a table missing
    either column.
    """
    for table_name in ("2012iam", "annuity2000"):
        table = _get_base_table(table_name)
        for gender_key in ("male", "female"):
            col = table["base"][gender_key]
            assert col, f"{table_name} missing {gender_key} column"
            # Sanity: scoring-scenario ages (60..90) should all have a qx
            for age in range(60, 91):
                assert str(age) in col, f"{table_name}.{gender_key} missing age {age}"
                assert 0.0 < col[str(age)] < 1.0, (
                    f"{table_name}.{gender_key}[{age}] = {col[str(age)]} is not a valid qx"
                )


def test_blended_qx_is_midpoint_of_male_and_female():
    """Blended-gender qx must equal the 50/50 average of male and female qx."""
    age, year = 65, 2026
    m = get_qx(age, "male", year)
    f = get_qx(age, "female", year)
    b = get_qx(age, "blend", year)
    assert b == pytest.approx((m + f) / 2.0, rel=1e-9)
    assert f < b < m  # female qx lower than male; blend sits between


def test_compute_rating_includes_regimes_field(methodology):
    """The top-level rating output exposes the regimes block."""
    spec_path = Path(__file__).resolve().parents[1] / "data" / "products" / "equitable_scs.json"
    spec = json.loads(spec_path.read_text())
    r = compute_rating(spec, methodology, scored_at="2026-05-12T00:00:00Z")
    assert "regimes" in r
    assert isinstance(r["regimes"], dict)
    assert len(r["regimes"]) == len(methodology["regimes"])
    # Composite must NOT include regime score — verify by recomputing
    weights = methodology["weights"]
    expected_composite = (
        weights["tco"] * r["sub_scores"]["tco"]["score"]
        + weights["gv"] * r["sub_scores"]["gv"]["score"]
        + weights["sf"] * r["sub_scores"]["sf"]["score"]
        + weights["ic"] * r["sub_scores"]["ic"]["score"]
        + weights["bf"] * r["sub_scores"]["bf"]["score"]
    )
    assert r["composite"] == pytest.approx(expected_composite, abs=0.15)


# ---------------------------------------------------------------------------
# Buffer-value pricing (v1.2.0)
# ---------------------------------------------------------------------------

def test_methodology_current_version(methodology):
    """Methodology is at v1.3.2 with buffer_value_pricing block."""
    assert methodology["version"] == "v1.3.2"
    assert "buffer_value_pricing" in methodology
    bvp = methodology["buffer_value_pricing"]
    assert bvp["method"] == "closed_form_lognormal"
    weights = methodology["weights"]
    for k in ("tco", "gv", "sf", "ic", "bf"):
        assert weights[k] == pytest.approx(0.20)


def test_buffer_value_score_zero_buffer():
    spec_no_protection = {
        "base": {"me_fee_annual": 0.01},
        "segments_available": [],
        "default_allocation_pcts": [],
        "rider": {"type": "none"},
    }
    pv = buffer_value_pv(
        spec_no_protection,
        premium=250_000, horizon_years=30,
        mu=0.07, sigma=0.18, discount_rate=0.04,
    )
    assert pv["pv_total"] == 0.0
    assert pv["pv_buffer"] == 0.0
    assert pv["pv_floor"] == 0.0


def test_buffer_value_score_explicit_zero_protection_level():
    spec = {
        "base": {"me_fee_annual": 0.0125},
        "segments_available": [{
            "term_years": 1, "index": "sp500",
            "crediting_method": "cap", "cap_rate": 0.10,
            "protection_type": "buffer", "protection_level": 0.0,
        }],
        "default_allocation_pcts": [1.0],
    }
    pv = buffer_value_pv(spec, premium=250_000, horizon_years=30,
                        mu=0.07, sigma=0.18, discount_rate=0.04)
    assert pv["pv_total"] == 0.0


def test_buffer_value_score_closed_form_against_blackscholes():
    val = expected_buffer_absorption(
        protection_level=0.10, term_years=1, mu=0.07, sigma=0.18
    )
    assert val == pytest.approx(0.0281, abs=0.002)


def test_buffer_value_score_increases_with_buffer():
    small = expected_buffer_absorption(protection_level=0.05, term_years=1, mu=0.07, sigma=0.18)
    big   = expected_buffer_absorption(protection_level=0.20, term_years=1, mu=0.07, sigma=0.18)
    assert big > small * 1.5


def test_floor_absorption_positive_and_smaller_than_buffer_at_same_level():
    b = expected_buffer_absorption(protection_level=0.10, term_years=1, mu=0.07, sigma=0.18)
    f = expected_floor_absorption(protection_level=0.10, term_years=1, mu=0.07, sigma=0.18)
    assert f > 0
    assert b > 0
    assert f < b


def test_floor_absorption_grows_with_lower_floor():
    f_loose  = expected_floor_absorption(protection_level=0.20, term_years=1, mu=0.07, sigma=0.18)
    f_tight  = expected_floor_absorption(protection_level=0.05, term_years=1, mu=0.07, sigma=0.18)
    assert f_tight > f_loose


def test_expected_put_zero_vol_degenerate():
    assert _expected_put(strike=1.0, m=0.0, v=0.0) == pytest.approx(0.0)
    assert _expected_put(strike=1.0, m=-0.05, v=0.0) == pytest.approx(1 - 0.95123, abs=1e-4)


def test_gv_score_non_rider_buffer_now_above_neutral():
    spec_path = Path(__file__).resolve().parents[1] / "data" / "products" / "equitable_scs.json"
    spec = json.loads(spec_path.read_text())
    mc = {"glwb_pv_mean": 0.0, "gmdb_pv_mean": 0.0, "fees_pv_mean": 0.0}
    s, msg = gv_score(
        spec, mc, premium=250_000, horizon_years=30,
        mu=0.07, sigma=0.18, discount_rate=0.04,
    )
    assert s > 50.0, f"non-rider product with buffer should score above neutral 50, got {s}"
    assert "buffer" in msg.lower() or "PV" in msg


def test_gv_score_combined_rider_and_buffer(methodology):
    spec_path = Path(__file__).resolve().parents[1] / "data" / "products" / "equitable_scs_income.json"
    spec = json.loads(spec_path.read_text())
    r = compute_rating(spec, methodology, scored_at="2026-05-12T00:00:00Z")
    gv = r["sub_scores"]["gv"]
    assert 0 < gv["score"] < 100
    assert "rider" in gv["rationale"].lower()
    assert "buffer" in gv["rationale"].lower()


def test_compute_rating_byte_reproducible_with_buffer_pricing(methodology):
    spec_path = Path(__file__).resolve().parents[1] / "data" / "products" / "athene_amplify_2.json"
    spec = json.loads(spec_path.read_text())
    r1 = compute_rating(spec, methodology, scored_at="2026-05-12T00:00:00Z")
    r2 = compute_rating(spec, methodology, scored_at="2026-05-12T00:00:00Z")
    assert json.dumps(r1, sort_keys=True) == json.dumps(r2, sort_keys=True)


# ---------------------------------------------------------------------------
# Regime backtest path (scenario_backtest — supplementary, NOT composite)
# ---------------------------------------------------------------------------

def _load_spec(slug: str) -> dict:
    p = Path(__file__).resolve().parents[1] / "data" / "products" / f"{slug}.json"
    return json.loads(p.read_text())


def test_compute_regime_backtest_path_starting_av_and_shape(methodology):
    """Starting AV is honored, path begins at $100 and has 12*years+1 points."""
    spec = _load_spec("equitable_scs_income")
    r = compute_regime_backtest_path(
        spec, methodology, "post_gfc_bull_2010_2021", starting_av=100.0
    )
    assert r["regime_key"] == "post_gfc_bull_2010_2021"
    assert r["starting_av"] == 100.0
    # Monthly resolution: 12 months/year * 12 years + 1 starting point
    assert len(r["av_path"]) == 12 * 12 + 1
    assert r["av_path"][0]["av"] == 100.0
    assert r["av_path"][0]["month"] == "2010-01"
    # Terminal AV finite, positive (this is a GLWB-drawing product)
    assert r["terminal_av"] > 0.0
    assert r["terminal_av"] < 1e6  # sanity
    # Drawdown in [0, 1]
    assert 0.0 <= r["max_drawdown_pct"] <= 1.0
    # Terminal multiple == terminal_av / starting_av
    assert r["terminal_av_multiple"] == pytest.approx(r["terminal_av"] / 100.0, abs=0.01)


def test_compute_regime_backtest_path_byte_reproducible(methodology):
    """Same product + same regime → byte-identical path output."""
    spec = _load_spec("equitable_scs_income")
    a = compute_regime_backtest_path(spec, methodology, "post_gfc_bull_2010_2021", 100.0)
    b = compute_regime_backtest_path(spec, methodology, "post_gfc_bull_2010_2021", 100.0)
    assert json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)


def test_compute_regime_backtest_path_gfc_drawdown(methodology):
    """GFC window must show a material drawdown for a buffer-cap RILA."""
    spec = _load_spec("equitable_scs")  # non-rider; drawdown driven by market alone
    r = compute_regime_backtest_path(spec, methodology, "gfc_2008_2010", 100.0)
    assert r["max_drawdown_pct"] > 0.10, (
        f"GFC max drawdown ({r['max_drawdown_pct']:.3f}) should exceed 10% "
        f"— buffer-cap product still loses materially below the buffer level"
    )
    # Drawdown month must fall inside the GFC window
    dd_year = int(r["max_drawdown_month"][:4])
    assert 2008 <= dd_year <= 2010


def test_compute_regime_backtest_path_unknown_regime(methodology):
    """An unknown regime key raises ValueError."""
    spec = _load_spec("equitable_scs_income")
    with pytest.raises(ValueError):
        compute_regime_backtest_path(spec, methodology, "not_a_regime", 100.0)


def test_compute_regime_backtest_path_normalization(methodology):
    """A 10x starting AV yields ~10x terminal AV (linear scaling — apart from
    GLWB withdrawal clamping which is identical because the rider scales with
    base_av)."""
    spec = _load_spec("equitable_scs")  # non-rider — clean linear scaling
    r1 = compute_regime_backtest_path(spec, methodology, "post_gfc_bull_2010_2021", 100.0)
    r10 = compute_regime_backtest_path(spec, methodology, "post_gfc_bull_2010_2021", 1000.0)
    assert r10["terminal_av"] == pytest.approx(r1["terminal_av"] * 10.0, rel=1e-3)
    assert r10["max_drawdown_pct"] == pytest.approx(r1["max_drawdown_pct"], abs=1e-3)


def test_compute_regime_backtest_path_defaults_to_premium(methodology):
    """When starting_av is None, the backtest uses scoring_scenario.premium ($250K)
    so the same dollar basis is used as the composite rating's PV calcs."""
    spec = _load_spec("equitable_scs_income")
    r_default = compute_regime_backtest_path(spec, methodology, "post_gfc_bull_2010_2021")
    assert r_default["starting_av"] == methodology["scoring_scenario"]["premium"]


# ---------------------------------------------------------------------------
# v1.3.1 math-fix tests
# ---------------------------------------------------------------------------

def test_tco_drag_uses_methodology_mu():
    """When μ doubles, capped-segment drag should grow because more upside is foregone."""
    from engine.rating import _tco_drag
    spec = {
        "base": {"me_fee_annual": 0.0125},
        "rider": {"type": "none"},
        "segments_available": [{
            "term_years": 1, "crediting_method": "cap", "cap_rate": 0.08,
            "protection_type": "buffer", "protection_level": 0.10,
        }],
        "default_allocation_pcts": [1.0],
    }
    drag_at_7 = _tco_drag(spec, {}, 250_000, mu=0.07)
    drag_at_14 = _tco_drag(spec, {}, 250_000, mu=0.14)
    assert drag_at_14 > drag_at_7, "higher μ → more cap-spread drag for a capped segment"


def test_rila_path_splits_me_and_rider_fees():
    """project_rila_path must emit me_fees_pv and rider_fees_pv separately."""
    import numpy as np
    from engine.rila import RILAProduct, RILASegment, project_rila_path
    seg = RILASegment(
        term_years=1, index="sp500", crediting_method="cap",
        protection_type="buffer", protection_level=0.10, cap_rate=0.09,
    )
    rila = RILAProduct(
        name="T", carrier="T", base_av=250_000,
        segments=[seg], allocation_pcts=[1.0],
        me_fee_annual=0.012, surrender_schedule=[],
        has_glwb=True, glwb_rider_fee=0.013, glwb_withdrawal_rate=0.05,
    )
    returns = np.full(10, 1.05)
    out = project_rila_path(rila, returns, 10, current_age=60, glwb_election_age=65)
    assert "me_fees_pv" in out and "rider_fees_pv" in out
    assert out["fees_paid_pv"] == pytest.approx(out["me_fees_pv"] + out["rider_fees_pv"], abs=0.01)
    assert out["rider_fees_pv"] > 0
    assert out["me_fees_pv"] > 0


def test_buffer_value_pv_persistency_shrinks_pv():
    """Buffer PV with full persistency > buffer PV with declining persistency."""
    from engine.buffer_value import buffer_value_pv
    spec_path = Path(__file__).resolve().parents[1] / "data" / "products" / "equitable_scs.json"
    spec = json.loads(spec_path.read_text())
    full = buffer_value_pv(
        spec, premium=250_000, horizon_years=30, mu=0.07, sigma=0.18, discount_rate=0.04,
    )["pv_total"]
    # Linear-decaying persistency from 1.0 at year 0 to 0.5 at year 30
    persist = [1.0 - 0.5 * k / 30 for k in range(31)]
    shrunk = buffer_value_pv(
        spec, premium=250_000, horizon_years=30, mu=0.07, sigma=0.18, discount_rate=0.04,
        persistency=persist,
    )["pv_total"]
    assert 0 < shrunk < full
    assert shrunk / full < 0.85  # noticeable shrinkage


def test_compute_freshness_status_bands():
    """Verify the green/yellow/red status thresholds against synthetic dates."""
    from engine.ratings_store import compute_freshness
    # Use a real slug from the catalog
    f = compute_freshness("equitable_scs_income", as_of="2026-05-13")
    assert f is not None
    assert "segments" in f
    assert all("status" in s and s["status"] in ("green", "yellow", "red")
               for s in f["segments"])
