"""Unit tests for the RILA engine."""

import math
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from engine.rila import (
    RILAProduct, RILASegment,
    apply_crediting, _annualize_segment, _credit_annualized,
    project_rila_path,
)


# ---------------------------------------------------------------------------
# apply_crediting — pure segment math
# ---------------------------------------------------------------------------

def test_cap_buffer_upside_below_cap():
    seg = RILASegment(1, "sp500", "cap", "buffer", 0.10, cap_rate=0.10)
    assert apply_crediting(seg, 0.05) == pytest.approx(0.05)


def test_cap_buffer_upside_above_cap_is_clamped():
    seg = RILASegment(1, "sp500", "cap", "buffer", 0.10, cap_rate=0.10)
    assert apply_crediting(seg, 0.25) == pytest.approx(0.10)


def test_buffer_absorbs_loss_within_buffer():
    seg = RILASegment(1, "sp500", "cap", "buffer", 0.10, cap_rate=0.10)
    assert apply_crediting(seg, -0.08) == pytest.approx(0.0)


def test_buffer_holder_takes_loss_beyond_buffer():
    seg = RILASegment(1, "sp500", "cap", "buffer", 0.10, cap_rate=0.10)
    # -25% raw, buffer absorbs first 10%, holder bears -15%
    assert apply_crediting(seg, -0.25) == pytest.approx(-0.15)


def test_floor_caps_loss():
    seg = RILASegment(1, "sp500", "cap", "floor", 0.10, cap_rate=0.10)
    # -40% raw, floor at -10%
    assert apply_crediting(seg, -0.40) == pytest.approx(-0.10)


def test_floor_above_floor_unaffected():
    seg = RILASegment(1, "sp500", "cap", "floor", 0.10, cap_rate=0.10)
    assert apply_crediting(seg, -0.05) == pytest.approx(-0.05)


def test_participation_rate_scales_upside():
    seg = RILASegment(6, "sp500", "participation", "buffer", 0.20, participation_rate=0.75)
    assert apply_crediting(seg, 0.40) == pytest.approx(0.30)


def test_spread_subtracts_from_upside():
    seg = RILASegment(1, "sp500", "spread", "buffer", 0.10, spread=0.02)
    assert apply_crediting(seg, 0.08) == pytest.approx(0.06)
    assert apply_crediting(seg, 0.01) == pytest.approx(0.0)  # spread > raw


def test_trigger_pays_flat_if_index_positive():
    seg = RILASegment(1, "sp500", "trigger", "buffer", 0.10, trigger_rate=0.06)
    assert apply_crediting(seg, 0.01) == pytest.approx(0.06)
    assert apply_crediting(seg, 0.20) == pytest.approx(0.06)
    # Negative raw → buffer logic, not trigger
    assert apply_crediting(seg, -0.05) == pytest.approx(0.0)


def test_unknown_method_raises():
    seg = RILASegment(1, "sp500", "cap", "buffer", 0.10, cap_rate=0.10)
    seg.crediting_method = "bogus"  # type: ignore
    with pytest.raises(ValueError, match="crediting"):
        apply_crediting(seg, 0.05)


# ---------------------------------------------------------------------------
# Annualization
# ---------------------------------------------------------------------------

def test_annualize_6yr_55pct_cap():
    seg = RILASegment(6, "sp500", "cap", "buffer", 0.20, cap_rate=0.55)
    ann = _annualize_segment(seg)
    # (1.55)^(1/6) - 1 ≈ 0.0760
    assert ann["cap"] == pytest.approx(0.55 ** (1/6) + ((1+0.55) ** (1/6) - 1) - 0.55**(1/6), rel=1e-3) or \
           ann["cap"] == pytest.approx((1.55) ** (1/6) - 1, abs=1e-4)


