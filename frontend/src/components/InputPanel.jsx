import { useState, useRef } from 'react';
import { createPortal } from 'react-dom';

// ---------------------------------------------------------------------------
// Dark-themed primitive input controls (sidebar is bg-slate-900)
// ---------------------------------------------------------------------------

function SectionHeader({ title }) {
  return (
    <div className="sticky top-0 z-10 text-xs font-bold text-slate-500 uppercase tracking-widest pt-4 pb-1.5 border-b border-slate-700 mb-3 bg-slate-900">
      {title}
    </div>
  );
}

function SubHeader({ title }) {
  return (
    <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mt-4 mb-2 pt-2 border-t border-slate-700/50">
      {title}
    </div>
  );
}

function Tooltip({ text }) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const iconRef = useRef(null);

  const show = () => {
    if (!iconRef.current) return;
    const rect = iconRef.current.getBoundingClientRect();
    const tooltipWidth = 288; // w-72
    let left = rect.right + 10;
    // If right side would clip viewport, flip to left of icon
    if (left + tooltipWidth > window.innerWidth - 8) {
      left = Math.max(8, rect.left - tooltipWidth - 10);
    }
    // Clamp vertically so tooltip doesn't go below viewport
    const top = Math.min(rect.top, window.innerHeight - 160);
    setPos({ top, left });
    setVisible(true);
  };

  return (
    <span
      ref={iconRef}
      className="ml-1.5 cursor-help text-slate-600 hover:text-slate-400 text-base leading-none select-none"
      onMouseEnter={show}
      onMouseLeave={() => setVisible(false)}
    >
      ⓘ
      {visible && createPortal(
        <div
          style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999, width: 288 }}
          className="pointer-events-none rounded-lg bg-slate-800 border border-slate-700 px-3 py-2.5 text-sm text-slate-200 shadow-xl leading-relaxed"
        >
          {text}
        </div>,
        document.body
      )}
    </span>
  );
}

function InputRow({ label, tooltip, suffix, children }) {
  return (
    <div className="mb-3">
      <label className="flex items-center text-sm font-semibold text-slate-300 mb-1.5">
        {label}
        {tooltip && <Tooltip text={tooltip} />}
        {suffix && <span className="ml-1.5 font-normal text-slate-500 normal-case text-xs">({suffix})</span>}
      </label>
      {children}
    </div>
  );
}

const inputClass = "w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2.5 text-base text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/40";

function clamp(v, min, max) {
  if (min !== undefined && v < min) return min;
  if (max !== undefined && v > max) return max;
  return v;
}

function NumberInput({ value, onChange, min, max, step, commas = false, className: extraClass }) {
  const [localVal, setLocalVal] = useState(null); // null = display prop value

  if (commas) {
    const focused = localVal !== null;
    return (
      <input
        type="text"
        inputMode="numeric"
        value={focused ? localVal : (value || 0).toLocaleString('en-US')}
        onFocus={() => setLocalVal(String(value))}
        onBlur={() => {
          const parsed = parseFloat((localVal ?? '').replace(/,/g, ''));
          setLocalVal(null);
          if (!isNaN(parsed)) onChange(clamp(parsed, min, max));
        }}
        onChange={e => {
          setLocalVal(e.target.value);
          const parsed = parseFloat(e.target.value.replace(/,/g, ''));
          if (!isNaN(parsed)) onChange(parsed); // allow mid-type; clamp on blur
        }}
        className={extraClass ?? inputClass}
      />
    );
  }

  const editing = localVal !== null;
  return (
    <input
      type="number"
      value={editing ? localVal : value}
      min={min}
      max={max}
      step={step}
      onFocus={() => setLocalVal(String(value))}
      onChange={e => {
        setLocalVal(e.target.value);
        const parsed = parseFloat(e.target.value);
        if (!isNaN(parsed)) onChange(parsed); // allow mid-type; clamp on blur
      }}
      onBlur={() => {
        const parsed = parseFloat(localVal ?? '');
        setLocalVal(null);
        if (!isNaN(parsed)) onChange(clamp(parsed, min, max));
      }}
      className={extraClass ?? inputClass}
    />
  );
}

