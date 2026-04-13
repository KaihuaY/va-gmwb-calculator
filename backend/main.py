"""
FastAPI application exposing the GMWB simulation engine as a REST API.

Endpoints:
  GET  /health            — liveness check
  POST /simulate          — run Monte Carlo simulation, return aggregated results
  POST /sensitivity       — run sensitivity analysis (tornado chart data)
  POST /record            — persist a simulation session (email + inputs + results)
"""

from typing import Optional, Any, List
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from engine.projection import SimulationParams, run_simulation
from engine.session_store import save_session

app = FastAPI(
    title="VA GMWB Calculator API",
    description="Actuarial present value calculator for Guaranteed Minimum Withdrawal Benefits",
    version="1.0.0",
)
# CORS is handled entirely by the Lambda Function URL config (AllowOrigins: ["*"]).
# Do NOT add FastAPI CORSMiddleware here — it would create duplicate
# Access-Control-Allow-Origin headers, which browsers reject.


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class WithdrawalRateBand(BaseModel):
    """One age-band entry for withdrawal_rate_bands."""
    min_age: int   = Field(..., ge=0, le=120, description="Applies when policyholder age ≥ this value")
    rate:    float = Field(..., ge=0.001, le=0.20, description="Annual withdrawal rate (decimal, e.g. 0.05 = 5%)")


class SimulateRequest(BaseModel):
    # Policyholder
    current_age: int = Field(65, ge=0, le=100)
    gender: str = Field("male", pattern="^(male|female)$")
    max_age: int = Field(100, ge=90, le=120)

    # Contract
    account_value: float = Field(500_000, ge=10_000, le=10_000_000)
    gmwb_enabled: bool = True
    benefit_base: float = Field(500_000, ge=10_000, le=10_000_000)
    election_age: int = Field(65, ge=0, le=100)
    withdrawal_rate: float = Field(0.05, ge=0.01, le=0.10)
    withdrawal_rate_bands: Optional[List[WithdrawalRateBand]] = Field(
        None,
        description="Age-banded withdrawal rates. If set, overrides withdrawal_rate per period. "
                    "Each band applies when policyholder age ≥ min_age (highest matching band wins). "
                    "Falls back to withdrawal_rate if no band covers the current age."
    )
    rider_fee: float = Field(0.01, ge=0.0, le=0.03)
    gmdb_enabled: bool = False
    gmdb_benefit_base: float = Field(500_000, ge=10_000, le=10_000_000)
    gmdb_rider_fee: float = Field(0.005, ge=0.0, le=0.03)
    gmdb_rollup_rate: float = Field(0.0, ge=0.0, le=0.08)
    gmdb_step_up: bool = False
    me_fee: float = Field(0.014, ge=0.0, le=0.03)
    rollup_rate: float = Field(0.0, ge=0.0, le=0.08)
    step_up: bool = False

    # Economic
    mu: float = Field(0.07, ge=-0.05, le=0.20)
    sigma: float = Field(0.18, ge=0.0, le=0.50)
    discount_rate: float = Field(0.04, ge=0.0, le=0.10)
    frequency: str = Field("annual", pattern="^(annual|monthly)$")
    fixed_account_pct: float = Field(0.0, ge=0.0, le=1.0)
    fixed_account_rate: float = Field(0.03, ge=0.0, le=0.10)

    # Mortality
    mortality_table: str = Field("2012iam", pattern="^(2012iam|annuity2000)$")
    mort_multiplier: float = Field(1.0, ge=0.5, le=2.0)

    # Lapse
    lapse_rate: float = Field(0.03, ge=0.0, le=0.20)
    dynamic_lapse: bool = False
    lapse_sensitivity: float = Field(0.5, ge=0.0, le=2.0)
    lapse_min_multiplier: float = Field(0.1, ge=0.0, le=1.0)

    # Policyholder Behavior
    benefit_utilization: float = Field(1.0, ge=0.5, le=1.0)

    # Simulation
    num_scenarios: int = Field(1000, ge=100, le=10_000)
    seed: Optional[int] = Field(42, ge=1, le=999_999)


class SendOtpRequest(BaseModel):
    """Request a 6-digit verification code sent to `email`."""
    email: str = Field(..., min_length=3, max_length=254)


class VerifyOtpRequest(BaseModel):
    """Submit the 6-digit code received by email."""
    email: str = Field(..., min_length=3, max_length=254)
    code:  str = Field(..., min_length=6, max_length=6, pattern=r"^\d{6}$")


class RecordRequest(BaseModel):
    """Persists one simulation session for research/analytics."""
    email: Optional[str] = None
    role:  Optional[str] = None
    mode:  str = Field("standard", pattern="^(standard|advanced)$")
    params:  dict[str, Any]         # full SimulateRequest fields
    results: dict[str, Any]         # full simulate() response
    extra:   Optional[dict[str, Any]] = None   # future fields: product_name, company, notes…


