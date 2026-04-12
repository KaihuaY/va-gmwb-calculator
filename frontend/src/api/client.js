/**
 * API client for the VA GMWB Calculator backend.
 *
 * In development, Vite proxies /api → http://localhost:8000 (see vite.config.js).
 * In production, set VITE_API_URL to the Lambda Function URL.
 */

import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL
  ? import.meta.env.VITE_API_URL
  : '/api';

const client = axios.create({
  baseURL: BASE_URL,
  timeout: 60_000,
  headers: { 'Content-Type': 'application/json' },
});

/**
 * Run the Monte Carlo simulation.
 * @param {Object} params - SimulateRequest fields (see backend/main.py)
 * @returns {Promise<Object>} SimulationResult
 */
export async function simulate(params) {
  const { data } = await client.post('/simulate', params);
  return data;
}

/**
 * Run sensitivity analysis (tornado chart data).
 * @param {Object} base - SimulateRequest fields
 * @param {number} shiftPct - relative shift, e.g. 0.10 for ±10%
 * @param {string[]|null} fields - which parameter fields to stress-test; null = all
 * @returns {Promise<Object>} { base_net_cost, sensitivities[] }
 */
export async function sensitivity(base, shiftPct = 0.10, fields = null) {
  const body = { base, shift_pct: shiftPct };
  if (fields !== null) body.fields = fields;
  const { data } = await client.post('/sensitivity', body);
  return data;
}

/**
 * Find the optimal GMWB election age by sweeping across possible start ages.
 * @param {Object} params - SimulateRequest fields
 * @returns {Promise<Object>} { sweep, optimal_age, optimal_pv_gmwb, optimal_annual_gaw, current_election_age, current_pv_gmwb }
 */
export async function optimalElectionAge(params) {
  const { data } = await client.post('/optimal_election_age', { base: params });
  return data;
}

/**
 * Fire-and-forget: persist a simulation session for research/analytics.
 * Silently swallows errors so a record failure never breaks the UI.
 * @param {Object} payload - { email, role, mode, params, results, extra }
 */
export async function recordSession(payload) {
  try {
    await client.post('/record', payload);
  } catch (_) {
    // non-critical — never surface to user
  }
}

/**
 * Send a 6-digit OTP to the supplied email address.
 * In dev (no SMTP/SES configured) the code is printed to the server console.
 * @param {string} email
 * @returns {Promise<{ sent: boolean }>}
 */
export async function sendOtp(email) {
  const { data } = await client.post('/auth/send-otp', { email });
  return data;
}

/**
 * Verify the 6-digit OTP.
 * @param {string} email
 * @param {string} code  - exactly 6 digits
 * @returns {Promise<{ verified: boolean, email: string }>}
 */
export async function verifyOtp(email, code) {
  const { data } = await client.post('/auth/verify-otp', { email, code });
  return data;
}