function SelectInput({ value, onChange, options }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className={inputClass + " cursor-pointer"}
    >
      {options.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

function PercentInput({ value, onChange, min, max, step, decimals = 2 }) {
  const [localVal, setLocalVal] = useState(null); // null = display prop value
  // value is stored as decimal (0.05 = 5%); min/max are in display % (5, 10)
  const toDisplay = v => parseFloat((v * 100).toFixed(decimals));
  const fromDisplay = v => clamp(v, min, max) / 100;

  const editing = localVal !== null;
  return (
    <div className="relative">
      <input
        type="number"
        value={editing ? localVal : toDisplay(value)}
        min={min}
        max={max}
        step={step}
        onFocus={() => setLocalVal(String(toDisplay(value)))}
        onChange={e => {
          setLocalVal(e.target.value);
          const parsed = parseFloat(e.target.value);
          if (!isNaN(parsed)) onChange(parsed / 100); // allow mid-type; clamp on blur
        }}
        onBlur={() => {
          const parsed = parseFloat(localVal ?? '');
          setLocalVal(null);
          if (!isNaN(parsed)) onChange(fromDisplay(parsed));
        }}
        className={inputClass + " pr-9"}
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-500">%</span>
    </div>
  );
}

function CheckboxInput({ checked, onChange, label }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer group">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="h-5 w-5 rounded border-2 border-slate-600 bg-slate-800 text-blue-500 focus:ring-2 focus:ring-blue-500/40 focus:ring-offset-0 cursor-pointer flex-shrink-0"
      />
      <span className="text-sm text-slate-300 group-hover:text-white transition-colors">{label}</span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Health level selector (Standard mode — maps to mort_multiplier)
// ---------------------------------------------------------------------------

const HEALTH_LEVELS = [
  { id: 'excellent', label: 'Excellent', mult: 0.75 },
  { id: 'good',      label: 'Good',      mult: 1.00 },
  { id: 'fair',      label: 'Fair',      mult: 1.25 },
  { id: 'poor',      label: 'Poor',      mult: 1.60 },
];

function HealthSelector({ value, onChange }) {
  // Identify which preset is active (tolerance for floating-point)
  const active = HEALTH_LEVELS.find(l => Math.abs(l.mult - value) < 0.01);

  return (
    <div>
      <div className="flex gap-1">
        {HEALTH_LEVELS.map(l => (
          <button
            key={l.id}
            type="button"
            onClick={() => onChange(l.mult)}
            className={`flex-1 py-2 text-xs font-semibold rounded-md border transition-colors ${
              active?.id === l.id
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-slate-700 text-slate-300 border-slate-600 hover:border-blue-400 hover:text-white'
            }`}
          >
            {l.label}
          </button>
        ))}
      </div>
      <div className="mt-1 text-xs text-slate-500">
        {active
          ? `${active.mult}× mortality rate — ${
              active.id === 'excellent' ? 'expect to live significantly longer than average' :
              active.id === 'good'      ? 'matches the standard actuarial table' :
              active.id === 'fair'      ? 'some health conditions may shorten lifespan' :
                                          'significant health issues — elevated mortality'
            }`
          : `Custom: ${value.toFixed(2)}× (set in Advanced › Actuarial)`}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Age-banded withdrawal rates editor (Advanced mode)
// ---------------------------------------------------------------------------

const DEFAULT_BANDS = [
  { min_age: 0,  rate: 0.04 },
  { min_age: 60, rate: 0.05 },
  { min_age: 65, rate: 0.06 },
];

function BandedRatesEditor({ bands, onChangeBands, currentAge = 0 }) {
  const sorted = [...bands].sort((a, b) => a.min_age - b.min_age);

  const updateBand = (idx, field, value) => {
    const updated = sorted.map((b, i) => i === idx ? { ...b, [field]: value } : b);
    onChangeBands(updated.sort((a, b) => a.min_age - b.min_age));
  };

  const removeBand = (idx) => {
    if (sorted.length <= 1) return;
    onChangeBands(sorted.filter((_, i) => i !== idx));
  };

  const addBand = () => {
    const lastAge = sorted.length > 0 ? sorted[sorted.length - 1].min_age : currentAge;
    const lastRate = sorted.length > 0 ? sorted[sorted.length - 1].rate : 0.05;
    onChangeBands([...sorted, { min_age: Math.min(lastAge + 5, 100), rate: lastRate }]);
  };

  return (
    <div>
      {/* Header row */}
      <div className="flex items-center gap-2 mb-1.5 px-0.5">
        <span className="text-xs text-slate-500 w-16">From age</span>
        <span className="text-xs text-slate-500 flex-1">Annual rate</span>
      </div>
      <div className="space-y-1.5">
        {sorted.map((band, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <div className="w-16">
              <NumberInput
                value={band.min_age}
                onChange={v => updateBand(idx, 'min_age', Math.round(v))}
                min={currentAge}
                max={100}
                step={1}
                className={inputClass + " text-center px-2"}
              />
            </div>
            <span className="text-xs text-slate-500">+</span>
            <div className="flex-1">
              <PercentInput value={band.rate} onChange={v => updateBand(idx, 'rate', v)} min={0.5} max={20} step={0.5} />
            </div>
            <button
              type="button"
              onClick={() => removeBand(idx)}
              disabled={sorted.length <= 1}
              className="flex-shrink-0 w-6 text-center text-slate-500 hover:text-red-400 disabled:opacity-25 transition-colors text-base leading-none"
              title="Remove band"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={addBand}
        className="mt-2 text-xs text-blue-400 hover:text-blue-300 transition-colors"
      >
        + Add band
      </button>
      <div className="mt-1.5 text-xs text-slate-500 leading-relaxed">
        Each band applies when the policyholder's age ≥ "From age". The highest threshold reached is used each year.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared rider-selection section (used in both Standard and Advanced modes)
// ---------------------------------------------------------------------------

function RiderBadge({ label, active }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${active ? 'bg-blue-600/30 text-blue-300 border border-blue-500/40' : 'bg-slate-700/50 text-slate-500 border border-slate-600/30'}`}>
      {label}
    </span>
  );
}

function RiderSelection({ p, setParam, standard = false }) {
  return (
    <>
      <SectionHeader title={standard ? 'Which Riders Do You Have?' : 'Riders'} />
      <div className="space-y-3 mb-1">
        <label className="flex items-start gap-3 cursor-pointer group p-2.5 rounded-lg border border-slate-700 bg-slate-800/60 hover:border-blue-500/50 transition-colors">
          <input
            type="checkbox"
            checked={p.gmwb_enabled}
            onChange={e => setParam('gmwb_enabled', e.target.checked)}
            className="h-5 w-5 mt-0.5 rounded border-2 border-slate-600 bg-slate-800 text-blue-500 focus:ring-2 focus:ring-blue-500/40 focus:ring-offset-0 cursor-pointer flex-shrink-0"
          />
          <div>
            <div className="text-sm font-semibold text-slate-200">
              {standard ? 'Lifetime Withdrawal Benefit' : 'GMWB'}
              <span className="ml-1.5"><RiderBadge label="GMWB" active={p.gmwb_enabled} /></span>
            </div>
            <div className="text-xs text-slate-500 mt-0.5 leading-relaxed">
              {standard
                ? 'Guarantees a minimum annual withdrawal for life, regardless of how markets perform.'
                : 'Guaranteed Minimum Withdrawal Benefit — guaranteed annual withdrawal for life.'}
            </div>
          </div>
        </label>
        <label className="flex items-start gap-3 cursor-pointer group p-2.5 rounded-lg border border-slate-700 bg-slate-800/60 hover:border-blue-500/50 transition-colors">
          <input
            type="checkbox"
            checked={p.gmdb_enabled}
            onChange={e => setParam('gmdb_enabled', e.target.checked)}
            className="h-5 w-5 mt-0.5 rounded border-2 border-slate-600 bg-slate-800 text-blue-500 focus:ring-2 focus:ring-blue-500/40 focus:ring-offset-0 cursor-pointer flex-shrink-0"
          />
          <div>
            <div className="text-sm font-semibold text-slate-200">
              {standard ? 'Death Benefit Guarantee' : 'GMDB'}
              <span className="ml-1.5"><RiderBadge label="GMDB" active={p.gmdb_enabled} /></span>
            </div>
            <div className="text-xs text-slate-500 mt-0.5 leading-relaxed">
              {standard
                ? 'Ensures your beneficiaries receive at least your protected amount, even if markets have fallen.'
                : 'Guaranteed Minimum Death Benefit — beneficiaries receive max(BB, AV) at death.'}
            </div>
          </div>
        </label>
      </div>
      {!p.gmwb_enabled && !p.gmdb_enabled && (
        <div className="mt-2 mb-3 rounded-lg bg-amber-900/30 border border-amber-700/50 px-3 py-2 text-xs text-amber-300">
          Select at least one rider to compute guarantee values.
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// STANDARD MODE — policyholder-friendly labels
// ---------------------------------------------------------------------------

function MyContractTab({ p, setParam }) {
  return (
    <>
      <SectionHeader title="About You" />
      <InputRow label="Your Age" tooltip="Your current age. This determines how many years remain in your projection and which mortality rates apply.">
        <NumberInput value={p.current_age} onChange={v => setParam('current_age', v)} min={0} max={100} step={1} />
      </InputRow>
      <InputRow label="Gender" tooltip="Used to look up how long you're expected to live, which affects how many years your guarantee may need to pay out.">
        <SelectInput value={p.gender} onChange={v => setParam('gender', v)}
          options={[{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }]} />
      </InputRow>
      <InputRow label="Health Status" tooltip="Self-assessed health level. Better health means you're likely to live longer — which makes a lifetime withdrawal guarantee more valuable (more years of income). Poor health shortens projected lifespan, making a death benefit more relevant. Adjusts the mortality table multiplier used in the simulation.">
        <HealthSelector value={p.mort_multiplier} onChange={v => setParam('mort_multiplier', v)} />
      </InputRow>

      <RiderSelection p={p} setParam={setParam} standard />

      <SectionHeader title="Contract" />
      <InputRow label="Account Value" suffix="$" tooltip="The current market value of your annuity — what your money is worth today in the investment subaccounts.">
        <NumberInput value={p.account_value} onChange={v => setParam('account_value', v)} min={10000} max={10000000} step={10000} commas />
      </InputRow>
      <InputRow label="Annual Contract Fee" suffix="% /yr" tooltip="The base annual fee charged by the insurance company for managing your annuity contract (M&E charge).">
        <PercentInput value={p.me_fee} onChange={v => setParam('me_fee', v)} min={0} max={3} step={0.1} />
      </InputRow>

      {p.gmwb_enabled && (
        <>
          <SectionHeader title="Withdrawal Rider (GMWB)" />
          <InputRow label="Withdrawal Guarantee Base" suffix="$" tooltip="The protected amount your annual withdrawals are calculated from. May be higher than your account value if your contract has grown via a roll-up or market step-up.">
            <NumberInput value={p.benefit_base} onChange={v => setParam('benefit_base', v)} min={10000} max={10000000} step={10000} commas />
          </InputRow>
          <InputRow label="Annual Withdrawal %" tooltip="The percentage of your guarantee base you can withdraw each year, for life. Typical: 4% before age 60, 5% at 60–64, 6% at 65+.">
            <PercentInput value={p.withdrawal_rate} onChange={v => setParam('withdrawal_rate', v)} min={1} max={10} step={0.5} />
          </InputRow>
          <InputRow label="Withdrawal Rider Fee" suffix="% /yr" tooltip="Annual fee for the withdrawal guarantee, deducted from your account. Charged on the guarantee base. Typical: 0.75–1.50%.">
            <PercentInput value={p.rider_fee} onChange={v => setParam('rider_fee', v)} min={0} max={3} step={0.25} />
          </InputRow>
          <InputRow label="Annual Guaranteed Growth" suffix="% /yr" tooltip="If your contract has a roll-up feature, your guarantee base grows at this rate each year before you start withdrawals. Set to 0 if not applicable.">
            <PercentInput value={p.rollup_rate} onChange={v => setParam('rollup_rate', v)} min={0} max={8} step={0.5} />
          </InputRow>
          <InputRow label="Annual Step-Up" tooltip="If on, your guarantee base automatically resets to your account value at each policy anniversary when markets have risen — permanently locking in the higher amount.">
            <CheckboxInput checked={p.step_up} onChange={v => setParam('step_up', v)}
              label={p.step_up ? 'On — guarantee base locks in market highs annually' : 'Off'} />
          </InputRow>
          <SubHeader title="Your Strategy" />
          <InputRow label="Income Start Age" tooltip="The age at which you plan to start taking guaranteed withdrawals. A later start can increase your annual payment if your contract has a roll-up rate. Switch to Advanced mode to run the optimizer.">
            <NumberInput value={p.election_age} onChange={v => setParam('election_age', v)} min={p.current_age} max={100} step={1} />
          </InputRow>
        </>
      )}

      {p.gmdb_enabled && (
        <>
          <SectionHeader title="Death Benefit Rider (GMDB)" />
          <InputRow label="Death Benefit Base" suffix="$" tooltip="The minimum amount your beneficiaries receive. Often equals your account value at contract issue. May differ from your withdrawal guarantee base.">
            <NumberInput value={p.gmdb_benefit_base} onChange={v => setParam('gmdb_benefit_base', v)} min={10000} max={10000000} step={10000} commas />
          </InputRow>
          <InputRow label="Death Benefit Rider Fee" suffix="% of AV/yr" tooltip="Annual fee for the death benefit guarantee, deducted from your account. Charged on your account value (AV). Typical: 0.25–0.75%.">
            <PercentInput value={p.gmdb_rider_fee} onChange={v => setParam('gmdb_rider_fee', v)} min={0} max={3} step={0.25} />
          </InputRow>
          <InputRow label="Death Benefit Annual Growth" suffix="% /yr" tooltip="If your contract grows the death benefit base each year, enter that rate here. This increases the minimum your beneficiaries receive over time. Set to 0 if not applicable.">
            <PercentInput value={p.gmdb_rollup_rate} onChange={v => setParam('gmdb_rollup_rate', v)} min={0} max={8} step={0.5} />
          </InputRow>
          <InputRow label="Annual Step-Up (DB)" tooltip="If on, your death benefit base also resets to your account value at each policy anniversary when markets have risen — in addition to any growth rate.">
            <CheckboxInput checked={p.gmdb_step_up} onChange={v => setParam('gmdb_step_up', v)}
              label={p.gmdb_step_up ? 'On — death benefit base locks in market highs annually' : 'Off'} />
          </InputRow>
        </>
      )}
    </>
  );
}

function MarketTab({ p, setParam }) {
  return (
    <>
      <SectionHeader title="Market Assumptions" />
      <InputRow label="Expected Annual Return" tooltip="The average annual return you expect from your investment subaccounts, before fees. Typical long-run equity assumption: 6–8%.">
        <PercentInput value={p.mu} onChange={v => setParam('mu', v)} min={-5} max={20} step={0.5} />
      </InputRow>
      <InputRow label="Market Volatility" tooltip="How much your investments might swing up or down from year to year. Higher volatility makes the guarantee more valuable as a safety net. Typical: 15–20% for a balanced portfolio.">
        <PercentInput value={p.sigma} onChange={v => setParam('sigma', v)} min={0} max={50} step={1} decimals={1} />
      </InputRow>
    </>
  );
}

// ---------------------------------------------------------------------------
// ADVANCED MODE — technical labels, all parameters
// ---------------------------------------------------------------------------

function ProfileTab({ p, setParam }) {
  return (
    <>
      <SectionHeader title="About the Insured" />
      <InputRow label="Current Age" tooltip="Age of the annuitant at the valuation date.">
        <NumberInput value={p.current_age} onChange={v => setParam('current_age', v)} min={0} max={100} step={1} />
      </InputRow>
      <InputRow label="Gender" tooltip="Determines which mortality rates are used from the selected table.">
        <SelectInput value={p.gender} onChange={v => setParam('gender', v)}
          options={[{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }]} />
      </InputRow>
      <InputRow label="Max Projection Age" tooltip="End of projection horizon (omega). Policyholder is assumed dead by this age.">
        <NumberInput value={p.max_age} onChange={v => setParam('max_age', v)} min={90} max={120} step={1} />
      </InputRow>

      <SectionHeader title="Contract Basics" />
      <InputRow label="Account Value (AV)" suffix="$" tooltip="Current market value of the variable annuity subaccounts. Note: the Benefit Base (BB) can exceed this if the contract has earned guaranteed growth via roll-up or step-up features.">
        <NumberInput value={p.account_value} onChange={v => setParam('account_value', v)} min={10000} max={10000000} step={10000} commas />
      </InputRow>
      <InputRow label="M&E Fee (Mortality & Expense)" suffix="% of AV/yr" tooltip="Mortality & Expense risk charge plus administration fee, deducted annually from account value. Covers the insurer's cost of providing death benefit guarantees and policy administration. Typical: 1.25–1.50% of AV per year.">
        <PercentInput value={p.me_fee} onChange={v => setParam('me_fee', v)} min={0} max={3} step={0.1} />
      </InputRow>
    </>
  );
}

function RidersTab({ p, setParam, onOptimalAge, optimalAgeRunning, savedBands, setSavedBands }) {
  const switchToSimple = () => {
    if (p.withdrawal_rate_bands !== null) setSavedBands(p.withdrawal_rate_bands);
    setParam('withdrawal_rate_bands', null);
  };

  const switchToBanded = () => {
    setParam('withdrawal_rate_bands', savedBands);
  };

  return (
    <>
      <RiderSelection p={p} setParam={setParam} />

      {p.gmwb_enabled && (
        <>
          <SectionHeader title="GMWB Rider" />
          <InputRow label="GMWB Benefit Base (BB)" suffix="$" tooltip="Notional amount used to calculate GAW = BB × withdrawal_rate. May differ from AV due to roll-ups.">
            <NumberInput value={p.benefit_base} onChange={v => setParam('benefit_base', v)} min={10000} max={10000000} step={10000} commas />
          </InputRow>
          <InputRow label="GMWB Rider Fee" suffix="% of BB/yr" tooltip="Annual GMWB rider charge deducted from AV. Charged on GMWB Benefit Base. Typical: 0.75–1.50%.">
            <PercentInput value={p.rider_fee} onChange={v => setParam('rider_fee', v)} min={0} max={3} step={0.25} />
          </InputRow>
          <InputRow label="Annual Guaranteed Growth" suffix="% /yr" tooltip="Annual BB growth during accumulation phase only (stops at election age).">
            <PercentInput value={p.rollup_rate} onChange={v => setParam('rollup_rate', v)} min={0} max={8} step={0.5} />
          </InputRow>
          <InputRow label="Annual Step-Up" tooltip="BB = max(BB, AV) at each anniversary. Locks in market gains permanently.">
            <CheckboxInput checked={p.step_up} onChange={v => setParam('step_up', v)}
              label={p.step_up ? 'On — BB ratchets to AV at anniversary' : 'Off'} />
          </InputRow>
          {/* Withdrawal rate — simple or age-banded — grouped with Election Strategy */}
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1.5">
              <label className="flex items-center text-sm font-semibold text-slate-300">
                Withdrawal Rate
                <Tooltip text="Annual guaranteed withdrawal as % of benefit base. Real VA contracts use age-banded rates (e.g., 5% if you start before 70, 7% if you start at 70 or later). The rate in effect when you elect to start withdrawals is locked in for life — it does not float up to a higher band as you age." />
              </label>
              <div className="flex items-center rounded-full border border-slate-700 bg-slate-800 p-0.5 text-xs font-semibold">
                <button
                  type="button"
                  onClick={switchToSimple}
                  className={`px-2.5 py-0.5 rounded-full transition-colors ${
                    p.withdrawal_rate_bands === null
                      ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Simple
                </button>
                <button
                  type="button"
                  onClick={switchToBanded}
                  className={`px-2.5 py-0.5 rounded-full transition-colors ${
                    p.withdrawal_rate_bands !== null
                      ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Banded
                </button>
              </div>
            </div>
            {p.withdrawal_rate_bands === null ? (
              <PercentInput value={p.withdrawal_rate} onChange={v => setParam('withdrawal_rate', v)} min={1} max={20} step={0.5} />
            ) : (
              <BandedRatesEditor
                bands={p.withdrawal_rate_bands}
                onChangeBands={bands => setParam('withdrawal_rate_bands', bands)}
                currentAge={p.current_age}
              />
            )}
          </div>
          <SubHeader title="Election Strategy" />
          <InputRow label="Election Age" tooltip="Age at which withdrawals begin. Before this age the Benefit Base grows at the roll-up rate (accumulation phase). When withdrawals start, the withdrawal rate is locked in at the band covering this age and never changes — electing at age 67 with a 5%@65/7%@70 schedule locks in 5% for life, even after you turn 70.">
            <NumberInput value={p.election_age} onChange={v => setParam('election_age', v)} min={p.current_age} max={100} step={1} />
            {onOptimalAge && (
              <button onClick={onOptimalAge} disabled={optimalAgeRunning}
                className="mt-1 text-xs text-blue-400 hover:text-blue-300 disabled:opacity-50 transition-colors">
                {optimalAgeRunning ? 'Analyzing…' : '→ Find optimal start age'}
              </button>
            )}
            {onOptimalAge && p.withdrawal_rate_bands !== null && (
              <div className="mt-0.5 text-xs text-slate-500">Uses age-banded rates in optimization</div>
            )}
          </InputRow>
        </>
      )}

      {p.gmdb_enabled && (
        <>
          <SectionHeader title="GMDB Rider" />
          <InputRow label="GMDB Benefit Base" suffix="$" tooltip="Notional used for death benefit shortfall: max(0, GMDB_BB − AV). Often equals AV at issue. Tracked separately from GMWB BB.">
            <NumberInput value={p.gmdb_benefit_base} onChange={v => setParam('gmdb_benefit_base', v)} min={10000} max={10000000} step={10000} commas />
          </InputRow>
          <InputRow label="GMDB Rider Fee" suffix="% of AV/yr" tooltip="Annual GMDB rider charge deducted from AV. Charged on account value (AV), not the benefit base — industry norm. Typical: 0.25–0.75%.">
            <PercentInput value={p.gmdb_rider_fee} onChange={v => setParam('gmdb_rider_fee', v)} min={0} max={3} step={0.25} />
          </InputRow>
          <InputRow label="Death Benefit Annual Growth" suffix="% /yr" tooltip="Annual GMDB BB growth (applies every year, unlike GMWB roll-up which stops at election age).">
            <PercentInput value={p.gmdb_rollup_rate} onChange={v => setParam('gmdb_rollup_rate', v)} min={0} max={8} step={0.5} />
          </InputRow>
          <InputRow label="GMDB Annual Step-Up" tooltip="GMDB_BB = max(GMDB_BB, AV) at each anniversary. Tracked independently of GMWB step-up.">
            <CheckboxInput checked={p.gmdb_step_up} onChange={v => setParam('gmdb_step_up', v)}
              label={p.gmdb_step_up ? 'On — GMDB BB ratchets to AV at anniversary' : 'Off'} />
          </InputRow>
        </>
      )}
    </>
  );
}

function AdvancedMarketTab({ p, setParam }) {
  return (
    <>
      <SectionHeader title="Variable Subaccounts" />
      <InputRow label="Expected Return (μ)" suffix="annual" tooltip="Gross expected annual return before fees. Real-world GBM drift parameter.">
        <PercentInput value={p.mu} onChange={v => setParam('mu', v)} min={-5} max={20} step={0.5} />
      </InputRow>
      <InputRow label="Volatility (σ)" suffix="annual" tooltip="Annual standard deviation of subaccount returns. Higher volatility increases claim exposure.">
        <PercentInput value={p.sigma} onChange={v => setParam('sigma', v)} min={0} max={50} step={1} decimals={1} />
      </InputRow>
      <InputRow label="Frequency" tooltip="Projection time step. Monthly is more accurate but ~12× slower.">
        <SelectInput value={p.frequency} onChange={v => setParam('frequency', v)}
          options={[{ value: 'annual', label: 'Annual' }, { value: 'monthly', label: 'Monthly' }]} />
      </InputRow>

      <SectionHeader title="Fixed / Guaranteed Account" />
      <InputRow label="Fixed Account Allocation" suffix="% of AV" tooltip="Percentage of account value allocated to the fixed/guaranteed account. The remaining portion earns GBM (variable) returns with the expected return (μ) and volatility (σ) assumptions. 0% = fully variable subaccounts.">
        <PercentInput value={p.fixed_account_pct} onChange={v => setParam('fixed_account_pct', v)} min={0} max={100} step={5} decimals={0} />
      </InputRow>
      {p.fixed_account_pct > 0 && (
        <InputRow label="Fixed Account Rate" suffix="% /yr" tooltip="Annual guaranteed crediting rate on the fixed account portion. Set by the insurer as a declared rate, typically linked to short-term interest rates. Only applies to the fixed account allocation percentage.">
          <PercentInput value={p.fixed_account_rate} onChange={v => setParam('fixed_account_rate', v)} min={0} max={10} step={0.25} />
        </InputRow>
      )}
    </>
  );
}

function ActuarialTab({ p, setParam, onSyncToStandard }) {
  // Detect if any param differs from the standard-mode locked values
  const isAtStdValues = p.lapse_rate === 0 && !p.dynamic_lapse && p.benefit_utilization === 1.0;

  return (
    <>
      <SectionHeader title="Mortality" />
      <InputRow label="Mortality Table" tooltip="Determines how long policyholders are expected to live, which directly affects how many years the guarantee may need to pay out. 2012 IAM Basic (recommended) projects improving longevity using Scale G2 improvement factors. Annuity 2000 is an older static table with no improvement.">
        <SelectInput value={p.mortality_table} onChange={v => setParam('mortality_table', v)}
          options={[{ value: '2012iam', label: '2012 IAM Basic' }, { value: 'annuity2000', label: 'Annuity 2000' }]} />
      </InputRow>
      <InputRow label="Mortality Multiplier" tooltip="Scales all mortality rates up or down from the base table. 1.0 = table default. Values below 1.0 model lighter mortality (policyholders live longer than average — common for annuitants due to self-selection). Values above 1.0 model heavier mortality.">
        <NumberInput value={p.mort_multiplier} onChange={v => setParam('mort_multiplier', v)} min={0.5} max={2.0} step={0.05} />
      </InputRow>

      <SectionHeader title="Surrender Rates" />
      {onSyncToStandard && (
        <div className="mb-3 flex items-center justify-between rounded-md bg-slate-800/60 border border-slate-700 px-3 py-2">
          <span className="text-xs text-slate-400">Match standard mode (0% lapse, 100% utilization)</span>
          <button
            type="button"
            onClick={onSyncToStandard}
            disabled={isAtStdValues}
            className="ml-3 flex-shrink-0 text-xs font-semibold text-blue-400 hover:text-blue-300 disabled:text-slate-600 disabled:cursor-not-allowed transition-colors"
          >
            {isAtStdValues ? 'Already matched' : 'Apply'}
          </button>
        </div>
      )}
      <InputRow label="Base Surrender Rate" suffix="annual" tooltip="Annual probability a policyholder surrenders (lapses) the contract.">
        <PercentInput value={p.lapse_rate} onChange={v => setParam('lapse_rate', v)} min={0} max={20} step={0.5} />
      </InputRow>
      <InputRow label="Dynamic Surrender" tooltip="When on, surrender rates decrease automatically as the guarantee becomes more valuable (in-the-money). Policyholders with a highly profitable guarantee are less likely to walk away. This models rational policyholder behavior and typically increases projected rider costs.">
        <SelectInput
          value={p.dynamic_lapse ? 'on' : 'off'}
          onChange={v => setParam('dynamic_lapse', v === 'on')}
          options={[{ value: 'off', label: 'Off (static)' }, { value: 'on', label: 'On (ITM-adjusted)' }]}
        />
      </InputRow>
      {p.dynamic_lapse && <>
        <InputRow label="Guarantee Sensitivity" tooltip="Controls how quickly surrender rates fall as the guarantee becomes more valuable. A value of 0.5 means surrenders are halved when the Benefit Base is twice the Account Value (i.e., the guarantee is deeply in-the-money and policyholders are unlikely to walk away from it). Higher values = stronger behavioral response.">
          <NumberInput value={p.lapse_sensitivity} onChange={v => setParam('lapse_sensitivity', v)} min={0} max={2.0} step={0.1} />
        </InputRow>
        <InputRow label="Minimum Surrender Rate" tooltip="Even when the guarantee is highly valuable, some policyholders still surrender (death, hardship, etc.). This sets the floor as a percentage of the base surrender rate. 10% means surrenders never fall below 10% of the base rate, regardless of how in-the-money the guarantee is.">
          <PercentInput value={p.lapse_min_multiplier} onChange={v => setParam('lapse_min_multiplier', v)} min={0} max={100} step={5} decimals={0} />
        </InputRow>
      </>}

      <SectionHeader title="Policyholder Behavior" />
      <InputRow label="% Who Take Withdrawals" tooltip="Percentage of in-force policyholders who actually take withdrawals in each period. In practice, not all eligible policyholders use their withdrawal benefit. 100% = everyone takes the maximum allowable withdrawal. Lower values reduce expected claim exposure.">
        <PercentInput value={p.benefit_utilization} onChange={v => setParam('benefit_utilization', v)} min={50} max={100} step={5} decimals={0} />
      </InputRow>

      <SectionHeader title="Valuation" />
      <InputRow label="Discount Rate" suffix="annual" tooltip="Interest rate used to convert future guarantee payments into today's dollars (present value). Typically set to a long-term risk-free rate such as a 10-year Treasury yield. A higher rate makes future payments worth less today, reducing the calculated cost of the rider.">
        <PercentInput value={p.discount_rate} onChange={v => setParam('discount_rate', v)} min={0} max={10} step={0.5} />
      </InputRow>
    </>
  );
}

function SimulationTab({ p, setParam }) {
  return (
    <>
      <SectionHeader title="Simulation" />
      <InputRow label="Scenarios" tooltip="Number of Monte Carlo paths. 1,000 is a good balance; use 5,000+ for tail risk analysis.">
        <NumberInput value={p.num_scenarios} onChange={v => setParam('num_scenarios', v)} min={100} max={10000} step={100} commas />
      </InputRow>
      <InputRow label="Random Seed" tooltip="Integer seed for the RNG. Same seed = reproducible results.">
        <NumberInput value={p.seed} onChange={v => setParam('seed', v)} min={1} max={999999} step={1} />
      </InputRow>
    </>
  );
}

// ---------------------------------------------------------------------------
// Mode toggle
// ---------------------------------------------------------------------------

function ModeToggle({ viewMode, setViewMode }) {
  return (
    <div className="flex items-center rounded-full border border-slate-700 bg-slate-800 p-0.5 text-xs font-semibold">
      <button
        onClick={() => setViewMode('standard')}
        className={`px-3 py-1.5 rounded-full transition-colors ${
          viewMode === 'standard' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
        }`}
      >
        Standard
      </button>
      <button
        onClick={() => setViewMode('advanced')}
        className={`px-3 py-1.5 rounded-full transition-colors ${
          viewMode === 'advanced' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
        }`}
      >
        Advanced
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

const STANDARD_TABS = [
  { id: 'contract', label: 'My Contract' },
  { id: 'market',   label: 'Market' },
];

const ADVANCED_TABS = [
  { id: 'profile',    label: 'Profile' },
  { id: 'riders',     label: 'Riders' },
  { id: 'market',     label: 'Market' },
  { id: 'actuarial',  label: 'Actuarial' },
  { id: 'simulation', label: 'Simulation' },
];

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function InputPanel({ params, setParam, onRun, onSensitivity, onOptimalAge, onSyncToStandard, presets, onLoadPreset, activePresetId, running, sensitivityRunning, optimalAgeRunning, viewMode = 'standard', setViewMode }) {
  const [stdTab, setStdTab] = useState('contract');
  const [advTab, setAdvTab] = useState('profile');
  const [savedBands, setSavedBands] = useState(DEFAULT_BANDS);
  const p = params;

  const tabs = viewMode === 'standard' ? STANDARD_TABS : ADVANCED_TABS;
  const activeTab = viewMode === 'standard' ? stdTab : advTab;
  const setActiveTab = viewMode === 'standard' ? setStdTab : setAdvTab;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-start justify-between mb-4 gap-2">
        <div className="min-w-0">
          <h1 className="text-base font-bold text-white leading-tight">VA Rider Calculator</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {viewMode === 'standard' ? 'Understand your contract value' : 'Actuarial present value analysis'}
          </p>
        </div>
        <div className="flex-shrink-0">
          <ModeToggle viewMode={viewMode} setViewMode={setViewMode} />
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-slate-700 mb-1 -mx-1">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 px-1 py-2 text-sm font-semibold transition-colors border-b-2 -mb-px ${
              activeTab === tab.id
                ? 'text-blue-400 border-blue-500'
                : 'text-slate-500 border-transparent hover:text-slate-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto pr-1 pt-1">
        {viewMode === 'standard' && activeTab === 'contract'    && <MyContractTab      p={p} setParam={setParam} />}
        {viewMode === 'standard' && activeTab === 'market'      && <MarketTab          p={p} setParam={setParam} />}
        {viewMode === 'advanced' && activeTab === 'profile'     && <ProfileTab         p={p} setParam={setParam} />}
        {viewMode === 'advanced' && activeTab === 'riders'      && <RidersTab          p={p} setParam={setParam} onOptimalAge={onOptimalAge} optimalAgeRunning={optimalAgeRunning} savedBands={savedBands} setSavedBands={setSavedBands} />}
        {viewMode === 'advanced' && activeTab === 'market'      && <AdvancedMarketTab  p={p} setParam={setParam} />}
        {viewMode === 'advanced' && activeTab === 'actuarial'   && <ActuarialTab       p={p} setParam={setParam} onSyncToStandard={onSyncToStandard} />}
        {viewMode === 'advanced' && activeTab === 'simulation'  && <SimulationTab      p={p} setParam={setParam} />}
      </div>

      {/* Run buttons */}
      <div className="pt-3 space-y-2 border-t border-slate-700 mt-2">
        <button
          onClick={() => onRun()}
          disabled={running}
          className="w-full py-3 px-4 bg-blue-600 text-white text-base font-bold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {running ? 'Running…' : 'Run Simulation'}
        </button>
        {viewMode === 'advanced' && (
          <button
            onClick={() => onSensitivity()}
            disabled={running || sensitivityRunning}
            className="w-full py-2.5 px-4 bg-slate-700 text-slate-300 text-sm font-semibold rounded-lg hover:bg-slate-600 disabled:opacity-50 transition-colors"
          >
            {sensitivityRunning ? 'Running Sensitivity…' : 'Run Sensitivity Analysis'}
          </button>
        )}
        {presets?.length > 0 && (
          <div className="pt-1">
            <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
              Load a product example
            </label>
            <select
              disabled={running}
              value=""
              onChange={e => { if (e.target.value) onLoadPreset(e.target.value); }}
              className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-300 cursor-pointer focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/40 disabled:opacity-40"
            >
              <option value="" disabled>— select a company —</option>
              {presets.map(p => (
                <option key={p.id} value={p.id} title={p.description}>{p.label}</option>
              ))}
            </select>
            {activePresetId && (() => {
              const preset = presets.find(p => p.id === activePresetId);
              return preset ? (
                <div className="mt-1.5 flex items-start gap-1.5 rounded-md bg-blue-900/40 border border-blue-700/50 px-2.5 py-1.5">
                  <span className="text-blue-400 mt-0.5 flex-shrink-0 text-xs">▶</span>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-blue-300 leading-tight truncate">{preset.label}</div>
                    <div className="text-xs text-blue-500 mt-0.5 leading-tight">{preset.description}</div>
                  </div>
                </div>
              ) : null;
            })()}
            {!activePresetId && <p className="mt-1 text-xs text-slate-600">Loads real product parameters. Click Run to compute.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
