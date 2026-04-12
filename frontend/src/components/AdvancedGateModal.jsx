import React, { useState, useEffect, useRef } from 'react';
import { sendOtp, verifyOtp } from '../api/client';

const ROLES = [
  { value: '',         label: 'Select your role (optional)' },
  { value: 'advisor',  label: 'Financial Advisor / RIA' },
  { value: 'student',  label: 'Student / Academic' },
  { value: 'consumer', label: 'Annuity Owner / Consumer' },
  { value: 'other',    label: 'Other' },
];

const FEATURES = [
  'Sensitivity tornado chart',
  'Year-by-year projection table + CSV export',
  'Up to 10,000 Monte Carlo scenarios',
  'Monthly time-step for higher accuracy',
  'Dynamic lapse & mortality controls',
  'Custom discount rate & fixed account',
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESEND_SECONDS = 60;

// ---------------------------------------------------------------------------
// Step 1 — email + role form
// ---------------------------------------------------------------------------
function EmailStep({ onCodeSent, onCancel }) {
  const [email, setEmail] = useState('');
  const [role, setRole]   = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  const inputCls = "w-full rounded-lg border border-slate-200 px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 bg-white";

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!EMAIL_RE.test(email.trim())) {
      setError('Please enter a valid email address.');
      return;
    }
    setSending(true);
    setError('');
    try {
      await sendOtp(email.trim().toLowerCase());
      onCodeSent(email.trim().toLowerCase(), role);
    } catch (err) {
      const msg = err?.response?.data?.detail || err.message || '';
      if (err?.response?.status === 429) {
        setError('Too many requests. Please wait a few minutes before trying again.');
      } else if (msg.includes('offline') || !err?.response) {
        setError('Cannot reach the server. Make sure the backend is running.');
      } else {
        setError(msg || 'Failed to send code. Please try again.');
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-8">

        {/* Header */}
        <div className="mb-5 text-center">
          <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6 text-[#0078D7]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-slate-800">Unlock Advanced Mode</h2>
          <p className="text-sm text-slate-500 mt-1 leading-relaxed">
            Free during beta — enter your email and we'll send a one-time code to verify.
          </p>
        </div>

        {/* Feature list */}
        <ul className="mb-5 space-y-1.5">
          {FEATURES.map(f => (
            <li key={f} className="flex items-center gap-2 text-xs text-slate-600">
              <span className="text-emerald-500 font-bold flex-shrink-0">✓</span>
              {f}
            </li>
          ))}
        </ul>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <input
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={e => { setEmail(e.target.value); setError(''); }}
              className={inputCls}
              autoFocus
              disabled={sending}
            />
            {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
          </div>

          <select
            value={role}
            onChange={e => setRole(e.target.value)}
            className={inputCls + ' text-slate-500'}
            disabled={sending}
          >
            {ROLES.map(r => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>

          <button
            type="submit"
            disabled={sending}
            className="w-full py-2.5 bg-[#0078D7] text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {sending ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Sending…
              </>
            ) : 'Send verification code'}
          </button>
        </form>

        <button
          onClick={onCancel}
          className="w-full mt-3 text-xs text-slate-400 hover:text-slate-600 transition-colors py-1"
        >
          Stay in Standard Mode
        </button>

        <p className="text-xs text-slate-300 mt-4 text-center leading-relaxed">
          No spam. Unsubscribe anytime. We never sell your data.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — 6-digit code entry
// ---------------------------------------------------------------------------
function CodeStep({ email, role, onVerified, onBack }) {
  const [code, setCode]     = useState('');
  const [error, setError]   = useState('');
  const [verifying, setVerifying] = useState(false);
  const [resendCd, setResendCd]   = useState(RESEND_SECONDS);
  const [resending, setResending] = useState(false);
  const inputRef = useRef(null);

  // Resend countdown
  useEffect(() => {
    if (resendCd <= 0) return;
    const t = setTimeout(() => setResendCd(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCd]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleVerify = async (e) => {
    e.preventDefault();
    const trimmed = code.replace(/\s/g, '');
    if (!/^\d{6}$/.test(trimmed)) {
      setError('Please enter the 6-digit code from your email.');
      return;
    }
    setVerifying(true);
    setError('');
    try {
      await verifyOtp(email, trimmed);
      onVerified(email, role);
    } catch (err) {
      const msg = err?.response?.data?.detail || err.message || '';
      setError(msg || 'Verification failed. Please try again.');
    } finally {
      setVerifying(false);
    }
  };

  const handleResend = async () => {
    setResending(true);
    setError('');
    try {
      await sendOtp(email);
      setResendCd(RESEND_SECONDS);
      setCode('');
    } catch (err) {
      const msg = err?.response?.data?.detail || err.message || '';
      setError(msg || 'Failed to resend. Please try again.');
    } finally {
      setResending(false);
    }
  };

  const inputCls = "w-full rounded-lg border border-slate-200 px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 bg-white";

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-8">

        {/* Header */}
        <div className="mb-6 text-center">
          <div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-slate-800">Check your email</h2>
          <p className="text-sm text-slate-500 mt-1 leading-relaxed">
            We sent a 6-digit code to{' '}
            <span className="font-semibold text-slate-700">{email}</span>.
            It expires in 10 minutes.
          </p>
        </div>

        <form onSubmit={handleVerify} className="space-y-3">
          <div>
            <input
              ref={inputRef}
              type="text"
              inputMode="numeric"
              placeholder="123456"
              maxLength={6}
              value={code}
              onChange={e => { setCode(e.target.value.replace(/\D/g, '')); setError(''); }}
              className={inputCls + ' text-center text-xl tracking-[0.5em] font-mono'}
              disabled={verifying}
            />
            {error && <p className="text-xs text-red-500 mt-1 text-center">{error}</p>}
          </div>

          <button
            type="submit"
            disabled={verifying || code.length < 6}
            className="w-full py-2.5 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {verifying ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Verifying…
              </>
            ) : 'Verify & Unlock'}
          </button>
        </form>

        {/* Resend + back row */}
        <div className="mt-4 flex items-center justify-between text-xs">
          <button
            onClick={onBack}
            className="text-slate-400 hover:text-slate-600 transition-colors"
          >
            ← Change email
          </button>
          {resendCd > 0 ? (
            <span className="text-slate-400">Resend in {resendCd}s</span>
          ) : (
            <button
              onClick={handleResend}
              disabled={resending}
              className="text-[#0078D7] hover:text-blue-700 font-semibold transition-colors disabled:opacity-60"
            >
              {resending ? 'Sending…' : 'Resend code'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main export — orchestrates the two steps
// ---------------------------------------------------------------------------
export default function AdvancedGateModal({ onUnlock, onCancel }) {
  const [step, setStep]   = useState('email'); // 'email' | 'code'
  const [email, setEmail] = useState('');
  const [role, setRole]   = useState('');

  const handleCodeSent = (verifiedEmail, selectedRole) => {
    setEmail(verifiedEmail);
    setRole(selectedRole);
    setStep('code');
  };

  if (step === 'email') {
    return (
      <EmailStep
        onCodeSent={handleCodeSent}
        onCancel={onCancel}
      />
    );
  }

  return (
    <CodeStep
      email={email}
      role={role}
      onVerified={(verifiedEmail, selectedRole) => onUnlock(verifiedEmail, selectedRole)}
      onBack={() => setStep('email')}
    />
  );
}