def test_annualize_buffer_smaller_than_raw():
    seg = RILASegment(6, "sp500", "cap", "buffer", 0.20, cap_rate=0.55)
    ann = _annualize_segment(seg)
    # annual buffer < 20% (since 20% is the 6-yr cumulative absorption)
    assert ann["protection"] < 0.20
    assert ann["protection"] == pytest.approx(1 - (1 - 0.20) ** (1/6), abs=1e-6)


# ---------------------------------------------------------------------------
# Full path projection — determinism + reasonable terminal AV
# ---------------------------------------------------------------------------

def _simple_product(me_fee=0.0125, base_av=100_000):
    return RILAProduct(
        name="Test", carrier="Test", base_av=base_av,
        segments=[
            RILASegment(1, "sp500", "cap", "buffer", 0.10, cap_rate=0.10),
            RILASegment(6, "sp500", "cap", "buffer", 0.20, cap_rate=0.55),
        ],
        allocation_pcts=[0.5, 0.5],
        me_fee_annual=me_fee,
        surrender_schedule=[0.05]*6,
    )


def test_path_is_deterministic_with_fixed_returns():
    """Same input returns → same output."""
    prod = _simple_product()
    returns = np.array([1.07] * 30)
    out_a = project_rila_path(prod, returns, 30)
    out_b = project_rila_path(prod, returns, 30)
    assert out_a["av_end"] == out_b["av_end"]
    np.testing.assert_array_equal(out_a["av_path"], out_b["av_path"])


def test_path_grows_under_positive_returns():
    """Constant 7% returns minus 1.25% fee should leave AV well above starting value over 30 yrs."""
    prod = _simple_product(me_fee=0.0125, base_av=100_000)
    returns = np.array([1.07] * 30)
    out = project_rila_path(prod, returns, 30)
    # Expect ~5.7% net per year compounded — but with cap drag, less
    # Lower bound: 2x principal after 30yr
    assert out["av_end"] > 200_000


def test_path_shrinks_under_negative_returns():
    prod = _simple_product(me_fee=0.02, base_av=100_000)
    returns = np.array([0.95] * 30)   # -5% per year raw
    out = project_rila_path(prod, returns, 30)
    # Buffer absorbs some loss but 30 years × fees + loss should leave < principal
    assert out["av_end"] < 100_000


def test_buffer_protects_against_one_off_crash():
    prod = _simple_product(me_fee=0.0, base_av=100_000)
    # One-year drop of 30%, rest flat
    returns = np.ones(30)
    returns[10] = 0.70  # -30% year
    out = project_rila_path(prod, returns, 30)
    # Without buffer, AV would drop ~30% on year 10. With buffer (annualized
    # to ~1.7% for 1-yr/10% buffer; 3.7%/yr for 6-yr/20% buffer),
    # average buffer ~2.7% absorbs only a tiny piece — still substantial loss
    # but less than uncapped.
    assert out["av_end"] < 100_000
    assert out["av_end"] > 50_000


def test_av_path_length_matches_projection_years():
    prod = _simple_product()
    out = project_rila_path(prod, np.ones(30) * 1.05, 30)
    assert out["av_path"].shape == (31,)
    assert out["av_path"][0] == pytest.approx(100_000)


def test_allocation_must_sum_to_one():
    bad = RILAProduct(
        name="Bad", carrier="Test", base_av=100_000,
        segments=[RILASegment(1, "sp500", "cap", "buffer", 0.10, cap_rate=0.10)],
        allocation_pcts=[0.5],  # doesn't sum to 1
        me_fee_annual=0.0125,
        surrender_schedule=[],
    )
    with pytest.raises(ValueError, match="allocation"):
        project_rila_path(bad, np.ones(10), 10)


def test_empty_segments_rejected():
    bad = RILAProduct(
        name="Bad", carrier="Test", base_av=100_000,
        segments=[],
        allocation_pcts=[],
        me_fee_annual=0.0125,
        surrender_schedule=[],
    )
    with pytest.raises(ValueError, match="segment"):
        project_rila_path(bad, np.ones(10), 10)