class SensitivityRequest(BaseModel):
    """Runs baseline + ±shift simulations for each selected parameter."""
    base: SimulateRequest
    shift_pct: float = Field(0.10, ge=0.01, le=0.50,
                              description="Relative shift applied to each parameter (default ±10%)")
    fields: Optional[list[str]] = Field(
        None,
        description="Which parameter fields to stress-test. None = run all."
    )


class OptimalElectionAgeRequest(BaseModel):
    """
    Sweeps GMWB election ages to find the one maximising expected PV(GMWB claims).

    The `election_age` field inside `base` is ignored — it is overridden for
    each point in the sweep.  The original value is echoed back in the response
    as `current_election_age` so the caller can compare it to the optimum.
    """
    base: SimulateRequest


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/simulate")
def simulate(req: SimulateRequest):
    """Run Monte Carlo simulation and return aggregated results."""
    params = SimulationParams(**req.model_dump())
    return run_simulation(params)


@app.post("/sensitivity")
def sensitivity(req: SensitivityRequest):
    """
    Compute sensitivity of PV(net cost) to each numeric parameter.

    For each selected parameter, runs two simulations (param × (1 ± shift_pct))
    and returns the mean Δ net cost.  Used to build the tornado chart.

    Parameters are grouped into three categories:
      - economic: market/discount assumptions (genuine uncertainty)
      - behavioral: policyholder behavior assumptions (genuine uncertainty)
      - contract: policy terms (useful for product design, not uncertainty)

    Returns a list sorted by absolute impact descending.
    """
    import copy

    # (field, label, category)
    # category: 'economic' | 'behavioral' | 'contract'
    SHIFTABLE = [
        ("mu",                  "Expected Return (μ)",  "economic"),
        ("sigma",               "Volatility (σ)",       "economic"),
        ("discount_rate",       "Discount Rate",        "economic"),
        ("lapse_rate",          "Lapse Rate",           "behavioral"),
        ("lapse_sensitivity",   "Lapse Sensitivity",    "behavioral"),
        ("benefit_utilization", "Benefit Utilization",  "behavioral"),
        ("mort_multiplier",     "Mortality Multiplier", "behavioral"),
        ("withdrawal_rate",     "Withdrawal Rate",      "contract"),
        ("rider_fee",           "GMWB Rider Fee",       "contract"),
        ("me_fee",              "M&E Fee",              "contract"),
        ("gmdb_rider_fee",      "GMDB Rider Fee",       "contract"),
        ("rollup_rate",         "GMWB Roll-up Rate",    "contract"),
        ("fixed_account_rate",  "Fixed SA Rate",        "contract"),
    ]

    # Filter to only the requested fields (None = run all)
    if req.fields is not None:
        requested = set(req.fields)
        SHIFTABLE = [(f, l, c) for f, l, c in SHIFTABLE if f in requested]

    base_params = SimulationParams(**req.base.model_dump())
    base_result = run_simulation(base_params)
    base_net = base_result["net_stats"]["mean"]

    # Field-level bounds for clamping shifted values — mirrors SimulateRequest Field constraints
    FIELD_BOUNDS: dict[str, tuple[float, float]] = {
        "mu":                  (-0.05, 0.20),
        "sigma":               (0.0,   0.50),
        "discount_rate":       (0.0,   0.10),
        "lapse_rate":          (0.0,   0.20),
        "lapse_sensitivity":   (0.0,   2.0),
        "benefit_utilization": (0.5,   1.0),
        "mort_multiplier":     (0.5,   2.0),
        "withdrawal_rate":     (0.01,  0.10),
        "rider_fee":           (0.0,   0.03),
        "me_fee":              (0.0,   0.03),
        "gmdb_rider_fee":      (0.0,   0.03),
        "rollup_rate":         (0.0,   0.08),
        "fixed_account_rate":  (0.0,   0.10),
    }

    results = []
    for field, label, category in SHIFTABLE:
        base_val = getattr(base_params, field)
        delta = 0.01 if base_val == 0 else abs(base_val) * req.shift_pct
        lo, hi = FIELD_BOUNDS.get(field, (-1e9, 1e9))

        p_up = copy.copy(base_params)
        setattr(p_up, field, min(hi, base_val + delta))
        net_up = run_simulation(p_up)["net_stats"]["mean"] - base_net

        p_dn = copy.copy(base_params)
        setattr(p_dn, field, max(lo, base_val - delta))
        net_dn = run_simulation(p_dn)["net_stats"]["mean"] - base_net

        results.append({
            "parameter": label,
            "field": field,
            "category": category,
            "base_value": base_val,
            "delta": delta,
            "impact_up": round(net_up, 2),
            "impact_down": round(net_dn, 2),
            "abs_impact": round(max(abs(net_up), abs(net_dn)), 2),
        })

    results.sort(key=lambda x: x["abs_impact"], reverse=True)
    return {"base_net_cost": round(base_net, 2), "sensitivities": results}


