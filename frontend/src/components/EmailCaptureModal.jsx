import React, { useState } from 'react';

const ROLES = [
  { value: '',         label: 'Select your role (optional)' },
  { value: 'advisor',  label: 'Financial Advisor' },
  { value: 'student',  label: 'Student' },
  { value: 'consumer', label: 'Annuity Owner / Consumer' },
  { value: 'other',    label: 'Other' },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function EmailCaptureModal({ onSubmit, onSkip }) {
  const [email, setEmail] = useState('');
  const [role, setRole]   = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!EMAIL_RE.test(email)) {
      setError('Please enter a valid email address.');
      return;
    }
    onSubmit(email.trim().toLowerCase(), role);
  };

  const inputCls = "w-full rounded-lg border border-slate-200 px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 bg-white";

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-8">

        {/* Header */}
        <div className="mb-6">
          <h2 className="text-lg font-bold text-slate-800">Your results are ready</h2>
          <p className="text-sm text-slate-500 mt-1 leading-relaxed">
            Save your analysis and stay updated when new features launch — enter your email to continue.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <input
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={e => { setEmail(e.target.value); setError(''); }}
              className={inputCls}
              autoFocus
            />
            {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
          </div>

          <select
            value={role}
            onChange={e => setRole(e.target.value)}
            className={inputCls + " text-slate-500"}
          >
            {ROLES.map(r => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>

          <button
            type="submit"
            className="w-full py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors"
          >
            Save My Results
          </button>
        </form>

        <button
          onClick={onSkip}
          className="w-full mt-3 text-xs text-slate-400 hover:text-slate-600 transition-colors py-1"
        >
          Skip for now
        </button>

        <p className="text-xs text-slate-300 mt-4 text-center leading-relaxed">
          No spam. Unsubscribe anytime. We never sell your data.
        </p>
      </div>
    </div>
  );
}
