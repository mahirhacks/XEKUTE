"use strict";
const crypto = require("node:crypto");

function progressFingerprint(signature, outcome) {
  const stable = (value) => {
    if (Array.isArray(value)) return value.map(stable);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.keys(value).sort().filter((key) => !/^(sampled|observed|measured|updated|created|started|completed)_?at$|^timestamp$|^(elapsed|duration|latency)/i.test(key)).map((key) => [key, stable(value[key])]));
  };
  return crypto.createHash("sha256").update(`${signature}|${JSON.stringify(stable(outcome))}`).digest("hex");
}

function createRoundAccounting({ snapshot = {}, limits = {}, onChange = () => {} } = {}) {
  const counterNames = ["operationalRounds", "providerAttempts", "outputSegments", "protocolRepairs", "noProgressRounds", "consecutiveOutputSegments", "consecutiveProtocolRepairs"];
  const state = Object.fromEntries(counterNames.map((key) => [key, Number.isSafeInteger(snapshot[key]) && snapshot[key] >= 0 ? snapshot[key] : 0]));
  state.progressFingerprints = (Array.isArray(snapshot.progressFingerprints) ? snapshot.progressFingerprints : []).filter((item) => typeof item === "string" && /^[a-f0-9]{64}$/.test(item)).slice(-128);
  const bounds = {
    outputSegments: Number.isSafeInteger(limits.outputSegments) && limits.outputSegments > 0 ? limits.outputSegments : 64,
    protocolRepairs: Number.isSafeInteger(limits.protocolRepairs) && limits.protocolRepairs > 0 ? limits.protocolRepairs : 3,
    noProgressRounds: Number.isSafeInteger(limits.noProgressRounds) && limits.noProgressRounds > 0 ? limits.noProgressRounds : 12,
  };
  const copy = () => ({ ...state, progressFingerprints: [...state.progressFingerprints] });
  const publish = () => onChange(copy());
  publish();
  return {
    snapshot: copy,
    attempt() { state.providerAttempts += 1; publish(); },
    outputSegment() { state.outputSegments += 1; state.consecutiveOutputSegments += 1; publish(); },
    operationalRound() {
      state.operationalRounds += 1;
      state.noProgressRounds += 1;
      state.consecutiveOutputSegments = 0;
      publish();
    },
    protocolRepair() { state.protocolRepairs += 1; state.consecutiveProtocolRepairs += 1; publish(); },
    protocolAccepted() { state.consecutiveProtocolRepairs = 0; publish(); },
    progress() { state.noProgressRounds = 0; publish(); },
    observation(signature, outcome) {
      const fingerprint = progressFingerprint(signature, outcome);
      if (state.progressFingerprints.includes(fingerprint)) return false;
      state.progressFingerprints.push(fingerprint);
      if (state.progressFingerprints.length > 128) state.progressFingerprints.shift();
      state.noProgressRounds = 0;
      publish();
      return true;
    },
    exhaustion() {
      if (state.consecutiveOutputSegments >= bounds.outputSegments) return "OUTPUT_CONTINUATION_LIMIT";
      if (state.consecutiveProtocolRepairs >= bounds.protocolRepairs) return "MODEL_PROTOCOL_REPAIR_LIMIT";
      if (state.noProgressRounds >= bounds.noProgressRounds) return "AGENT_NO_PROGRESS";
      return null;
    },
  };
}

function waitForRetry(delayMs, signal) {
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const done = (value) => { clearTimeout(timer); signal?.removeEventListener("abort", abort); resolve(value); };
    const abort = () => done(false);
    const timer = setTimeout(() => done(true), Math.max(0, delayMs));
    signal?.addEventListener("abort", abort, { once: true });
  });
}

module.exports = { createRoundAccounting, waitForRetry };
