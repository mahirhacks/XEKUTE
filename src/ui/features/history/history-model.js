/* Pure history projection helpers. DOM rendering stays in the renderer
 * composition root; filtering, ordering, and pagination live with history. */

export const RECENT_HISTORY_LIMIT = 20;

export function hasPersistedConversation(session) {
  const history = Array.isArray(session?.history) ? session.history : [];
  return Boolean(session?.memorySessionId || history.length || session?.messagesHtml || session?.transcript?.runs?.length);
}

export function matchesHistoryQuery(session, query = "") {
  const normalizedQuery = String(query || "").trim().toLocaleLowerCase();
  if (!normalizedQuery) return true;
  const firstPrompt = Array.isArray(session?.history)
    ? session.history.find((message) => message?.role === "user")?.content
    : "";
  return [session?.title, firstPrompt]
    .some((value) => String(value || "").toLocaleLowerCase().includes(normalizedQuery));
}

export function sortHistorySessions(sessions = [], query = "") {
  return (Array.isArray(sessions) ? sessions : [])
    .filter(hasPersistedConversation)
    .filter((session) => matchesHistoryQuery(session, query))
    .sort((left, right) => {
      const leftTime = Date.parse(left.updatedAt || left.createdAt || "") || 0;
      const rightTime = Date.parse(right.updatedAt || right.createdAt || "") || 0;
      return rightTime - leftTime;
    });
}

function historyDayStart(time) {
  const day = new Date(time);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

// Today is the local calendar day. Previous 7 days is the seven days before
// that, not including today. Anything older stays in its own group so it is
// not hidden.
export function groupHistoryByAge(sessions = [], now = new Date()) {
  const startToday = historyDayStart(now);
  const startPrevious = startToday - 7 * 24 * 60 * 60 * 1000;
  const groups = { today: [], previous: [], older: [] };
  for (const session of Array.isArray(sessions) ? sessions : []) {
    const time = Date.parse(session?.updatedAt || session?.createdAt || "") || 0;
    if (time >= startToday) groups.today.push(session);
    else if (time >= startPrevious) groups.previous.push(session);
    else groups.older.push(session);
  }
  return [
    { id: "today", label: "Today", sessions: groups.today },
    { id: "previous", label: "Previous 7 days", sessions: groups.previous },
    { id: "older", label: "Older", sessions: groups.older },
  ].filter((group) => group.sessions.length);
}

export function paginateRecentHistory(sessions = [], { showAll = false, limit = RECENT_HISTORY_LIMIT } = {}) {
  const recent = Array.isArray(sessions) ? sessions : [];
  const safeLimit = Math.max(1, Number(limit) || RECENT_HISTORY_LIMIT);
  const visible = showAll ? recent : recent.slice(0, safeLimit);
  return {
    visible,
    remaining: Math.max(0, recent.length - safeLimit),
  };
}

export function fitHistoryTitle(title) {
  if (!title) return;
  const fullTitle = String(title.dataset.fullTitle || title.textContent || "").trim();
  if (!fullTitle || !title.clientWidth) return;
  title.textContent = fullTitle;
  if (title.scrollWidth <= title.clientWidth) return;

  // Fit whole words only. If adding the next word overflows, keep the prior
  // word and add the ellipsis without cutting a word in half.
  const words = fullTitle.split(/\s+/).filter(Boolean);
  let fitted = "";
  for (const word of words) {
    const candidate = fitted ? `${fitted} ${word}` : word;
    title.textContent = `${candidate}...`;
    if (title.scrollWidth > title.clientWidth) break;
    fitted = candidate;
  }
  title.textContent = fitted ? `${fitted}...` : "...";
}
