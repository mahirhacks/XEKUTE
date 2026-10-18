/**
 * Fits the side panels around the editor for the current CSS viewport.
 *
 * Window resizing and Ctrl +/- (native page zoom) both change the viewport, so
 * one rule covers both. Panel preferences are never rewritten here: a small
 * window or a high zoom level only narrows what is rendered, and the chosen
 * widths come back when there is room again.
 */

export function panelMinimums(viewportWidth) {
  if (viewportWidth <= 720) return { editor: 200, sidebar: 120, chat: 220 };
  if (viewportWidth <= 900) return { editor: Math.round(viewportWidth * 0.36), sidebar: 140, chat: 240 };
  return {
    editor: Math.min(360, Math.round(viewportWidth * 0.38)),
    sidebar: 160,
    chat: Math.min(300, Math.round(viewportWidth * 0.32)),
  };
}

/**
 * @param {object} input
 * @param {number} input.available  width shared by sidebar, editor and chat
 * @param {number} input.viewportWidth
 * @param {number} input.sidebar    preferred sidebar width, 0 when hidden
 * @param {number} input.chat       preferred chat width, 0 when hidden
 * @param {"sidebar"|"chat"|null} [input.keep]  panel being dragged; the other yields first
 * @returns {{ sidebar: number, chat: number }}
 */
export function fitPanelWidths({ available, viewportWidth, sidebar, chat, keep = null }) {
  const min = panelMinimums(viewportWidth);
  const widths = { sidebar: Math.max(0, sidebar), chat: Math.max(0, chat) };
  const floor = { sidebar: widths.sidebar ? Math.min(min.sidebar, widths.sidebar) : 0, chat: widths.chat ? Math.min(min.chat, widths.chat) : 0 };
  let excess = widths.sidebar + widths.chat + min.editor - Math.max(0, available);
  const order = keep === "sidebar" ? ["chat", "sidebar"] : ["sidebar", "chat"];
  for (const panel of order) {
    if (excess <= 0) break;
    const give = Math.min(excess, widths[panel] - floor[panel]);
    widths[panel] -= give;
    excess -= give;
  }
  return { sidebar: Math.round(widths.sidebar), chat: Math.round(widths.chat) };
}
