/* A tagged file travels inside the prompt text as a marker the agent reads
 * directly, so drafts, history and live input need no side channel. The
 * composer and the sent prompt render each marker as a chip showing only the
 * file name. The chip's name is generated content and its marker text is
 * invisible, so innerText of the composer is exactly the prompt text. */

const MARKER = /\[(file|chat|terminal): ([^\]\n]+)\]/g;

function promptText(text) {
  return String(text ?? "").split("\n\n<referenced_chat_context>\n")[0];
}

export function chatTagMarker(sessionId, title) {
  return `[chat: ${encodeURIComponent(sessionId)} ${encodeURIComponent(title)}]`;
}

export function terminalTagMarker(terminalId, title, origin) {
  return `[terminal: ${encodeURIComponent(terminalId)} ${encodeURIComponent(title)} ${origin === "agent" ? "agent" : "user"}]`;
}

export const FILE_TAG_LIMIT = 15;

export function fileTagMarker(path) {
  return `[file: ${path}]`;
}

export function fileTagName(path) {
  const clean = String(path || "");
  return clean.split("/").pop() || clean;
}

export function splitFileTags(text) {
  const source = promptText(text);
  const parts = [];
  let last = 0;
  for (const match of source.matchAll(MARKER)) {
    if (match.index > last) parts.push({ text: source.slice(last, match.index) });
    if (match[1] === "file") parts.push({ path: match[2].trim() });
    else if (match[1] === "terminal") {
      const [id, title, origin] = match[2].split(" ");
      try { parts.push({ terminalId: decodeURIComponent(id), title: decodeURIComponent(title || "Terminal"), origin: origin === "agent" ? "agent" : "user" }); }
      catch { parts.push({ text: match[0] }); }
    } else {
      const [id, ...title] = match[2].split(" ");
      try { parts.push({ sessionId: decodeURIComponent(id), title: decodeURIComponent(title.join(" ")) || "Chat" }); }
      catch { parts.push({ text: match[0] }); }
    }
    last = match.index + match[0].length;
  }
  if (last < source.length) parts.push({ text: source.slice(last) });
  return parts;
}

export function fileTagDisplayText(text) {
  return splitFileTags(text).map((part) => part.path ? fileTagName(part.path) : part.sessionId || part.terminalId ? part.title : part.text).join("");
}

// "@" opens a search at the start of the prompt or after whitespace; the query
// runs to the caret and ends at the first whitespace.
export function fileTagQueryAt(textBeforeCaret) {
  const match = /(^|\s)@([^\s@]*)$/.exec(String(textBeforeCaret ?? ""));
  return match ? { query: match[2], start: match.index + match[1].length } : null;
}

export function terminalTagQueryAt(textBeforeCaret) {
  const match = /(^|\s)\$([^\s$]*)$/.exec(String(textBeforeCaret ?? ""));
  return match ? { kind: "terminal", query: match[2], start: match.index + match[1].length } : null;
}

export function topTerminalTagMatches(terminals, query, score, limit = FILE_TAG_LIMIT) {
  if (!query) return terminals.slice(0, limit).map(item => ({ ...item, kind: "terminal" }));
  return terminals.map(item => ({ item, score: Math.max(score(item.name, query), score(item.command || "", query)) })).filter(row => row.score > 0)
    .sort((a, b) => b.score - a.score).slice(0, limit).map(row => ({ ...row.item, kind: "terminal" }));
}

// One pass over the file list keeping only the best `limit` rows, so the
// popup never sorts or renders more than it shows.
export function topFileTagMatches(files, query, score, limit = FILE_TAG_LIMIT) {
  const best = [];
  const ranksAbove = (a, b) => a.score > b.score
    || (a.score === b.score && (a.path.length < b.path.length
      || (a.path.length === b.path.length && a.path < b.path)));
  for (const path of files) {
    const nameScore = score(fileTagName(path), query);
    const value = Math.max(nameScore && nameScore + 40, score(path, query));
    if (value <= 0) continue;
    const row = { path, score: value };
    if (best.length === limit && !ranksAbove(row, best[limit - 1])) continue;
    const at = best.findIndex((other) => ranksAbove(row, other));
    best.splice(at < 0 ? best.length : at, 0, row);
    if (best.length > limit) best.pop();
  }
  return best.map((row) => row.path);
}

export function createFileTagChip(document, path) {
  const chip = document.createElement("span");
  chip.className = "file-tag-chip";
  chip.setAttribute("contenteditable", "false");
  chip.dataset.path = path;
  chip.dataset.label = fileTagName(path);
  chip.title = path;
  const marker = document.createElement("span");
  marker.className = "file-tag-marker";
  marker.textContent = fileTagMarker(path);
  chip.append(marker);
  return chip;
}

export function createChatTagChip(document, sessionId, title) {
  const chip = createFileTagChip(document, "");
  chip.classList.add("chat-tag-chip");
  delete chip.dataset.path;
  chip.dataset.sessionId = sessionId;
  chip.dataset.label = title;
  chip.title = `Chat: ${title}`;
  chip.firstChild.textContent = chatTagMarker(sessionId, title);
  return chip;
}

export function createTerminalTagChip(document, terminalId, title, origin) {
  const chip = createFileTagChip(document, "");
  chip.classList.add("terminal-tag-chip");
  delete chip.dataset.path;
  chip.dataset.terminalId = terminalId;
  chip.dataset.origin = origin === "agent" ? "agent" : "user";
  chip.dataset.label = title;
  chip.title = `Terminal: ${title}`;
  chip.firstChild.textContent = terminalTagMarker(terminalId, title, origin);
  return chip;
}

export function projectChatsForTags(sessions, currentSessionId, projectId = "") {
  return sessions.filter((session) => session.memorySessionId && session.id !== currentSessionId
    && session.memorySessionId !== currentSessionId && (!projectId || session.memoryProjectId === projectId))
    .map((session) => ({ kind: "chat", sessionId: session.memorySessionId, title: session.title || "New Agent", updatedAt: session.updatedAt || session.createdAt || "" }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function topContextTagMatches(files, chats, query, score, limit = FILE_TAG_LIMIT) {
  const fileRows = topFileTagMatches(files, query, score, limit).map((path) => ({ kind: "file", path }));
  if (!query) {
    const recent = chats.slice(0, Math.min(3, limit));
    return [...recent, ...fileRows.slice(0, limit - recent.length)];
  }
  return [...fileRows, ...chats].map((item) => {
    const label = item.kind === "chat" ? item.title : fileTagName(item.path);
    const nameScore = score(label, query);
    return { item, label, score: Math.max(nameScore && nameScore + 40, item.kind === "file" ? score(item.path, query) : 0) };
  }).filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
    .slice(0, limit).map((row) => row.item);
}

export function appendFileTagText(target, text) {
  const document = target.ownerDocument;
  for (const part of splitFileTags(text)) {
    target.append(part.path ? createFileTagChip(document, part.path) : part.sessionId ? createChatTagChip(document, part.sessionId, part.title)
      : part.terminalId ? createTerminalTagChip(document, part.terminalId, part.title, part.origin) : document.createTextNode(part.text));
  }
}
