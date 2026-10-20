import { ContextBudget } from "./runtime-globals.js";

export function formatTokenCount(n) {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (n >= 1000) {
    return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  }
  return String(n);
}

export function formatContextWindowLabel(tokens) {
  return ContextBudget?.formatContextWindowLabel(tokens) || formatTokenCount(tokens);
}

export function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Formats an ISO timestamp as a compact relative label:
//   <1m → "1m ago", then "30m ago", "23h 2m ago"
//   ≥24h → "1d ago"/"2d ago"
//   ≥7d → "1w ago"/"2w ago" (weeks, no months)
//   ≥1yr → "1yr ago"/"2yr ago" (final tier)
export function formatRelativeMessageTime(iso) {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffMs = Math.max(0, Date.now() - then);

  const minuteMs = 60000;
  const hourMs = 3600000;
  const dayMs = 86400000;
  const weekMs = 7 * dayMs;
  const yearMs = 52 * weekMs;

  if (diffMs < hourMs) {
    return `${Math.max(1, Math.floor(diffMs / minuteMs))}m ago`;
  }
  if (diffMs < dayMs) {
    const h = Math.floor(diffMs / hourMs);
    const m = Math.floor((diffMs % hourMs) / minuteMs);
    return m > 0 ? `${h}h ${m}m ago` : `${h}h ago`;
  }
  if (diffMs < weekMs) return `${Math.floor(diffMs / dayMs)}d ago`;
  if (diffMs < yearMs) return `${Math.floor(diffMs / weekMs)}w ago`;
  return `${Math.floor(diffMs / yearMs)}yr ago`;
}

export function compactText(text = "", max = 48) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (!value) return "";
  return value.length > max ? `${value.slice(0, Math.max(1, max - 1))}\u2026` : value;
}

export function formatAgentWorkDuration(startedAt, endedAt = Date.now()) {
  const totalSeconds = Math.max(0, Math.round((endedAt - startedAt) / 1000));
  if (totalSeconds < 1) return "a moment";
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

export function formatWaitClock(ms) {
  const totalSeconds = Math.max(0, Math.floor(Number(ms) / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

export function formatCommandWaitClock(ms) {
  const totalSeconds = Math.max(0, Math.floor(Number(ms) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}h ${minutes}m ${seconds}s`;
}
