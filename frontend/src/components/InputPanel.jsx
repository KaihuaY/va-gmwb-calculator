import React from 'react';

// ---------------------------------------------------------------------------
// Primitive input controls
// ---------------------------------------------------------------------------

function SectionHeader({ title }) {
  return (
    <div className="text-xs font-bold text-slate-400 uppercase tracking-widest pt-3 pb-1 border-b border-slate-100 mb-2">
      {title}
    </div>
  );
}

function Tooltip({ text }) {
  return (
    <span className="group relative ml-1 cursor-help text-slate-300 hover:text-slate-500">
      ?
      <span className="pointer-events-none absolute left-4 top-0 z-50 hidden w-64 rounded-md bg-slate-800 px-3 py-2 text-xs text-white shadow-lg group-hover:block leading-relaxed">
        {text}
      </span>
    </span>
  );
}

function InputRow({ label, tooltip, suffix, children }) {
  return (
    <div className="mb-2">
      <label className="flex items-center text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
        {label}
        {tooltip && <Tooltip text={tooltip} />}
        {suffix && <span className="ml-1 font-normal text-slate-400 normal-case">({suffix})</span>}
      </label>
      {children}
    </div>
  );
}

function NumberInput({ value, onChange, min, max, step }) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={e => onChange(parseFloat(e.target.value) || 0)}
      className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-800 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-200"
    />
  );
}

