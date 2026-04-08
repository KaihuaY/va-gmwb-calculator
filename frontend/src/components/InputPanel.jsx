import React, { useState } from 'react';

// ---------------------------------------------------------------------------
// Dark-themed primitive input controls (sidebar is bg-slate-900)
// ---------------------------------------------------------------------------

function SectionHeader({ title }) {
  return (
    <div className="text-xs font-bold text-slate-500 uppercase tracking-widest pt-4 pb-1.5 border-b border-slate-700 mb-3">
      {title}
    </div>
  );
}

function Tooltip({ text }) {
  return (
    <span className="group relative ml-1.5 cursor-help text-slate-600 hover:text-slate-400 text-base leading-none select-none">
      ⓘ
      <span className="pointer-events-none absolute left-5 top-0 z-50 hidden w-72 rounded-lg bg-slate-800 border border-slate-700 px-3 py-2.5 text-sm text-slate-200 shadow-xl group-hover:block leading-relaxed">
        {text}
      </span>
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

function NumberInput({ value, onChange, min, max, step }) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={e => onChange(parseFloat(e.target.value) || 0)}
      className={inputClass}
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
  return (
    <div className="relative">
      <input
        type="number"
        value={parseFloat((value * 100).toFixed(decimals))}
        min={min}
        max={max}
        step={step}
        onChange={e => onChange((parseFloat(e.target.value) || 0) / 100)}
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
        <NumberInput value={p.current_age} onChange={v => setParam('current_age', v)} min={40} max={90} step={1} />
      </InputRow>
      <InputRow label="Gender" tooltip="Used to look up how long you're expected to live, which affects how many years your guarantee may need to pay out.">
        <SelectInput value={p.gender} onChange={v => setParam('gender', v)}
          options={[{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }]} />
      </InputRow>

      <RiderSelection p={p} setParam={setParam} standard />

      <SectionHeader title="Contract" />
      <InputRow label="Account Value" suffix="$" tooltip="The current market value of your annuity — what your money is worth today in the investment subaccounts.">
        <NumberInput value={p.account_value} onChange={v => setParam('account_value', v)} min={10000} max={10000000} step={10000} />
      </InputRow>
      <InputRow label="Annual Contract Fee" suffix="% /yr" tooltip="The base annual fee charged by the insurance company for managing your annuity contract (M&E charge).">
        <PercentInput value={p.me_fee} onChange={v => setParam('me_fee', v)} min={0} max={3} step={0.1} />
      </InputRow>

      {p.gmwb_enabled && (
        <>
          <SectionHeader title="Withdrawal Benefit (GMWB)" />
          <InputRow label="Withdrawal Guarantee Base" suffix="$" tooltip="The protected amount your annual withdrawals are calculated from. May be higher than your account value if your contract has grown via a roll-up or market step-up.">
            <NumberInput value={p.benefit_base} onChange={v => setParam('benefit_base', v)} min={10000} max={10000000} step={10000} />
          </InputRow>
          <InputRow label="Withdrawal Start Age" tooltip="The age at which you plan to start taking guaranteed withdrawals. A later start can increase your annual payment if your contract has a roll-up rate.">
            <NumberInput value={p.election_age} onChange={v => setParam('election_age', v)} min={p.current_age} max={100} step={1} />
          </InputRow>
          <InputRow label="Annual Withdrawal %" tooltip="The percentage of your guarantee base you can withdraw each year, for life. Typical: 4% before age 60, 5% at 60–64, 6% at 65+.">
            <PercentInput value={p.withdrawal_rate} onChange={v => setParam('withdrawal_rate', v)} min={1} max={10} step={0.5} />
          </InputRow>
          <InputRow label="Withdrawal Rider Fee" suffix="% /yr" tooltip="Annual fee for the withdrawal guarantee, deducted from your account. Charged on the guarantee base. Typical: 0.75–1.50%.">
            <PercentInput value={p.rider_fee} onChange={v => setParam('rider_fee', v)} min={0} max={3} step={0.25} />
          </InputRow>
          <InputRow label="Guarantee Growth Rate" suffix="% /yr" tooltip="If your contract has a roll-up feature, your guarantee base grows at this rate each year before you start withdrawals. Set to 0 if not applicable.">
            <PercentInput value={p.rollup_rate} onChange={v => setParam('rollup_rate', v)} min={0} max={8} step={0.5} />
          </InputRow>
          <InputRow label="Lock In Market Gains" tooltip="If on, your guarantee base automatically resets to your account value each year when markets rise — permanently locking in the higher amount.">
            <CheckboxInput checked={p.step_up} onChange={v => setParam('step_up', v)}
              label={p.step_up ? 'On — guarantee base locks in market highs' : 'Off'} />
          </InputRow>
        </>
      )}

      {p.gmdb_enabled && (
        <>
          <SectionHeader title="Death Benefit (GMDB)" />
          <InputRow label="Death Benefit Base" suffix="$" tooltip="The minimum amount your beneficiaries receive. Often equals your account value at contract issue. May differ from your withdrawal guarantee base.">
            <NumberInput value={p.gmdb_benefit_base} onChange={v => setParam('gmdb_benefit_base', v)} min={10000} max={10000000} step={10000} />
          </InputRow>
          <InputRow label="Death Benefit Rider Fee" suffix="% /yr" tooltip="Annual fee for the death benefit guarantee, deducted from your account. Charged on the death benefit base. Typical: 0.25–0.75%.">
            <PercentInput value={p.gmdb_rider_fee} onChange={v => setParam('gmdb_rider_fee', v)} min={0} max={3} step={0.25} />
          </InputRow>
          <InputRow label="Death Benefit Growth Rate" suffix="% /yr" tooltip="If your contract grows the death benefit base each year, enter that rate here. This increases the minimum your beneficiaries receive over time. Set to 0 if not applicable.">
            <PercentInput value={p.gmdb_rollup_rate} onChange={v => setParam('gmdb_rollup_rate', v)} min={0} max={8} step={0.5} />
          </InputRow>
          <InputRow label="Lock In Market Gains (DB)" tooltip="If on, your death benefit base also locks in market highs each year — in addition to any growth rate.">
            <CheckboxInput checked={p.gmdb_step_up} onChange={v => setParam('gmdb_step_up', v)}
              label={p.gmdb_step_up ? 'On — death benefit base locks in market highs' : 'Off'} />
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

function PolicyholderTab({ p, setParam }) {
  return (
    <>
      <SectionHeader title="Policyholder" />
      <InputRow label="Current Age" tooltip="Age of the annuitant at the valuation date.">
        <NumberInput value={p.current_age} onChange={v => setParam('current_age', v)} min={40} max={90} step={1} />
      </InputRow>
      <InputRow label="Gender" tooltip="Determines which mortality rates are used from the selected table.">
        <SelectInput value={p.gender} onChange={v => setParam('gender', v)}
          options={[{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }]} />
      </InputRow>
      <InputRow label="Max Projection Age" tooltip="End of projection horizon (omega). Policyholder is assumed dead by this age.">
        <NumberInput value={p.max_age} onChange={v => setParam('max_age', v)} min={90} max={120} step={1} />
      </InputRow>

      <RiderSelection p={p} setParam={setParam} />

      <SectionHeader title="Contract — Base" />
      <InputRow label="Account Value (AV)" suffix="$" tooltip="Current market value of the variable annuity subaccounts.">
        <NumberInput value={p.account_value} onChange={v => setParam('account_value', v)} min={10000} max={10000000} step={10000} />
      </InputRow>
      <InputRow label="M&E + Admin Fee" suffix="% of AV/yr" tooltip="Mortality & Expense risk charge plus admin fee. Typical: 1.25–1.50%.">
        <PercentInput value={p.me_fee} onChange={v => setParam('me_fee', v)} min={0} max={3} step={0.1} />
      </InputRow>

      {p.gmwb_enabled && (
        <>
          <SectionHeader title="GMWB Contract" />
          <InputRow label="GMWB Benefit Base (BB)" suffix="$" tooltip="Notional amount used to calculate GAW = BB × withdrawal_rate. May differ from AV due to roll-ups.">
            <NumberInput value={p.benefit_base} onChange={v => setParam('benefit_base', v)} min={10000} max={10000000} step={10000} />
          </InputRow>
          <InputRow label="Election Age" tooltip="Age at which withdrawals begin. Before = accumulation phase (roll-up applies, no GAW).">
            <NumberInput value={p.election_age} onChange={v => setParam('election_age', v)} min={p.current_age} max={100} step={1} />
          </InputRow>
          <InputRow label="Withdrawal Rate" suffix="% of BB" tooltip="Annual GAW as % of benefit base. Age-banded: ~4% at 55–59, 5% at 60–64, 6% at 65+.">
            <PercentInput value={p.withdrawal_rate} onChange={v => setParam('withdrawal_rate', v)} min={1} max={10} step={0.5} />
          </InputRow>
          <InputRow label="GMWB Rider Fee" suffix="% of BB/yr" tooltip="Annual GMWB rider charge deducted from AV. Charged on GMWB BB. Typical: 0.75–1.50%.">
            <PercentInput value={p.rider_fee} onChange={v => setParam('rider_fee', v)} min={0} max={3} step={0.25} />
          </InputRow>
          <InputRow label="Roll-up Rate" suffix="% of BB/yr" tooltip="Annual BB growth during accumulation phase only (stops at election age).">
            <PercentInput value={p.rollup_rate} onChange={v => setParam('rollup_rate', v)} min={0} max={8} step={0.5} />
          </InputRow>
          <InputRow label="Step-up (Ratchet)" tooltip="BB = max(BB, AV) at each anniversary. Locks in market gains permanently.">
            <CheckboxInput checked={p.step_up} onChange={v => setParam('step_up', v)}
              label={p.step_up ? 'On — BB ratchets to AV at anniversary' : 'Off'} />
          </InputRow>
        </>
      )}

      {p.gmdb_enabled && (
        <>
          <SectionHeader title="GMDB Contract" />
          <InputRow label="GMDB Benefit Base" suffix="$" tooltip="Notional used for death benefit shortfall: max(0, GMDB_BB − AV). Often equals AV at issue. Tracked separately from GMWB BB.">
            <NumberInput value={p.gmdb_benefit_base} onChange={v => setParam('gmdb_benefit_base', v)} min={10000} max={10000000} step={10000} />
          </InputRow>
          <InputRow label="GMDB Rider Fee" suffix="% of GMDB BB/yr" tooltip="Annual GMDB rider charge deducted from AV. Charged on GMDB BB. Typical: 0.25–0.75%.">
            <PercentInput value={p.gmdb_rider_fee} onChange={v => setParam('gmdb_rider_fee', v)} min={0} max={3} step={0.25} />
          </InputRow>
          <InputRow label="GMDB Roll-up Rate" suffix="% of BB/yr" tooltip="Annual GMDB BB growth (applies every year, unlike GMWB roll-up which stops at election age).">
            <PercentInput value={p.gmdb_rollup_rate} onChange={v => setParam('gmdb_rollup_rate', v)} min={0} max={8} step={0.5} />
          </InputRow>
          <InputRow label="GMDB Step-up (Ratchet)" tooltip="GMDB_BB = max(GMDB_BB, AV) at each anniversary. Tracked independently of GMWB step-up.">
            <CheckboxInput checked={p.gmdb_step_up} onChange={v => setParam('gmdb_step_up', v)}
              label={p.gmdb_step_up ? 'On — GMDB BB ratchets to AV at anniversary' : 'Off'} />
          </InputRow>
        </>
      )}
    </>
  );
}

function AssumptionsTab({ p, setParam }) {
  return (
    <>
      <SectionHeader title="Mortality" />
      <InputRow label="Mortality Table" tooltip="2012 IAM Basic includes Scale G2 improvement. Annuity 2000 is a static table.">
        <SelectInput value={p.mortality_table} onChange={v => setParam('mortality_table', v)}
          options={[{ value: '2012iam', label: '2012 IAM Basic' }, { value: 'annuity2000', label: 'Annuity 2000' }]} />
      </InputRow>
      <InputRow label="Mortality Multiplier" tooltip="Scales all qx values. <1 = lighter mortality (annuitants live longer). >1 = heavier.">
        <NumberInput value={p.mort_multiplier} onChange={v => setParam('mort_multiplier', v)} min={0.5} max={2.0} step={0.05} />
      </InputRow>

      <SectionHeader title="Lapse" />
      <InputRow label="Base Lapse Rate" suffix="annual" tooltip="Annual probability a policyholder surrenders the contract.">
        <PercentInput value={p.lapse_rate} onChange={v => setParam('lapse_rate', v)} min={0} max={20} step={0.5} />
      </InputRow>
      <InputRow label="Dynamic Lapse" tooltip="ITM-adjusted: lapse decreases as BB/AV rises (guarantee more in-the-money).">
        <SelectInput
          value={p.dynamic_lapse ? 'on' : 'off'}
          onChange={v => setParam('dynamic_lapse', v === 'on')}
          options={[{ value: 'off', label: 'Off (static)' }, { value: 'on', label: 'On (ITM-adjusted)' }]}
        />
      </InputRow>
      {p.dynamic_lapse && <>
        <InputRow label="ITM Sensitivity" tooltip="How quickly lapse falls as BB/AV rises. 0.5 = lapse halves when BB = 2× AV.">
          <NumberInput value={p.lapse_sensitivity} onChange={v => setParam('lapse_sensitivity', v)} min={0} max={2.0} step={0.1} />
        </InputRow>
        <InputRow label="Min Lapse Floor" tooltip="Floor as % of base rate. 10% means lapse can never fall below 10% of base rate.">
          <PercentInput value={p.lapse_min_multiplier} onChange={v => setParam('lapse_min_multiplier', v)} min={0} max={100} step={5} decimals={0} />
        </InputRow>
      </>}

      <SectionHeader title="Policyholder Behavior" />
      <InputRow label="Benefit Utilization" tooltip="% of in-force policyholders who actually take withdrawals each period.">
        <PercentInput value={p.benefit_utilization} onChange={v => setParam('benefit_utilization', v)} min={50} max={100} step={5} decimals={0} />
      </InputRow>
    </>
  );
}

function EconomicTab({ p, setParam }) {
  return (
    <>
      <SectionHeader title="Variable Subaccounts" />
      <InputRow label="Expected Return (μ)" suffix="annual" tooltip="Gross expected annual return before fees. Real-world GBM drift parameter.">
        <PercentInput value={p.mu} onChange={v => setParam('mu', v)} min={-5} max={20} step={0.5} />
      </InputRow>
      <InputRow label="Volatility (σ)" suffix="annual" tooltip="Annual standard deviation of subaccount returns. Higher volatility increases claim exposure.">
        <PercentInput value={p.sigma} onChange={v => setParam('sigma', v)} min={0} max={50} step={1} decimals={1} />
      </InputRow>

      <SectionHeader title="Fixed / Guaranteed Account" />
      <InputRow label="Fixed Account Allocation" suffix="% of AV" tooltip="Proportion of AV allocated to the fixed/guaranteed account. 0% = fully variable. The remainder earns GBM returns.">
        <PercentInput value={p.fixed_account_pct} onChange={v => setParam('fixed_account_pct', v)} min={0} max={100} step={5} decimals={0} />
      </InputRow>
      {p.fixed_account_pct > 0 && (
        <InputRow label="Fixed Account Rate" suffix="% /yr" tooltip="Guaranteed annual crediting rate on the fixed account portion. Typically a current declared rate set by the insurer.">
          <PercentInput value={p.fixed_account_rate} onChange={v => setParam('fixed_account_rate', v)} min={0} max={10} step={0.25} />
        </InputRow>
      )}

      <SectionHeader title="Valuation" />
      <InputRow label="Discount Rate" suffix="annual" tooltip="Risk-free rate for PV discounting. Typically a long-term Treasury or swap rate.">
        <PercentInput value={p.discount_rate} onChange={v => setParam('discount_rate', v)} min={0} max={10} step={0.5} />
      </InputRow>
      <InputRow label="Frequency" tooltip="Projection time step. Monthly is more accurate but ~12× slower.">
        <SelectInput value={p.frequency} onChange={v => setParam('frequency', v)}
          options={[{ value: 'annual', label: 'Annual' }, { value: 'monthly', label: 'Monthly' }]} />
      </InputRow>
    </>
  );
}

function SimulationTab({ p, setParam }) {
  return (
    <>
      <SectionHeader title="Simulation" />
      <InputRow label="Scenarios" tooltip="Number of Monte Carlo paths. 1,000 is a good balance; use 5,000+ for tail risk analysis.">
        <NumberInput value={p.num_scenarios} onChange={v => setParam('num_scenarios', v)} min={100} max={10000} step={100} />
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
  { id: 'policyholder', label: 'Policyholder' },
  { id: 'assumptions',  label: 'Assumptions' },
  { id: 'economic',     label: 'Economic' },
  { id: 'simulation',   label: 'Simulation' },
];

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function InputPanel({ params, setParam, onRun, onSensitivity, running, sensitivityRunning, viewMode = 'standard', setViewMode }) {
  const [stdTab, setStdTab] = useState('contract');
  const [advTab, setAdvTab] = useState('policyholder');
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
        {viewMode === 'standard' && activeTab === 'contract'      && <MyContractTab    p={p} setParam={setParam} />}
        {viewMode === 'standard' && activeTab === 'market'        && <MarketTab        p={p} setParam={setParam} />}
        {viewMode === 'advanced' && activeTab === 'policyholder'  && <PolicyholderTab  p={p} setParam={setParam} />}
        {viewMode === 'advanced' && activeTab === 'assumptions'   && <AssumptionsTab   p={p} setParam={setParam} />}
        {viewMode === 'advanced' && activeTab === 'economic'      && <EconomicTab      p={p} setParam={setParam} />}
        {viewMode === 'advanced' && activeTab === 'simulation'    && <SimulationTab    p={p} setParam={setParam} />}
      </div>

      {/* Run buttons */}
      <div className="pt-3 space-y-2 border-t border-slate-700 mt-2">
        <button
          onClick={onRun}
          disabled={running}
          className="w-full py-3 px-4 bg-blue-600 text-white text-base font-bold rounded-lg hover:bg-blue-500 disabled:opacity-50 transition-colors"
        >
          {running ? 'Running…' : 'Run Simulation'}
        </button>
        {viewMode === 'advanced' && (
          <button
            onClick={onSensitivity}
            disabled={running || sensitivityRunning}
            className="w-full py-2.5 px-4 bg-slate-700 text-slate-300 text-sm font-semibold rounded-lg hover:bg-slate-600 disabled:opacity-50 transition-colors"
          >
            {sensitivityRunning ? 'Running Sensitivity…' : 'Run Sensitivity Analysis'}
          </button>
        )}
      </div>
    </div>
  );
}
