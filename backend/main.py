"""
FastAPI application exposing the GMWB simulation engine as a REST API.

Endpoints:
  GET  /health            — liveness check
  POST /simulate          — run Monte Carlo simulation, return aggregated results
  POST /sensitivity       — run sensitivity analysis (tornado chart data)
"""

from typing import Optional
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from engine.projection import SimulationParams, run_simulation

app = FastAPI(
    title="VA GMWB Calculator API",
    description="Actuarial present value calculator for Guaranteed Minimum Withdrawal Benefits",
    version="1.0.0",
)

# CORS — update AllowedOrigins to your CloudFront domain in production
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # tighten to your domain after deployment
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class SimulateRequest(BaseModel):
    # Policyholder
    current_age: int = Field(65, ge=40, le=90)
    gender: str = Field("male", pattern="^(male|female)$")
    max_age: int = Field(100, ge=90, le=120)
    mortality_table: str = Field("2012iam", pattern="^(2012iam|annuity2000)$")
    mort_multiplier: float = Field(1.0, ge=0.5, le=2.0)

    # Contract
    account_value: float = Field(500_000, ge=10_000, le=10_000_000)
    benefit_base: float = Field(500_000, ge=10_000, le=10_000_000)
    withdrawal_rate: float = Field(0.05, ge=0.01, le=0.10)
    rider_fee: float = Field(0.01, ge=0.0, le=0.03)
    me_fee: float = Field(0.014, ge=0.0, le=0.03)
    rollup_rate: float = Field(0.0, ge=0.0, le=0.08)
    step_up: bool = False

    # Economic
    mu: float = Field(0.07, ge=-0.05, le=0.20)
    sigma: float = Field(0.18, ge=0.05, le=0.50)
    discount_rate: float = Field(0.04, ge=0.0, le=0.10)
    frequency: str = Field("annual", pattern="^(annual|monthly)$")

    # Behavioral
    lapse_rate: float = Field(0.03, ge=0.0, le=0.20)
    benefit_utilization: float = Field(1.0, ge=0.5, le=1.0)

    # Simulation
    num_scenarios: int = Field(1000, ge=100, le=10_000)
    seed: Optional[int] = Field(42, ge=1, le=999_999)


class SensitivityRequest(BaseModel):
    """Runs baseline + ±shift simulations for each selected parameter."""
    base: SimulateRequest
    shift_pct: float = Field(0.10, ge=0.01, le=0.50,
                              description="Relative shift applied to each parameter (default ±10%)")


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

    For each shiftable parameter, runs two simulations (param × (1 ± shift_pct))
    and returns the mean Δ net cost.  Used to build the tornado chart.

    Returns a list sorted by absolute impact descending.
    """
    import copy

    SHIFTABLE = [
        ("mu",                  "Expected Return (μ)"),
        ("sigma",               "Volatility (σ)"),
        ("discount_rate",       "Discount Rate"),
        ("withdrawal_rate",     "Withdrawal Rate"),
        ("rider_fee",           "Rider Fee"),
        ("me_fee",              "M&E Fee"),
        ("lapse_rate",          "Lapse Rate"),
        ("benefit_utilization", "Benefit Utilization"),
        ("mort_multiplier",     "Mortality Multiplier"),
        ("rollup_rate",         "Roll-up Rate"),
    ]

    base_params = SimulationParams(**req.base.model_dump())
    base_result = run_simulation(base_params)
    base_net = base_result["net_stats"]["mean"]

    results = []
    for field, label in SHIFTABLE:
        base_val = getattr(base_params, field)
        if base_val == 0:
            delta = 0.01
        else:
            delta = abs(base_val) * req.shift_pct

        # Up
        p_up = copy.copy(base_params)
        setattr(p_up, field, base_val + delta)
        net_up = run_simulation(p_up)["net_stats"]["mean"] - base_net

        # Down
        p_dn = copy.copy(base_params)
        new_val = max(0.0, base_val - delta)
        setattr(p_dn, field, new_val)
        net_dn = run_simulation(p_dn)["net_stats"]["mean"] - base_net

        results.append({
            "parameter": label,
            "field": field,
            "base_value": base_val,
            "delta": delta,
            "impact_up": round(net_up, 2),
            "impact_down": round(net_dn, 2),
            "abs_impact": round(max(abs(net_up), abs(net_dn)), 2),
        })

    results.sort(key=lambda x: x["abs_impact"], reverse=True)
    return {"base_net_cost": round(base_net, 2), "sensitivities": results}