function SelectInput({ value, onChange, options }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-800 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-200"
    >
      {options.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

function CheckboxInput({ checked, onChange, label }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-slate-300 text-blue-600"
      />
      <span className="text-xs text-slate-500">{label}</span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Main InputPanel component
// ---------------------------------------------------------------------------

export default function InputPanel({ params, setParam, onRun, onSensitivity, running, sensitivityRunning }) {
  const p = params;

  return (
    <div className="flex flex-col h-full">
      <div className="mb-4">
        <h1 className="text-base font-bold text-slate-800">VA GMWB Calculator</h1>
        <p className="text-xs text-slate-400 mt-0.5">Present value of guaranteed withdrawal benefits</p>
      </div>

      <div className="flex-1 overflow-y-auto pr-1 space-y-0.5">

        <SectionHeader title="Policyholder" />
        <InputRow label="Current Age" tooltip="Age of the annuitant at the valuation date.">
          <NumberInput value={p.current_age} onChange={v => setParam('current_age', v)} min={40} max={90} step={1} />
        </InputRow>
        <InputRow label="Gender" tooltip="Determines which mortality rates are used from the selected table.">
          <SelectInput value={p.gender} onChange={v => setParam('gender', v)}
            options={[{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }]} />
        </InputRow>
        <InputRow label="Max Projection Age" tooltip="End of projection horizon (omega). Policyholder is assumed dead by this age. Typical: 100–120.">
          <NumberInput value={p.max_age} onChange={v => setParam('max_age', v)} min={90} max={120} step={1} />
        </InputRow>
        <InputRow label="Mortality Table" tooltip="2012 IAM Basic includes Scale G2 improvement factors. Annuity 2000 is a static table.">
          <SelectInput value={p.mortality_table} onChange={v => setParam('mortality_table', v)}
            options={[{ value: '2012iam', label: '2012 IAM Basic' }, { value: 'annuity2000', label: 'Annuity 2000' }]} />
        </InputRow>

        <SectionHeader title="Contract" />
        <InputRow label="Account Value" suffix="$" tooltip="Current market value of the variable annuity subaccounts. This fluctuates with market returns and is reduced by withdrawals and fees.">
          <NumberInput value={p.account_value} onChange={v => setParam('account_value', v)} min={10000} max={10000000} step={10000} />
        </InputRow>
        <InputRow label="Benefit Base" suffix="$" tooltip="Notional amount used to calculate the guaranteed withdrawal. May differ from Account Value due to roll-ups or prior performance.">
          <NumberInput value={p.benefit_base} onChange={v => setParam('benefit_base', v)} min={10000} max={10000000} step={10000} />
        </InputRow>
        <InputRow label="Withdrawal Rate" suffix="% of BB" tooltip="Annual guaranteed withdrawal as a percentage of the benefit base. Typical: 4–6% depending on age at first withdrawal.">
          <NumberInput value={p.withdrawal_rate} onChange={v => setParam('withdrawal_rate', v)} min={0.01} max={0.10} step={0.005} />
        </InputRow>
        <InputRow label="Rider Fee" suffix="% of BB/yr" tooltip="Annual GMWB rider charge deducted from account value. Compensates the insurer for the guarantee. Typical: 0.75–1.50%.">
          <NumberInput value={p.rider_fee} onChange={v => setParam('rider_fee', v)} min={0} max={0.03} step={0.0025} />
        </InputRow>
        <InputRow label="M&E + Admin Fee" suffix="% of AV/yr" tooltip="Mortality & Expense risk charge plus admin fee, assessed on account value. Covers base contract costs. Typical: 1.25–1.50%.">
          <NumberInput value={p.me_fee} onChange={v => setParam('me_fee', v)} min={0} max={0.03} step={0.001} />
        </InputRow>
        <InputRow label="Roll-up Rate" suffix="% of BB/yr" tooltip="Annual compound increase applied to the benefit base during the accumulation phase. 0 = no roll-up. Creates a 'ratchet up' of the guarantee.">
          <NumberInput value={p.rollup_rate} onChange={v => setParam('rollup_rate', v)} min={0} max={0.08} step={0.005} />
        </InputRow>
        <InputRow label="Step-up (Ratchet)" tooltip="If enabled, the benefit base is reset to the account value at each anniversary when AV > BB. Locks in market gains.">
          <CheckboxInput checked={p.step_up} onChange={v => setParam('step_up', v)}
            label={p.step_up ? 'On — BB ratchets to AV at anniversary' : 'Off'} />
        </InputRow>

        <SectionHeader title="Economic" />
        <InputRow label="Expected Return (μ)" suffix="annual" tooltip="Gross expected annual return on subaccount assets before fees. This is the real-world drift parameter for the GBM model.">
          <NumberInput value={p.mu} onChange={v => setParam('mu', v)} min={-0.05} max={0.20} step={0.005} />
        </InputRow>
        <InputRow label="Volatility (σ)" suffix="annual" tooltip="Annual standard deviation of subaccount returns. Higher volatility increases both the chance of account depletion and the value of the guarantee.">
          <NumberInput value={p.sigma} onChange={v => setParam('sigma', v)} min={0.05} max={0.50} step={0.01} />
        </InputRow>
        <InputRow label="Discount Rate" suffix="annual" tooltip="Risk-free rate used to compute present values. Typically a long-term Treasury or swap rate.">
          <NumberInput value={p.discount_rate} onChange={v => setParam('discount_rate', v)} min={0} max={0.10} step={0.005} />
        </InputRow>
        <InputRow label="Frequency" tooltip="Projection time step. Monthly is more accurate (captures intra-year fee/withdrawal timing) but runs ~12× slower.">
          <SelectInput value={p.frequency} onChange={v => setParam('frequency', v)}
            options={[{ value: 'annual', label: 'Annual' }, { value: 'monthly', label: 'Monthly' }]} />
        </InputRow>

        <SectionHeader title="Behavioral" />
        <InputRow label="Lapse Rate" suffix="annual" tooltip="Annual probability a policyholder surrenders the contract. Reduces the in-force population and expected claim exposure.">
          <NumberInput value={p.lapse_rate} onChange={v => setParam('lapse_rate', v)} min={0} max={0.20} step={0.005} />
        </InputRow>
        <InputRow label="Benefit Utilization" tooltip="Fraction of in-force policyholders who actually take withdrawals. 1.0 = all policyholders exercise the guarantee every period.">
          <NumberInput value={p.benefit_utilization} onChange={v => setParam('benefit_utilization', v)} min={0.5} max={1.0} step={0.05} />
        </InputRow>
        <InputRow label="Mortality Multiplier" tooltip="Multiplicative adjustment to base mortality rates. <1 = lighter mortality (annuitants live longer than table). >1 = heavier mortality.">
          <NumberInput value={p.mort_multiplier} onChange={v => setParam('mort_multiplier', v)} min={0.5} max={2.0} step={0.05} />
        </InputRow>

        <SectionHeader title="Simulation" />
        <InputRow label="Scenarios" tooltip="Number of Monte Carlo paths. More scenarios → smoother distributions but slower runtime. 1,000 is a good balance; use 5,000+ for tail risk analysis.">
          <NumberInput value={p.num_scenarios} onChange={v => setParam('num_scenarios', v)} min={100} max={10000} step={100} />
        </InputRow>
        <InputRow label="Random Seed" tooltip="Integer seed for the random number generator. Use the same seed to reproduce exact results across runs.">
          <NumberInput value={p.seed} onChange={v => setParam('seed', v)} min={1} max={999999} step={1} />
        </InputRow>
      </div>

      <div className="pt-3 space-y-2 border-t border-slate-100 mt-2">
        <button
          onClick={onRun}
          disabled={running}
          className="w-full py-2 px-4 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {running ? 'Running…' : 'Run Simulation'}
        </button>
        <button
          onClick={onSensitivity}
          disabled={running || sensitivityRunning}
          className="w-full py-2 px-4 bg-slate-100 text-slate-700 text-xs font-semibold rounded-lg hover:bg-slate-200 disabled:opacity-50 transition-colors"
        >
          {sensitivityRunning ? 'Running Sensitivity…' : 'Run Sensitivity Analysis'}
        </button>
      </div>
    </div>
  );
}
