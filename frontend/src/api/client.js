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
 * @returns {Promise<Object>} { base_net_cost, sensitivities[] }
 */
export async function sensitivity(base, shiftPct = 0.10) {
  const { data } = await client.post('/sensitivity', { base, shift_pct: shiftPct });
  return data;
}
