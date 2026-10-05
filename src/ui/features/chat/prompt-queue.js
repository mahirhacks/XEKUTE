/* Temporary in-memory prompt queue. Keys stay 1-based so the top row is always "1". */

export function promptQueueEntries(queue) {
  const source = queue && typeof queue === "object" ? queue : {};
  return Object.keys(source)
    .map((key) => Number(key))
    .filter((index) => Number.isInteger(index) && index >= 1 && source[index] && typeof source[index] === "object")
    .sort((a, b) => a - b)
    .map((index) => ({
      index,
      user_prompt: String(source[index].user_prompt || ""),
    }));
}

function renumber(entries) {
  const next = {};
  entries.forEach((entry, offset) => {
    next[offset + 1] = { user_prompt: String(entry.user_prompt || "") };
  });
  return next;
}

export function enqueuePrompt(queue, text) {
  return renumber([...promptQueueEntries(queue), { user_prompt: String(text || "") }]);
}

export function updatePromptAt(queue, index, text) {
  const entries = promptQueueEntries(queue);
  const slot = entries.find((entry) => entry.index === Number(index));
  if (!slot) return renumber(entries);
  slot.user_prompt = String(text || "");
  return renumber(entries);
}

export function removePromptAt(queue, index) {
  return renumber(promptQueueEntries(queue).filter((entry) => entry.index !== Number(index)));
}

export function movePrompt(queue, fromIndex, toIndex) {
  const entries = promptQueueEntries(queue);
  const from = entries.findIndex((entry) => entry.index === Number(fromIndex));
  const to = entries.findIndex((entry) => entry.index === Number(toIndex));
  if (from < 0 || to < 0 || from === to) return renumber(entries);
  const [item] = entries.splice(from, 1);
  entries.splice(to, 0, item);
  return renumber(entries);
}

export function shiftPromptQueue(queue) {
  const entries = promptQueueEntries(queue);
  if (!entries.length) return { prompt: "", queue: {} };
  const [first, ...rest] = entries;
  return { prompt: first.user_prompt, queue: renumber(rest) };
}
