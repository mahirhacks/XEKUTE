(function initExplorerSelection(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XekuteExplorerSelection = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createExplorerSelection() {
  "use strict";

  function uniquePaths(paths = []) {
    return [...new Set((Array.isArray(paths) ? paths : []).map((path) => String(path || "")).filter(Boolean))];
  }

  function nextSelection({
    selectedPaths = [],
    anchorPath = "",
    clickedPath = "",
    orderedVisiblePaths = [],
    additive = false,
    range = false,
    contextMenu = false,
  } = {}) {
    const clicked = String(clickedPath || "");
    const ordered = uniquePaths(orderedVisiblePaths);
    const selected = new Set(uniquePaths(selectedPaths));
    let anchor = String(anchorPath || "");

    if (!clicked) return { selectedPaths: [], anchorPath: "", primaryPath: "" };

    // Right-clicking one member of a multi-selection keeps the group intact.
    if (contextMenu && selected.has(clicked) && !range && !additive) {
      return { selectedPaths: [...selected], anchorPath: anchor || clicked, primaryPath: clicked };
    }

    const anchorIndex = ordered.indexOf(anchor);
    const clickedIndex = ordered.indexOf(clicked);
    if (range && anchorIndex >= 0 && clickedIndex >= 0) {
      if (!additive) selected.clear();
      const start = Math.min(anchorIndex, clickedIndex);
      const end = Math.max(anchorIndex, clickedIndex);
      ordered.slice(start, end + 1).forEach((path) => selected.add(path));
      return { selectedPaths: [...selected], anchorPath: anchor, primaryPath: clicked };
    }

    if (additive) {
      if (selected.has(clicked)) selected.delete(clicked);
      else selected.add(clicked);
      anchor = clicked;
      const remaining = [...selected];
      return {
        selectedPaths: remaining,
        anchorPath: anchor,
        primaryPath: selected.has(clicked) ? clicked : (remaining.at(-1) || ""),
      };
    }

    return { selectedPaths: [clicked], anchorPath: clicked, primaryPath: clicked };
  }

  function topLevelTargets(targets = []) {
    const normalized = (Array.isArray(targets) ? targets : [])
      .filter((target) => target?.path)
      .map((target) => ({ ...target, path: String(target.path).replace(/\\/g, "/").replace(/\/+$/g, "") }))
      .sort((left, right) => left.path.length - right.path.length || left.path.localeCompare(right.path));
    const kept = [];
    for (const target of normalized) {
      if (kept.some((parent) => parent.isDir && (target.path === parent.path || target.path.startsWith(`${parent.path}/`)))) continue;
      kept.push(target);
    }
    return kept;
  }

  return Object.freeze({ nextSelection, topLevelTargets, uniquePaths });
});
