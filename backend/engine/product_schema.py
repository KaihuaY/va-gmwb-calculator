"""
Pydantic schema for product spec JSON files in backend/data/products/.

Used by tools/rate_product.py to validate inputs before computing a rating.
"""

from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator


class DataSource(BaseModel):
    type: str
    url:  Optional[str] = None
    retrieved: Optional[str] = None
    note: Optional[str] = None


class SegmentSpec(BaseModel):
    term_years:         int = Field(..., ge=1, le=10)
    index:              str
    crediting_method:   Literal["cap", "participation", "spread", "trigger"]
    protection_type:    Literal["buffer", "floor"]
    protection_level:   float = Field(..., ge=0.0, le=1.0)
    cap_rate:           Optional[float] = Field(None, ge=0.0, le=2.0)
    participation_rate: Optional[float] = Field(None, ge=0.0, le=3.0)
    spread:             Optional[float] = Field(None, ge=0.0, le=0.20)
    trigger_rate:       Optional[float] = Field(None, ge=0.0, le=0.50)


class BaseSpec(BaseModel):
    base_av_default:        float = Field(250_000, ge=10_000)
    me_fee_annual:          float = Field(0.0125, ge=0.0, le=0.05)
    surrender_schedule:     list[float] = Field(default_factory=list)
    free_withdrawal_pct:    float = Field(0.10, ge=0.0, le=1.0)
    nursing_home_waiver:    bool = False
    terminal_illness_waiver: bool = False
    disability_waiver:      bool = False


class RiderSpec(BaseModel):
    type:                 Literal["glwb", "none"] = "none"
    rider_fee_annual:     float = 0.0
    rollup_rate:          float = 0.0
    withdrawal_rate_by_age: dict[str, float] = Field(default_factory=dict)
    step_up:              bool = False


class InsurerSpec(BaseModel):
    am_best:           str = "B+"
    sp:                Optional[str] = None
    moodys:            Optional[str] = None
    pe_owned:          bool = False
    level_3_pct_2024:  float = Field(0.10, ge=0.0, le=1.0)


class CapHistoryEntry(BaseModel):
    date: str
    cap:  float


class BehavioralData(BaseModel):
    initial_cap:               Optional[float] = None
    current_cap:               Optional[float] = None
    cap_history:               list[CapHistoryEntry] = Field(default_factory=list)
    illustration_actual_delta: float = 0.0
    naic_complaints_index:     float = 0.5
    regulatory_fines_5yr:      int   = 0


class ProductSpec(BaseModel):
    slug:                    str
    name:                    str
    carrier:                 str
    product_type:            Literal["rila"] = "rila"
    first_offered:           Optional[str] = None
    data_provenance:         Literal["synthetic_v0", "prospectus_v1"] = "synthetic_v0"
    data_sources:            list[DataSource] = Field(default_factory=list)
    base:                    BaseSpec
    segments_available:      list[SegmentSpec]
    default_allocation_pcts: list[float]
    rider:                   Optional[RiderSpec] = None
    insurer:                 InsurerSpec
    behavioral_data:         Optional[BehavioralData] = None
    has_gmdb:                bool = False
    gmdb_rider_fee:          float = 0.0

    @field_validator("default_allocation_pcts")
    @classmethod
    def alloc_sums_to_one(cls, v: list[float]) -> list[float]:
        if not v:
            raise ValueError("default_allocation_pcts cannot be empty")
        total = sum(v)
        if abs(total - 1.0) > 1e-6:
            raise ValueError(f"default_allocation_pcts must sum to 1.0, got {total}")
        return v

    @field_validator("slug")
    @classmethod
    def slug_format(cls, v: str) -> str:
        if not v.replace("_", "").replace("-", "").isalnum():
            raise ValueError(f"slug must be alphanumeric+underscore/dash only: {v}")
        return v.lower()
