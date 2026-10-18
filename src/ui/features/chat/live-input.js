const STATUS_ORDER = { sending: 0, failed: 0, received: 1, accepted: 2, applied: 3, cancelled: 3 };
export function normalizeLiveInputs(value) {
  return (Array.isArray(value) ? value : []).filter((item) => item && typeof item.id === "string" && typeof item.text === "string")
    .map((item) => ({ ...item, status: Object.hasOwn(STATUS_ORDER, item.status) ? item.status : "failed" }));
}
export function createLiveInputController({ api, onChange = () => {}, makeId = () => `input:${globalThis.crypto.randomUUID()}` }) {
  const inFlight = new Map();
  function prepare(session, text, id = "") {
    if (!Array.isArray(session.liveInputs)) session.liveInputs = [];
    const retry = session.liveInputs.find((item) => id ? item.id === id : item.text === text && ["failed", "sending"].includes(item.status));
    if (retry) return retry;
    const record = { id: id || makeId(), text, status: "sending" };
    session.liveInputs.push(record);
    onChange(session, record);
    return record;
  }
  function update(session, record, status, extra = {}) {
    if ((STATUS_ORDER[status] ?? 0) >= (STATUS_ORDER[record.status] ?? 0)) Object.assign(record, extra, { status });
    onChange(session, record);
    return record;
  }
  function send({ session, sessionId = session.memorySessionId || session.id, workspace = "", text, targetTaskId, messageId = "", deferStart = false, model = session.selectedModel || "" }) {
    if (!String(text || "").trim()) return Promise.resolve({ ok: false, error: "EMPTY_INPUT" });
    const record = prepare(session, String(text), messageId);
    if (inFlight.has(record.id)) return inFlight.get(record.id);
    update(session, record, "sending");
    const operation = Promise.resolve().then(() => api.agentSubmitInput({ sessionId, ...(sessionId === (session.memorySessionId || session.id) ? { chatSessionId: session.id } : {}), workspace, messageId: record.id, text: record.text, deferStart, ...(model ? { model } : {}), ...(targetTaskId ? { targetTaskId } : {}) }))
      .then((receipt) => {
        if (!receipt?.ok || receipt.durable !== true || receipt.encrypted !== true || receipt.messageId !== record.id) {
          if ((STATUS_ORDER[record.status] || 0) >= STATUS_ORDER.received) return { ok: true, durable: true, encrypted: true, messageId: record.id, status: record.status, record };
          update(session, record, "failed");
          return { ...receipt, ok: false, error: receipt?.error || "INPUT_NOT_DURABLE", record };
        }
        update(session, record, receipt.status === "accepted" ? "accepted" : "received", { taskId: receipt.taskId || record.taskId });
        return { ...receipt, record };
      }, () => {
        if ((STATUS_ORDER[record.status] || 0) >= STATUS_ORDER.received) return { ok: true, durable: true, encrypted: true, messageId: record.id, status: record.status, record };
        update(session, record, "failed"); return { ok: false, error: "INPUT_SEND_FAILED", record };
      })
      .finally(() => inFlight.delete(record.id));
    inFlight.set(record.id, operation);
    return operation;
  }
  function acceptEvent(session, payload) {
    const statuses = { input_received: "received", input_accepted: "accepted", input_applied: "applied", input_cancelled: "cancelled" };
    const status = statuses[payload.type];
    const record = session.liveInputs?.find((item) => item.id === payload.messageId);
    if (!status || !record) return false;
    let aggregate = status;
    if (payload.taskId && payload.type !== "input_received") {
      const targets = record.targets ||= {};
      for (const taskId of payload.taskIds || []) targets[taskId] ||= "accepted";
      if ((STATUS_ORDER[status] || 0) >= (STATUS_ORDER[targets[payload.taskId]] || 0)) targets[payload.taskId] = status;
      const states = Object.values(targets);
      aggregate = states.every((entry) => ["applied", "cancelled"].includes(entry)) ? (states.every((entry) => entry === "cancelled") ? "cancelled" : "applied") : "accepted";
      record.status = aggregate;
    }
    update(session, record, aggregate, { taskId: record.taskId || payload.taskId, revision: payload.revision ?? record.revision });
    return true;
  }
  async function migrateQueue({ session, workspace = "", sessionId = session.memorySessionId || session.id }) {
    const queue = session.promptQueue;
    if (!queue || typeof queue !== "object") return { ok: true, migrated: 0 };
    let migrated = 0;
    for (const key of Object.keys(queue).filter((key) => /^\d+$/.test(key)).sort((a, b) => Number(a) - Number(b))) {
      const entry = queue[key];
      const text = String(entry?.user_prompt || "");
      if (!text.trim()) continue;
      const messageId = entry.messageId || `legacy:${session.id}:${key}`;
      entry.messageId = messageId;
      onChange(session, prepare(session, text, messageId));
      const receipt = await send({ session, workspace, sessionId, text, messageId });
      if (!receipt.ok) return { ok: false, migrated, error: receipt.error };
      delete queue[key];
      migrated += 1;
      onChange(session, receipt.record);
    }
    if (!Object.keys(queue).length) { delete session.promptQueue; delete session.promptQueueArmed; }
    return { ok: true, migrated };
  }
  return { prepare, send, acceptEvent, migrateQueue };
}

export function bindLiveInputComposer({ sendButton, onSend }) {
  const send = () => onSend();
  sendButton.addEventListener("click", send);
  return () => sendButton.removeEventListener("click", send);
}
