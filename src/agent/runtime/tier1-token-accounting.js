"use strict";

/*
 * Tier 1 has two different token-accounting inputs:
 *
 * 1. a local, section-aware estimate available before a model call; and
 * 2. one provider-measured prompt total returned after the call.
 *
 * Providers do not return per-section usage. Reconcile the local section
 * weights to the measured total with a deterministic largest-remainder pass
 * so the nine rows remain useful and always add up to the displayed total.
 */

const MIN_CALIBRATION = 0.25;
const MAX_CALIBRATION = 4;
const CALIBRATION_WEIGHT = 0.35;
const MAX_CALIBRATIONS = 128;
const DEFAULT_SECTION_KEY = "active_conversation";
const calibrations = new Map();

function wholeTokens(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : 0;
}

function positiveMeasuredTokens(value) {
  const number = Number(value);
  // A Xekute agent prompt is never empty. Treat a provider-reported zero as
  // unavailable (for example, a fully cached OpenRouter response) rather than
  // erasing the context meter with a false authoritative value.
  return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
}

function calibrationKey(provider, model) {
  return `${String(provider || "unknown").trim().toLowerCase()}:${String(model || "").trim().toLowerCase()}`;
}

function boundedRatio(value) {
  return Math.max(MIN_CALIBRATION, Math.min(MAX_CALIBRATION, Number(value) || 1));
}

function rememberCalibration({ provider, model, estimatedTokens, measuredTokens } = {}) {
  const estimated = positiveMeasuredTokens(estimatedTokens);
  const measured = positiveMeasuredTokens(measuredTokens);
  if (!estimated || !measured) return null;

  const key = calibrationKey(provider, model);
  const observed = boundedRatio(measured / estimated);
  const previous = calibrations.get(key);
  const factor = previous
    ? boundedRatio((previous.factor * (1 - CALIBRATION_WEIGHT)) + (observed * CALIBRATION_WEIGHT))
    : observed;
  const next = {
    factor,
    samples: Math.min((previous?.samples || 0) + 1, Number.MAX_SAFE_INTEGER),
    lastObserved: observed,
  };
  // Refresh insertion order so the map is a small process-local LRU.
  calibrations.delete(key);
  calibrations.set(key, next);
  while (calibrations.size > MAX_CALIBRATIONS) calibrations.delete(calibrations.keys().next().value);
  return { ...next };
}

function calibrationFor(provider, model) {
  const key = calibrationKey(provider, model);
  const value = calibrations.get(key);
  if (!value) return { factor: 1, samples: 0, lastObserved: null };
  calibrations.delete(key);
  calibrations.set(key, value);
  return { ...value };
}

function calibratedPromptTokens(estimatedTokens, { provider, model } = {}) {
  const local = wholeTokens(estimatedTokens);
  if (!local) return 0;
  const calibration = calibrationFor(provider, model);
  return Math.max(1, Math.round(local * calibration.factor));
}

function reconcileSections(sections = [], targetTokens = 0) {
  const normalized = (Array.isArray(sections) ? sections : []).map((section, index) => ({
    ...section,
    tokens: wholeTokens(section?.tokens),
    localTokens: wholeTokens(section?.localTokens ?? section?.tokens),
    __index: index,
  }));
  const target = wholeTokens(targetTokens);
  if (!normalized.length) return normalized;
  if (!target) return normalized.map(({ __index, ...section }) => ({ ...section, tokens: 0 }));

  const localTotal = normalized.reduce((sum, section) => sum + section.tokens, 0);
  if (!localTotal) {
    const fallbackIndex = Math.max(0, normalized.findIndex((section) => section.key === DEFAULT_SECTION_KEY));
    return normalized.map(({ __index, ...section }, index) => ({
      ...section,
      tokens: index === fallbackIndex ? target : 0,
    }));
  }

  const allocated = normalized.map((section) => {
    const exact = (section.tokens * target) / localTotal;
    const floor = Math.floor(exact);
    return { ...section, tokens: floor, __fraction: exact - floor };
  });
  let remaining = target - allocated.reduce((sum, section) => sum + section.tokens, 0);
  const order = [...allocated].sort((left, right) => right.__fraction - left.__fraction || left.__index - right.__index);
  for (let index = 0; remaining > 0; index += 1, remaining -= 1) {
    order[index % order.length].tokens += 1;
  }

  return allocated
    .sort((left, right) => left.__index - right.__index)
    .map(({ __index, __fraction, ...section }) => section);
}

function reconcileUsage(usage = {}, targetTokens, { source = null, measuredAt = null } = {}) {
  const target = wholeTokens(targetTokens);
  const sections = reconcileSections(usage.sections, target);
  return {
    ...usage,
    ...(source ? { source } : {}),
    promptTokens: target,
    sections,
    tokenCalculation: {
      ...(usage.tokenCalculation || {}),
      method: source && source !== "estimate" ? "provider-reconciled" : "local-calibrated",
      localPromptTokens: wholeTokens(usage.localPromptTokens ?? usage.estimatedTokens ?? usage.promptTokens),
      sectionLocalTotal: sections.reduce((sum, section) => sum + wholeTokens(section.localTokens), 0),
      sectionReconciledTotal: sections.reduce((sum, section) => sum + wholeTokens(section.tokens), 0),
    },
    ...(measuredAt ? { measuredAt } : {}),
  };
}

function resetCalibrationsForTest() {
  calibrations.clear();
}

module.exports = Object.freeze({
  calibratedPromptTokens,
  calibrationFor,
  positiveMeasuredTokens,
  reconcileSections,
  reconcileUsage,
  rememberCalibration,
  resetCalibrationsForTest,
});
