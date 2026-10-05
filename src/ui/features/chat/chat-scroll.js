export function createChatScroller(messages, { onScroll = () => {} } = {}) {
  const view = messages.ownerDocument.defaultView;
  const threshold = 48;
  let following = true;
  let frame = 0;
  let lastTop = messages.scrollTop;
  let targetTop = null;

  function remaining() {
    return Math.max(0, messages.scrollHeight - messages.clientHeight - messages.scrollTop);
  }

  function pause() {
    following = false;
    targetTop = null;
  }

  function follow({ force = false } = {}) {
    if (force) following = true;
    if (!following || frame) return;
    frame = view.requestAnimationFrame(() => {
      frame = 0;
      if (!following) return;
      targetTop = Math.max(0, messages.scrollHeight - messages.clientHeight);
      messages.scrollTo({ top: targetTop, behavior: "auto" });
      lastTop = messages.scrollTop;
      onScroll();
    });
  }

  function handleScroll() {
    const top = messages.scrollTop;
    if (targetTop !== null && Math.abs(top - targetTop) <= 1) {
      targetTop = null;
    } else if (top < lastTop - 1) {
      pause();
    } else if (top > lastTop && remaining() <= threshold) {
      following = true;
    }
    lastTop = top;
    onScroll();
  }

  function handleWheel(event) {
    if (event.deltaY < 0) pause();
  }

  function handleKey(event) {
    if (["ArrowUp", "PageUp", "Home"].includes(event.key)) pause();
  }

  function handleFold(event) {
    if (event.target.closest(".agent-work-header, .agent-thinking-toggle, .agent-file-stack-toggle, .agent-explored-toggle, .agent-command-summary")) pause();
  }

  function handleSelection() {
    const selection = view.getSelection();
    if (selection && !selection.isCollapsed && messages.contains(selection.anchorNode)) pause();
  }

  const contentChanged = () => {
    follow();
    onScroll();
  };
  messages.addEventListener("wheel", handleWheel, { passive: true });
  messages.addEventListener("keydown", handleKey);
  messages.addEventListener("click", handleFold, true);
  messages.ownerDocument.addEventListener("selectionchange", handleSelection);
  messages.addEventListener("scroll", handleScroll, { passive: true });
  messages.addEventListener("markdown-rendered", contentChanged);
  messages.addEventListener("load", contentChanged, true);
  const mutation = new view.MutationObserver(contentChanged);
  mutation.observe(messages, {
    subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ["hidden", "data-expanded", "open"],
  });
  const resize = view.ResizeObserver ? new view.ResizeObserver(contentChanged) : null;
  resize?.observe(messages);
  return {
    follow,
    pause,
    get following() { return following; },
    destroy() {
      if (frame) view.cancelAnimationFrame(frame);
      mutation.disconnect();
      resize?.disconnect();
      messages.removeEventListener("wheel", handleWheel);
      messages.removeEventListener("keydown", handleKey);
      messages.removeEventListener("click", handleFold, true);
      messages.ownerDocument.removeEventListener("selectionchange", handleSelection);
      messages.removeEventListener("scroll", handleScroll);
      messages.removeEventListener("markdown-rendered", contentChanged);
      messages.removeEventListener("load", contentChanged, true);
    },
  };
}
