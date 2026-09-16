/* The "Worked for" section is a real container, not a label sitting beside flat
 * rows. Collapsing hides one element, so nothing inside can escape it with its
 * own display rule, at any depth. A finished turn keeps exactly one child
 * outside the fold: the reply that closed the run. */

const WORK_NODE_CLASSES = [
  "agent-thinking-fold",
  "agent-explored-fold",
  "agent-file-stack",
  "agent-file-row",
  "agent-command-event",
  "subagent-run-card",
  "tool-card",
];

const WORK_NODE_SELECTOR = ".agent-thinking-fold, .agent-explored-fold, .agent-file-stack,"
  + " .agent-file-row, .agent-command-event, .subagent-run-card, .tool-card:not([hidden])";

const FOLD_CARET_SRC = "assets/icons/chat_fold_caret.svg";

function children(node) {
  return node ? [...node.children] : [];
}

export function isWorkNode(node) {
  return Boolean(node?.classList) && WORK_NODE_CLASSES.some((name) => node.classList.contains(name));
}

export function isReplyNode(node) {
  return Boolean(node?.classList?.contains("assistant-reply"));
}

export function isEmptyReply(node) {
  return Boolean(isReplyNode(node) && (node.hidden || !String(node.textContent || "").trim()));
}

export function hasWorkNode(root) {
  return Boolean(root?.querySelector?.(WORK_NODE_SELECTOR));
}

export function isWorkFold(node) {
  return Boolean(node?.classList?.contains("agent-work-fold"));
}

export function turnWorkFold(turn) {
  return children(turn).find(isWorkFold) || null;
}

export function workFoldHeader(fold) {
  return children(fold).find((child) => child.classList.contains("agent-work-header")) || null;
}

export function workFoldBody(fold) {
  return children(fold).find((child) => child.classList.contains("agent-work-fold-body")) || null;
}

export function workHeaderLabel(header) {
  return String(header?.querySelector?.(".agent-status-text")?.textContent || "").trim();
}

export function isFoldableWorkLabel(text = "") {
  return /^(Working for|Worked for|Finished in|Stopped)\b/i.test(String(text || "").trim());
}

export function isFinishedWorkFold(node) {
  const header = isWorkFold(node) ? workFoldHeader(node) : node;
  if (!header) return false;
  if (header.dataset?.final === "true") return true;
  return /^(Worked for|Finished in|Stopped)\b/i.test(workHeaderLabel(header));
}

function createFoldCaret() {
  const caret = document.createElement("img");
  caret.className = "agent-work-caret";
  caret.src = FOLD_CARET_SRC;
  caret.alt = "";
  caret.setAttribute("aria-hidden", "true");
  return caret;
}

export function syncWorkHeaderAffordance(header) {
  if (!header?.classList) return header;
  const foldable = isFoldableWorkLabel(workHeaderLabel(header));
  header.classList.toggle("is-foldable", foldable);
  header.dataset.foldable = String(foldable);
  const caret = header.querySelector(".agent-work-caret");
  if (!foldable) {
    caret?.remove();
    header.removeAttribute("aria-expanded");
    header.tabIndex = -1;
    return header;
  }
  // The caret trails the label, so re-append rather than leaving it wherever a
  // restored snapshot happened to put it.
  if (caret) header.appendChild(caret);
  else header.appendChild(createFoldCaret());
  const fold = header.parentElement;
  header.setAttribute("aria-expanded", String(!isWorkFold(fold) || fold.dataset.expanded !== "false"));
  header.removeAttribute("tabindex");
  return header;
}

function createWorkHeader({
  label = "Working for a moment",
  startedAt = 0,
  final = false,
  state = "",
} = {}) {
  const header = document.createElement("button");
  header.type = "button";
  header.className = "agent-work-header agent-status-line";
  header.dataset.lane = "chrome";
  if (startedAt) header.dataset.startedAt = String(startedAt);
  if (final) header.dataset.final = "true";
  if (state) header.dataset.state = state;
  const text = document.createElement("span");
  text.className = "agent-status-text";
  text.textContent = label;
  header.appendChild(text);
  return syncWorkHeaderAffordance(header);
}

