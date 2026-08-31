function digest(value) {
  let hash = 2166136261;
  for (const character of String(value || "")) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function ensureMessageIdentity(messages, prefix = "chat") {
  const seen = new Set();
  return (Array.isArray(messages) ? messages : []).map((message, index) => {
    const copy = message && typeof message === "object"
      ? { ...message }
      : { role: "message", content: String(message || "") };
    const suppliedId = String(copy.id || "").trim();
    const seed = `${prefix}:${index}:${copy.role || "message"}:${copy.content || copy.text || ""}`;
    const id = suppliedId && !seen.has(suppliedId) ? suppliedId : `msg_${digest(seed)}`;
    copy.id = seen.has(id) ? `msg_${digest(`${seed}:${index}`)}` : id;
    seen.add(copy.id);
    if (!copy.createdAt) copy.createdAt = null;
    return copy;
  });
}

const MessageIdentity = { ensureMessageIdentity };

if (typeof globalThis !== "undefined") {
  globalThis.XekuteMessageIdentity = MessageIdentity;
}

export { ensureMessageIdentity };
