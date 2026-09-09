"use strict";

function sameTerminalOwner(record, sender) {
  return Boolean(record && sender && String(record.ownerId) === String(sender.id));
}

function findLiveTerminal(terminals, id) {
  const requested = String(id || "");
  if (!requested || !terminals) return { terminalId: requested, record: null };
  if (terminals.has(id)) return { terminalId: id, record: terminals.get(id) };
  if (id !== requested && terminals.has(requested)) return { terminalId: requested, record: terminals.get(requested) };
  for (const [terminalId, record] of terminals.entries()) {
    if (String(record?.processId || "") === requested) return { terminalId, record };
  }
  return { terminalId: requested, record: null };
}

module.exports = { sameTerminalOwner, findLiveTerminal };