// Snapshots from the flat layout stored the label as a status line beside the
// rows. Reuse it so a restored run keeps its recorded duration and state.
function adoptLegacyHeader(node) {
  const header = createWorkHeader({ label: workHeaderLabel(node) || "Worked for a moment" });
  for (const attr of [...node.attributes]) {
    if (attr.name === "class" || attr.name === "role" || attr.name === "type") continue;
    header.setAttribute(attr.name, attr.value);
  }
  node.remove();
  return syncWorkHeaderAffordance(header);
}

export function setWorkFoldExpanded(fold, expanded) {
  if (!isWorkFold(fold)) return fold;
  fold.dataset.expanded = String(Boolean(expanded));
  syncWorkHeaderAffordance(workFoldHeader(fold));
  return fold;
}

export function toggleWorkFold(fold) {
  return setWorkFoldExpanded(fold, fold?.dataset?.expanded === "false");
}

export function createWorkFold({
  label,
  startedAt = 0,
  final = false,
  state = "",
  expanded = true,
  header = null,
} = {}) {
  const fold = document.createElement("div");
  fold.className = "agent-work-fold";
  const toggle = header
    ? adoptLegacyHeader(header)
    : createWorkHeader({ label, startedAt, final, state });
  const body = document.createElement("div");
  body.className = "agent-work-fold-body";
  fold.append(toggle, body);
  return setWorkFoldExpanded(fold, expanded);
}

// Everything the run did belongs in the body. The footer, checkpoint notices,
// and an already promoted answer stay on the turn.
function adoptIntoWorkFold(turn, fold) {
  const body = workFoldBody(fold);
  if (!body) return fold;
  for (const child of children(turn)) {
    if (child === fold) continue;
    if (child.classList.contains("assistant-reply-footer")) continue;
    if (child.classList.contains("context-checkpoint-notice")) continue;
    if (child.classList.contains("agent-work-header") || child.classList.contains("agent-status-line")) {
      child.remove();
      continue;
    }
    // The closing answer already sits beside the fold. Pulling it back in would
    // hide it the next time a tool call recreates the section.
    if (isReplyNode(child) && child.dataset.workVerdict === "true") continue;
    if (isWorkNode(child) || isReplyNode(child)) body.appendChild(child);
  }
  return fold;
}

export function ensureTurnWorkFold(turn, { startedAt = 0, label } = {}) {
  if (!turn) return null;
  let fold = turnWorkFold(turn);
  if (!fold) {
    const legacy = children(turn).find((child) => (
      child.classList.contains("agent-work-header") || child.classList.contains("agent-status-line")
    )) || null;
    fold = createWorkFold({ startedAt, label, header: legacy });
    turn.insertBefore(fold, turn.firstChild);
  }
  // Sanitized snapshots drop non-final status lines, which can leave a fold
  // with no toggle. Without a header there is no way to expand it again.
  let header = workFoldHeader(fold);
  if (!header) {
    header = createWorkHeader({ label, startedAt, final: true });
    fold.insertBefore(header, fold.firstChild);
    setWorkFoldExpanded(fold, fold.dataset.expanded !== "false");
  }
  if (startedAt && !header.dataset.startedAt) header.dataset.startedAt = String(startedAt);
  return adoptIntoWorkFold(turn, fold);
}

// The reply that closed the run is the only thing left visible once the fold
// collapses. Idempotent: with an answer already on the turn, nothing further is
// pulled out of the body.
export function promoteFinalAnswer(turn) {
  const fold = turnWorkFold(turn);
  const body = workFoldBody(fold);
  if (!body) return null;
  const promoted = children(turn).find((child) => isReplyNode(child) && !isEmptyReply(child));
  if (promoted) return promoted;
  const answer = children(body).findLast((child) => isReplyNode(child) && !isEmptyReply(child));
  if (!answer) return null;
  fold.after(answer);
  return answer;
}

// A run that only produced text has nothing to fold. Return its replies to the
// turn so they are never hidden behind an affordance that is not there.
export function unwrapWorkFold(fold) {
  const parent = fold?.parentElement;
  if (!parent) {
    fold?.remove();
    return null;
  }
  const body = workFoldBody(fold);
  while (body?.firstChild) parent.insertBefore(body.firstChild, fold);
  fold.remove();
  return parent;
}
