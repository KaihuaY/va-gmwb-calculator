import { useState } from 'react';
import { Link } from 'react-router-dom';
import { JACKSON_SHARE_HASH } from '../App';

// ---------------------------------------------------------------------------
// Design tokens (adapted from AnnuityVoice palette)
// ---------------------------------------------------------------------------
// Primary bg:     #F6F5F5  (off-white)
// Dark section:   #0f1f3d  (deep navy, refined from #33313B)
// Accent blue:    #0052CC
// Hero gradient:  45deg, #FFE3E3 → #D6DFFF
// Text:           #1a1a2e  /  #4b5563

// ---------------------------------------------------------------------------
// Nav
// ---------------------------------------------------------------------------
function Nav() {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <nav className="sticky top-0 z-50 bg-white/90 backdrop-blur border-b border-slate-200">
      <div className="max-w-6xl mx-auto px-5 py-3 flex items-center justify-between">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2.5 group">
          <div className="w-8 h-8 rounded-lg bg-[#0052CC] flex items-center justify-center flex-shrink-0">
            <span className="text-white font-black text-sm">AV</span>
          </div>
          <span className="text-lg font-bold text-[#0f1f3d] tracking-tight">
            Annuity<span className="text-[#0052CC]">Voice</span>
          </span>
        </Link>

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-6">
          <a href="#how-it-works" className="text-sm font-medium text-slate-600 hover:text-[#0052CC] transition-colors">How it Works</a>
          <a href="#scenarios" className="text-sm font-medium text-slate-600 hover:text-[#0052CC] transition-colors">What We Find</a>
          <a href="#faq" className="text-sm font-medium text-slate-600 hover:text-[#0052CC] transition-colors">FAQ</a>
          <Link
            to="/calculator"
            className="text-sm font-semibold text-[#0052CC] hover:text-blue-700 transition-colors"
          >
            Calculator
          </Link>
          <a
            href="mailto:kai@annuityvoice.com"
            className="px-4 py-2 bg-[#0052CC] text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors"
          >
            Request Access
          </a>
        </div>

        {/* Mobile hamburger */}
        <button className="md:hidden text-slate-600 p-1" onClick={() => setMenuOpen(o => !o)}>
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {menuOpen
              ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />}
          </svg>
        </button>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="md:hidden bg-white border-t border-slate-100 px-5 py-4 space-y-3">
          <a href="#scenarios" onClick={() => setMenuOpen(false)} className="block text-sm font-medium text-slate-600">What We Find</a>
          <a href="#how-it-works" onClick={() => setMenuOpen(false)} className="block text-sm font-medium text-slate-600">How it Works</a>
          <a href="#faq" onClick={() => setMenuOpen(false)} className="block text-sm font-medium text-slate-600">FAQ</a>
          <Link to="/calculator" className="block text-sm font-semibold text-[#0052CC]">Calculator →</Link>
          <a href="mailto:kai@annuityvoice.com" className="block px-4 py-2 bg-[#0052CC] text-white text-sm font-semibold rounded-lg text-center">Request Access</a>
        </div>
      )}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------
