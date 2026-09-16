/* Mint the durable chat session id on first send, not on empty tab create.
 * Matches V3 `session_*` identity so later process ownership can share it. */

const SESSION_ID_PATTERN = /^session_[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/;

function fallbackEntropy() {
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
}

export function isChatMemorySessionId(value) {
  return SESSION_ID_PATTERN.test(String(value || ""));
}

export function mintChatMemorySessionId(createId = () => globalThis.crypto?.randomUUID?.() || fallbackEntropy()) {
  const token = String(createId() || "").trim() || fallbackEntropy();
  return `session_${token}`;
}

export function ensureChatMemorySessionId(session, createId) {
  if (!session || typeof session !== "object") return "";
  const current = String(session.memorySessionId || "").trim();
  if (current) return current;
  session.memorySessionId = mintChatMemorySessionId(createId);
  return session.memorySessionId;
}