@app.post("/optimal_election_age")
def optimal_election_age(req: OptimalElectionAgeRequest):
    """
    Sweep election ages and return the one that maximises expected PV(GMWB claims).

    Sweeps from current_age to min(current_age + 25, max_age − 5, 85) inclusive.
    At each candidate age a reduced-scenario Monte Carlo is run (capped at 500)
    and the mean PV of GMWB claims is recorded.

    When withdrawal_rate_bands is supplied, the effective rate at each candidate
    election age is resolved from the bands (highest min_age ≤ election_age wins),
    so the PV curve naturally reflects the rate step-up at each age threshold.
    """
    base = req.base

    if not base.gmwb_enabled:
        raise HTTPException(
            status_code=400,
            detail="GMWB rider must be enabled to compute optimal election age",
        )

    sweep_start = base.current_age
    sweep_end   = min(base.current_age + 25, base.max_age - 5, 85)
    ages        = range(sweep_start, sweep_end + 1)

    # Cap scenarios for speed — relative comparison; precision gap vs full /simulate is acceptable.
    sweep_scenarios = min(base.num_scenarios, 500)

    # Pre-sort bands once for the annual_gaw lookups below
    sorted_bands = None
    if base.withdrawal_rate_bands:
        sorted_bands = sorted(base.withdrawal_rate_bands, key=lambda b: b.min_age)

    sweep = []
    for age in ages:
        params_dict = base.model_dump()
        params_dict["election_age"]  = age
        params_dict["num_scenarios"] = sweep_scenarios
        # Use annual frequency regardless of user selection — monthly would be
        # ~12× slower and the relative ranking across ages is stable annually.
        params_dict["frequency"]     = "annual"

        result = run_simulation(SimulationParams(**params_dict))

        # Lock-in rate at this candidate election age (mirrors projection.py semantics):
        # The band covering the election age is used for the full withdrawal lifetime.
        # Example: bands 5%@65, 7%@70 → election_age=67 locks in 5%; age=72 locks in 7%.
        if sorted_bands is not None:
            eff_rate = base.withdrawal_rate  # fallback if no band covers this age
            for band in sorted_bands:
                if age >= band.min_age:
                    eff_rate = band.rate
        else:
            eff_rate = base.withdrawal_rate

        # Deterministic estimate of guaranteed annual withdrawal at this election age.
        # BB is projected at rollup_rate for deferral_years; step-up is not modelled
        # (it's stochastic and path-dependent).
        deferral_years = age - base.current_age
        annual_gaw = (
            base.benefit_base
            * (1 + base.rollup_rate) ** deferral_years
            * eff_rate
        )

        sweep.append({
            "election_age": age,
            "pv_gmwb":      round(result["claim_stats"]["mean"], 2),
            "pv_fees":      round(result["fee_stats"]["mean"], 2),
            "annual_gaw":   round(annual_gaw, 2),
        })

    optimal = max(sweep, key=lambda x: x["pv_gmwb"])

    # Look up what the caller's original election_age yields in the sweep.
    current_row = next(
        (s for s in sweep if s["election_age"] == base.election_age),
        sweep[0],
    )

    return {
        "sweep":                sweep,
        "optimal_age":          optimal["election_age"],
        "optimal_pv_gmwb":      optimal["pv_gmwb"],
        "optimal_annual_gaw":   optimal["annual_gaw"],
        "current_election_age": base.election_age,
        "current_pv_gmwb":      current_row["pv_gmwb"],
    }


@app.post("/auth/send-otp")
def auth_send_otp(req: SendOtpRequest):
    """
    Generate and email a 6-digit OTP to the supplied address.

    Rate-limited to 3 requests per email per 10-minute window.
    In development (no SMTP_HOST / SES_REGION configured) the code is
    printed to the server console so the flow can be tested without a
    real email server.
    """
    import re
    from engine.otp_store import is_rate_limited, save_otp
    from engine.auth import generate_otp, send_otp_email

    email = req.email.strip().lower()
    if not re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]+$", email):
        raise HTTPException(status_code=400, detail="Invalid email address.")

    if is_rate_limited(email):
        raise HTTPException(
            status_code=429,
            detail="Too many requests. Please wait a few minutes before requesting another code.",
        )

    otp = generate_otp()
    save_otp(email, otp)
    send_otp_email(email, otp)

    return {"sent": True}


@app.post("/auth/verify-otp")
def auth_verify_otp(req: VerifyOtpRequest):
    """
    Verify the 6-digit OTP submitted by the user.

    Returns { verified: true, email } on success.
    Raises HTTP 400 with a human-readable detail on failure.
    """
    from engine.otp_store import verify_otp as _verify_otp

    email = req.email.strip().lower()
    success, error = _verify_otp(email, req.code)
    if not success:
        raise HTTPException(status_code=400, detail=error)

    return {"verified": True, "email": email}


@app.post("/record")
def record(req: RecordRequest):
    """
    Persist a simulation session for research / analytics.

    Called fire-and-forget by the frontend after each successful run.
    The `extra` field accepts any additional key-value pairs (product name,
    company, notes, etc.) without requiring a schema change:

        { "extra": { "product_name": "SecurePath Elite", "company": "ABC Life" } }
    """
    row_id = save_session(
        email=req.email,
        role=req.role,
        mode=req.mode,
        params=req.params,
        results=req.results,
        extra=req.extra,
    )
    return {"recorded": True, "id": row_id}