function Hero() {
  return (
    <section
      className="relative overflow-hidden py-20 md:py-28 px-5"
      style={{ background: 'linear-gradient(135deg, #FFE3E3 0%, #D6DFFF 60%, #e0f0ff 100%)' }}
    >
      {/* Subtle geometric decoration */}
      <div className="absolute top-0 right-0 w-96 h-96 opacity-20 pointer-events-none">
        <svg viewBox="0 0 400 400" fill="none">
          <circle cx="300" cy="100" r="200" stroke="#0052CC" strokeWidth="1" />
          <circle cx="300" cy="100" r="140" stroke="#0052CC" strokeWidth="1" />
          <circle cx="300" cy="100" r="80" stroke="#0052CC" strokeWidth="1" />
        </svg>
      </div>

      <div className="max-w-6xl mx-auto relative">
        <div className="max-w-2xl">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/70 border border-blue-200 text-xs font-semibold text-[#0052CC] mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-[#0052CC] animate-pulse" />
            Built for RIAs · Founded by Actuaries
          </div>

          <h1 className="text-4xl md:text-5xl font-black text-[#0f1f3d] leading-tight tracking-tight mb-5">
            Optimize Your Clients'<br />
            <span className="text-[#0052CC]">Legacy Annuities</span>
          </h1>

          <p className="text-lg text-slate-600 leading-relaxed mb-8 max-w-xl">
            We find the hidden money in your clients' annuities — unused guarantees, missed step-ups,
            and suboptimal elections that cost them thousands every year.
            Fiduciary-grade analysis, delivered as white-label reports for your practice.
          </p>

          <div className="flex flex-col sm:flex-row gap-3">
            <Link
              to="/calculator"
              className="inline-flex items-center justify-center gap-2 px-6 py-3.5 bg-[#0052CC] text-white font-bold rounded-xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-200 hover:shadow-blue-300 hover:-translate-y-0.5"
            >
              <span>Launch Free Calculator</span>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
            <a
              href="mailto:kai@annuityvoice.com"
              className="inline-flex items-center justify-center px-6 py-3.5 bg-white text-[#0f1f3d] font-bold rounded-xl border-2 border-[#0f1f3d]/10 hover:border-[#0052CC] hover:text-[#0052CC] transition-all"
            >
              Request Free Analysis
            </a>
          </div>
          {/* Tertiary CTA — pre-loads Jackson National example */}
          <Link
            to={`/calculator${JACKSON_SHARE_HASH}`}
            className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-[#0052CC] transition-colors mt-1"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            See a live example — Jackson National LifeGuard modeled
          </Link>
        </div>

        {/* Stats floating card */}
        <div className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl">
          {[
            { stat: '100%', label: 'Fee-Only Aligned', sub: 'No client contact, ever' },
            { stat: 'FSA', label: 'Led by a Fellow, SOA', sub: '15+ years institutional experience' },
            { stat: '5', label: 'Optimization Scenarios', sub: 'Systematically checked for every policy' },
          ].map(({ stat, label, sub }) => (
            <div key={label} className="bg-white/80 backdrop-blur rounded-xl p-4 border border-white shadow-sm">
              <div className="text-2xl font-black text-[#0052CC] tabular-nums">{stat}</div>
              <div className="text-sm font-bold text-[#0f1f3d] mt-0.5">{label}</div>
              <div className="text-xs text-slate-500 mt-0.5 leading-tight">{sub}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 5 Optimization Scenarios
// ---------------------------------------------------------------------------
const SCENARIOS = [
  {
    number: '01',
    title: 'Unused VA Withdrawal Benefit',
    description: 'Calculates the optimal "first withdrawal" amount and timing to turn the paid-for benefit into cash flow.',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    number: '02',
    title: 'Missed Step-Up Election',
    description: 'Flags the exact contract anniversary date and provides the form/portal instructions to lock in the higher benefit base.',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
      </svg>
    ),
  },
  {
    number: '03',
    title: 'Excess Withdrawals',
    description: 'Provides a guardrailed withdrawal schedule to preserve 100% of the future income guarantee.',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    ),
  },
  {
    number: '04',
    title: 'Suboptimal Spousal Election',
    description: 'Recommends a specific ownership or beneficiary change to fully protect the spouse\'s lifetime income.',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    number: '05',
    title: '"Flex" Withdrawal Option Decision',
    description: 'Runs a health-adjusted valuation to show which election maximizes expected lifetime value.',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
  },
];

function Scenarios() {
  return (
    <section id="scenarios" className="py-20 px-5 bg-white">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <div className="inline-block px-3 py-1 rounded-full bg-blue-50 text-[#0052CC] text-xs font-bold uppercase tracking-widest mb-3">
            What We Find
          </div>
          <h2 className="text-3xl md:text-4xl font-black text-[#0f1f3d] mb-4">
            Five scenarios that cost clients money
          </h2>
          <p className="text-slate-600 max-w-xl mx-auto text-base leading-relaxed">
            Most legacy annuities have at least one. We run all five checks on every policy —
            systematically, objectively, and without any conflict of interest.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {SCENARIOS.map((s, i) => (
            <div
              key={s.number}
              className={`relative rounded-2xl border p-6 transition-all hover:-translate-y-1 hover:shadow-md ${
                i === 4
                  ? 'md:col-span-2 lg:col-span-1 border-[#0052CC]/30 bg-blue-50/40'
                  : 'border-slate-200 bg-[#F6F5F5]/60 hover:border-blue-200'
              }`}
            >
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-11 h-11 rounded-xl bg-[#0052CC]/10 text-[#0052CC] flex items-center justify-center">
                  {s.icon}
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-bold text-slate-400 mb-1 uppercase tracking-widest">{s.number}</div>
                  <h3 className="text-base font-bold text-[#0f1f3d] mb-2 leading-snug">{s.title}</h3>
                  <p className="text-sm text-slate-600 leading-relaxed">{s.description}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// How it Works
// ---------------------------------------------------------------------------
function HowItWorks() {
  const steps = [
    {
      n: '1',
      title: 'Submit a Policy Statement',
      body: 'Upload a redacted PDF statement. Our proprietary IDP extracts key contract terms automatically — no manual entry.',
    },
    {
      n: '2',
      title: 'Actuarial Analysis Runs',
      body: 'Our FSA-led engine checks all five scenarios using Monte Carlo simulation and mortality-adjusted valuations.',
    },
    {
      n: '3',
      title: 'White-Label Report Delivered',
      body: 'Receive a branded PDF for your client meeting — clear recommendations, no jargon, no conflict of interest.',
    },
  ];

  return (
    <section id="how-it-works" className="py-20 px-5 bg-[#0f1f3d]">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <div className="inline-block px-3 py-1 rounded-full bg-blue-500/20 text-blue-300 text-xs font-bold uppercase tracking-widest mb-3">
            How it Works
          </div>
          <h2 className="text-3xl md:text-4xl font-black text-white mb-4">
            From statement to insight in 24 hours
          </h2>
          <p className="text-slate-400 max-w-xl mx-auto">
            Designed for RIA workflows — no proprietary software to install, no client exposure.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {steps.map((s, i) => (
            <div key={s.n} className="relative">
              {i < steps.length - 1 && (
                <div className="hidden md:block absolute top-8 left-[calc(100%+0px)] w-full h-px bg-blue-500/20 z-10" />
              )}
              <div className="bg-white/5 border border-white/10 rounded-2xl p-6 h-full">
                <div className="w-12 h-12 rounded-xl bg-[#0052CC] text-white font-black text-lg flex items-center justify-center mb-4">
                  {s.n}
                </div>
                <h3 className="text-lg font-bold text-white mb-2">{s.title}</h3>
                <p className="text-sm text-slate-400 leading-relaxed">{s.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Calculator CTA strip
// ---------------------------------------------------------------------------
function CalculatorCTA() {
  return (
    <section className="py-16 px-5 bg-white border-y border-slate-100">
      <div className="max-w-6xl mx-auto">
        <div className="rounded-2xl bg-gradient-to-r from-blue-600 to-blue-500 p-8 md:p-10 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="text-white">
            <h3 className="text-2xl font-black mb-2">Try the Calculator — Free</h3>
            <p className="text-blue-100 text-sm max-w-md leading-relaxed">
              Run a Monte Carlo simulation on any GMWB or GMDB contract. See PV of guarantees vs. fees,
              shortfall probability, and SPIA comparison — no account required.
              Advisors can unlock advanced actuarial-grade analysis with a free sign-up.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 flex-shrink-0">
            <Link
              to="/calculator"
              className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-white text-blue-600 font-bold rounded-xl hover:bg-blue-50 transition-colors shadow-md whitespace-nowrap"
            >
              Launch Calculator
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Trust strip
// ---------------------------------------------------------------------------
function TrustStrip() {
  const items = [
    { icon: '🔒', text: '256-bit encryption — bank-level security' },
    { icon: '📋', text: 'SOC 2 compliant (in progress)' },
    { icon: '🚫', text: 'Non-Solicitation Agreement — we never contact your clients' },
    { icon: '⚖️', text: 'Fee-only aligned — no commissioned products, ever' },
  ];
  return (
    <section className="py-10 px-5 bg-[#F6F5F5]">
      <div className="max-w-6xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-4">
        {items.map(({ icon, text }) => (
          <div key={text} className="flex items-start gap-2.5 text-sm text-slate-700">
            <span className="text-base mt-0.5 flex-shrink-0">{icon}</span>
            <span className="leading-tight">{text}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// FAQ
// ---------------------------------------------------------------------------
const FAQS = [
  {
    q: 'Who is behind this analysis?',
    a: 'Our team is led by a Fellow of the Society of Actuaries (FSA) with over 15 years of institutional experience.',
  },
  {
    q: 'Will you ever contact my client directly?',
    a: 'Never. We are a back-office solution for you. All reports are white-labeled with your logo, and we sign a strict Non-Solicitation Agreement.',
  },
  {
    q: 'Do you sell commissioned products?',
    a: 'No. We are built for the Fee-Only world. If a product needs to be replaced, we recommend Investment-Only Variable Annuities (IOVAs) or fee-based carriers.',
  },
  {
    q: 'How do you get data from paper policies?',
    a: 'We use proprietary Intelligent Document Processing (IDP). You simply upload the PDF statement or policy pages — no manual entry required.',
  },
  {
    q: 'Is this secure?',
    a: 'Yes. Our portal is SOC 2 compliant (in progress) and uses bank-level 256-bit encryption for all documents and data.',
  },
  {
    q: 'What if the analysis shows the current policy is good?',
    a: 'Then we say so. Our "Keep vs. Replace" analysis is rigorous and objective — we have no incentive to recommend a change if one isn\'t warranted.',
  },
  {
    q: 'Who is the calculator for?',
    a: 'The free calculator is available to anyone — advisors and individual annuity holders alike. Advisors can unlock advanced actuarial-grade tools (sensitivity analysis, projection table, dynamic lapse modeling) with a free account.',
  },
];

function FAQ() {
  const [open, setOpen] = useState(null);
  return (
    <section id="faq" className="py-20 px-5 bg-white">
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-12">
          <div className="inline-block px-3 py-1 rounded-full bg-blue-50 text-[#0052CC] text-xs font-bold uppercase tracking-widest mb-3">
            FAQ
          </div>
          <h2 className="text-3xl font-black text-[#0f1f3d]">Common questions</h2>
        </div>

        <div className="space-y-2">
          {FAQS.map((item, i) => (
            <div key={i} className="border border-slate-200 rounded-xl overflow-hidden">
              <button
                onClick={() => setOpen(open === i ? null : i)}
                className="w-full flex items-center justify-between px-5 py-4 text-left bg-white hover:bg-slate-50 transition-colors"
              >
                <span className="text-sm font-semibold text-[#0f1f3d] pr-4">{item.q}</span>
                <svg
                  className={`w-4 h-4 flex-shrink-0 text-slate-400 transition-transform ${open === i ? 'rotate-180' : ''}`}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {open === i && (
                <div className="px-5 pb-4 text-sm text-slate-600 leading-relaxed border-t border-slate-100">
                  <div className="pt-3">{item.a}</div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Free analysis CTA
// ---------------------------------------------------------------------------
function FreeAnalysisCTA() {
  return (
    <section className="py-20 px-5 bg-[#0f1f3d]">
      <div className="max-w-2xl mx-auto text-center">
        <h2 className="text-3xl font-black text-white mb-3">Get a Free Policy Analysis</h2>
        <p className="text-slate-400 mb-8 leading-relaxed">
          Send us one redacted statement you've been avoiding.
          We'll analyze it and show you the hidden opportunity or risk — no cost, no commitment.
        </p>
        <a
          href="mailto:kai@annuityvoice.com?subject=Free Policy Analysis Request"
          className="inline-flex items-center gap-2 px-8 py-4 bg-[#0052CC] text-white font-bold rounded-xl hover:bg-blue-600 transition-all shadow-lg shadow-blue-900/40 hover:-translate-y-0.5"
        >
          Request Free Analysis
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
          </svg>
        </a>
        <p className="mt-4 text-xs text-slate-500">For financial professionals only. Not for use with the general public.</p>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------
function Footer() {
  return (
    <footer className="bg-[#0a1628] py-10 px-5">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 mb-6">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[#0052CC] flex items-center justify-center">
              <span className="text-white font-black text-xs">AV</span>
            </div>
            <span className="text-base font-bold text-white tracking-tight">
              Annuity<span className="text-[#0052CC]">Voice</span>
            </span>
          </div>

          <div className="flex items-center gap-5 text-sm">
            <a href="#faq" className="text-slate-400 hover:text-white transition-colors">FAQ</a>
            <Link to="/calculator" className="text-slate-400 hover:text-white transition-colors">Calculator</Link>
            <a href="mailto:kai@annuityvoice.com" className="text-slate-400 hover:text-white transition-colors">Contact</a>
          </div>
        </div>

        <div className="border-t border-white/10 pt-6 text-xs text-slate-500 leading-relaxed space-y-2">
          <p>
            <strong className="text-slate-400">For Financial Professional Use Only.</strong>{' '}
            Not for use with the general public. AnnuityVoice provides analysis and tools for advisors;
            all investment decisions remain the responsibility of the advisor and client.
          </p>
          <p>
            The calculator and reports are for educational and informational purposes only and do not
            constitute financial, investment, insurance, or actuarial advice. Results are model estimates
            based on Monte Carlo simulation; actual contract values will differ.
          </p>
          <p className="text-slate-600">© {new Date().getFullYear()} AnnuityVoice. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function LandingPage() {
  return (
    <div className="min-h-screen font-sans" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      <Nav />
      <Hero />
      <TrustStrip />
      <Scenarios />
      <HowItWorks />
      <CalculatorCTA />
      <FAQ />
      <FreeAnalysisCTA />
      <Footer />
    </div>
  );
}
