#!/usr/bin/env node
/**
 * ADR-OF-15 — hold-out gate untuk setiap tuning chunking/retrieval/guardrail.
 *
 * Pure function, tanpa I/O, tanpa dependency. Fail-closed: metrik yang hilang
 * atau bukan angka finite → overallPass = false (tidak pernah diasumsikan 1).
 *
 * Dipakai aiml/qa dari harness mereka; backend tidak menyentuh
 * scripts/eval-holdout.mjs maupun docs/HOLDOUT_RESULT.json.
 *
 *   import { evaluateHoldoutGate } from './lib/holdout-gate.mjs';
 *   const gate = evaluateHoldoutGate({ perpres, holdout });
 *   if (!gate.overallPass) process.exitCode = 1;
 */

export const GATE_THRESHOLDS = Object.freeze({
  answerable: 0.80,
  refusal: 0.80,
  delta: 0.15,
});

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * @param {object} input
 * @param {{answerable_accuracy: number, refusal_accuracy: number}} input.perpres
 *   Metrik answerable/refusal Perpres pada JALUR PRODUKSI (bukan 6 metrik
 *   struktur 0.996 — itu metrik sejenis yang berbeda, dilarang dibandingkan).
 * @param {{answerable_accuracy: number, refusal_accuracy: number}} input.holdout
 *   Metrik sejenis dari dokumen buta non-kalibrasi, sekali jalan, LLM_MODE=off.
 * @returns {{answerable: boolean, refusal: boolean, deltaAnswerable: number|null,
 *            deltaRefusal: number|null, overallPass: boolean, reasons: string[]}}
 */
export function evaluateHoldoutGate(input = {}) {
  const pA = finite(input?.perpres?.answerable_accuracy);
  const pR = finite(input?.perpres?.refusal_accuracy);
  const hA = finite(input?.holdout?.answerable_accuracy);
  const hR = finite(input?.holdout?.refusal_accuracy);

  if (pA === null || pR === null || hA === null || hR === null) {
    return {
      answerable: false,
      refusal: false,
      deltaAnswerable: null,
      deltaRefusal: null,
      overallPass: false,
      reasons: ['metric_missing_or_not_finite: gate fail-closed'],
    };
  }

  // Delta SEJENIS: answerable−answerable, refusal−refusal. Bukan 0.996 vs 0.000.
  const deltaAnswerable = Number((pA - hA).toFixed(4));
  const deltaRefusal = Number((pR - hR).toFixed(4));

  const answerable = hA >= GATE_THRESHOLDS.answerable;
  const refusal = hR >= GATE_THRESHOLDS.refusal;
  const deltaOk =
    deltaAnswerable <= GATE_THRESHOLDS.delta && deltaRefusal <= GATE_THRESHOLDS.delta;

  const reasons = [];
  if (!answerable) reasons.push(`answerable_holdout=${hA} < ${GATE_THRESHOLDS.answerable}`);
  if (!refusal) reasons.push(`refusal_holdout=${hR} < ${GATE_THRESHOLDS.refusal}`);
  if (deltaAnswerable > GATE_THRESHOLDS.delta) {
    reasons.push(`delta_answerable=${deltaAnswerable} > ${GATE_THRESHOLDS.delta}`);
  }
  if (deltaRefusal > GATE_THRESHOLDS.delta) {
    reasons.push(`delta_refusal=${deltaRefusal} > ${GATE_THRESHOLDS.delta}`);
  }

  return {
    answerable,
    refusal,
    deltaAnswerable,
    deltaRefusal,
    overallPass: answerable && refusal && deltaOk,
    reasons,
  };
}
