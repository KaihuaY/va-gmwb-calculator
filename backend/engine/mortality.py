"""
Mortality table lookup, survival probability, and persistency calculations.

Tables supported:
  - 2012 IAM Basic (default) with Scale G2 improvement
  - Annuity 2000 Basic

All qx values are annual probabilities of death.
"""

import json
import math
from pathlib import Path

_DATA_DIR = Path(__file__).parent.parent / "data"

_TABLE_CACHE: dict = {}


def _load_table(filename: str) -> dict:
    if filename not in _TABLE_CACHE:
        with open(_DATA_DIR / filename) as f:
            _TABLE_CACHE[filename] = json.load(f)
    return _TABLE_CACHE[filename]


def _get_base_table(table_name: str) -> dict:
    """Return the loaded mortality table dict."""
    filemap = {
        "2012iam": "mortality_2012iam.json",
        "annuity2000": "mortality_annuity2000.json",
    }
    fname = filemap.get(table_name, "mortality_2012iam.json")
    return _load_table(fname)


def get_qx(
    age: int,
    gender: str,
    calendar_year: int,
    multiplier: float = 1.0,
    table_name: str = "2012iam",
) -> float:
    """
    Return the projected annual mortality rate qx for a given age and calendar year.

    Applies Scale G2 mortality improvement from the 2012 base year:
        q(x, year) = q(x, 2012) * (1 - improvement(x))^(year - 2012) * multiplier

    Args:
        age: Attained age (clamped to table range 40–120).
        gender: 'male' or 'female'.
        calendar_year: The calendar year for which to project qx.
        multiplier: Multiplicative adjustment (1.0 = no adjustment).
        table_name: Mortality table identifier ('2012iam' or 'annuity2000').

    Returns:
        Projected qx, capped at 1.0.
    """
    table = _get_base_table(table_name)
    age_key = str(min(max(int(age), 40), 120))
    gender_key = gender.lower()

    base_qx: float = table["base"][gender_key].get(age_key, 1.0)

    # Scale G2 improvement (only embedded in 2012 IAM table)
    improvement: float = 0.0
    if "improvement" in table:
        improvement = table["improvement"][gender_key].get(age_key, 0.0)

    years_from_base = max(0, calendar_year - 2012)
    projected_qx = base_qx * math.pow(1.0 - improvement, years_from_base) * multiplier
    return min(projected_qx, 1.0)


def compute_survival_probs(
    current_age: int,
    gender: str,
    base_calendar_year: int,
    max_age: int,
    multiplier: float = 1.0,
    table_name: str = "2012iam",
) -> list[float]:
    """
    Compute cumulative survival probabilities tPx from current_age to max_age.

    Returns a list of length (max_age - current_age + 1) where index t is the
    probability of surviving t years from current_age (index 0 = 1.0).
    """
    n = max_age - current_age + 1
    probs = [0.0] * n
    probs[0] = 1.0
    for t in range(1, n):
        age = current_age + t - 1
        year = base_calendar_year + t - 1
        qx = get_qx(age, gender, year, multiplier, table_name)
        probs[t] = probs[t - 1] * (1.0 - qx)
    return probs


def adjust_lapse_for_itm(
    base_lapse: float,
    bb: float,
    av: float,
    sensitivity: float,
    min_multiplier: float,
) -> float:
    """
    Compute a dynamic lapse rate for one period based on the ITM (in-the-money) ratio.

    ITM = benefit_base / account_value.
    Policyholders lapse less when the guarantee is in-the-money (ITM > 1) and
    more when it is out-of-the-money (ITM < 1).

    Formula:
        mult = max(min_multiplier, 1 - sensitivity × (ITM - 1))
        adjusted_lapse = base_lapse × mult

    Args:
        base_lapse: Base annual lapse rate.
        bb: Current benefit base.
        av: Current account value.
        sensitivity: Rate of lapse reduction per unit of ITM above 1.
        min_multiplier: Floor multiplier (e.g. 0.1 → lapse ≥ 10% of base rate).

    Returns:
        Adjusted annual lapse rate for this period.
    """
    itm = bb / max(av, 1.0)
    mult = max(min_multiplier, 1.0 - sensitivity * (itm - 1.0))
    return base_lapse * mult


def compute_persistency(survival_probs: list[float], lapse_rate: float) -> list[float]:
    """
    Compute persistency factors: probability a policy is still in force at time t.

    persistency[t] = survival_probs[t] * (1 - lapse_rate)^t

    Args:
        survival_probs: Output of compute_survival_probs.
        lapse_rate: Annual lapse/surrender rate.

    Returns:
        List of persistency factors, same length as survival_probs.
    """
    n = len(survival_probs)
    persist = [0.0] * n
    persist[0] = 1.0
    for t in range(1, n):
        persist[t] = survival_probs[t] * math.pow(1.0 - lapse_rate, t)
    return persist
