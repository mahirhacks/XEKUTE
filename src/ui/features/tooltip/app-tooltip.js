export function initializeAppTooltips() {
  if (document.getElementById("app-tooltip")) return;

  const tooltip = document.createElement("div");
  tooltip.id = "app-tooltip";
  tooltip.className = "app-tooltip";
  tooltip.setAttribute("role", "tooltip");
  tooltip.hidden = true;
  document.body.appendChild(tooltip);

  let active = null;
  let hoverTarget = null;
  let focusTarget = null;
  let showTimer = null;
  let leaveTimer = null;

  function findAnchor(node) {
    if (!(node instanceof Element) || tooltip.contains(node)) return null;
    for (let element = node; element; element = element.parentElement) {
      if (!element.hasAttribute("title")) continue;
      const text = element === active?.anchor ? active.text : element.getAttribute("title");
      return text?.trim() ? element : null;
    }
    return null;
  }

  function preferredAnchor() {
    return findAnchor(hoverTarget) || findAnchor(focusTarget);
  }

  function removeDescription() {
    if (!active) return;
    const ids = (active.anchor.getAttribute("aria-describedby") || "")
      .split(/\s+/).filter((id) => id && id !== tooltip.id);
    if (ids.length) active.anchor.setAttribute("aria-describedby", ids.join(" "));
    else active.anchor.removeAttribute("aria-describedby");
  }

  function hide() {
    clearTimeout(showTimer);
    tooltip.hidden = true;
    removeDescription();
  }

  function release() {
    hide();
    const titleChanged = observer.takeRecords().some((record) =>
      record.type === "attributes" && record.target === active?.anchor);
    if (titleChanged) active.text = active.anchor.getAttribute("title") || "";
    observer.disconnect();
    if (active) {
      if (active.anchor.getAttribute("title") === "") {
        active.anchor.setAttribute("title", active.text);
      }
      if (active.label && active.anchor.getAttribute("aria-label") === active.label) {
        active.anchor.removeAttribute("aria-label");
      }
    }
    active = null;
    observe();
  }

  function observe() {
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["title"],
    });
  }

  function suppressNativeTitle() {
    observer.disconnect();
    // An empty title also prevents a parent title from showing a native tooltip.
    active.anchor.setAttribute("title", "");
    observe();
  }

  function position() {
    const anchor = active.anchor.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    if (anchor.bottom <= 0 || anchor.top >= viewportHeight ||
        anchor.right <= 0 || anchor.left >= viewportWidth) {
      hide();
      return;
    }
    const box = tooltip.getBoundingClientRect();
    const margin = 8;
    const clampLeft = (left) => Math.max(margin, Math.min(left, viewportWidth - box.width - margin));
    const clampTop = (top) => Math.max(margin, Math.min(top, viewportHeight - box.height - margin));
    const centeredLeft = anchor.left + (anchor.width - box.width) / 2;
    const middleTop = anchor.top + (anchor.height - box.height) / 2;
    const candidates = [
      { left: centeredLeft, top: anchor.bottom + margin },
      { left: centeredLeft, top: anchor.top - box.height - margin },
      { left: anchor.right + margin, top: middleTop },
      { left: anchor.left - box.width - margin, top: middleTop },
    ];
    // Native views such as the browser page draw above every DOM layer, so a
    // tooltip placed over one is hidden whatever its z-index.
    const surfaces = [...document.querySelectorAll("[data-native-surface]")]
      .map((element) => element.getBoundingClientRect())
      .filter((rect) => rect.width > 0 && rect.height > 0);
    const fits = ({ left, top }) => left >= margin && top >= margin
      && left + box.width <= viewportWidth - margin && top + box.height <= viewportHeight - margin;
    const covered = ({ left, top }) => surfaces.some((rect) => left < rect.right && left + box.width > rect.left
      && top < rect.bottom && top + box.height > rect.top);
    const vertical = candidates[0].top + box.height <= viewportHeight - margin ? candidates[0] : candidates[1];
    const chosen = surfaces.length
      ? candidates.find((place) => fits(place) && !covered(place))
        || candidates.map((place) => ({ left: clampLeft(place.left), top: clampTop(place.top) })).find((place) => !covered(place))
        || vertical
      : vertical;
    tooltip.style.left = `${clampLeft(chosen.left)}px`;
    tooltip.style.top = `${clampTop(chosen.top)}px`;
  }

  function show() {
    if (!active?.anchor.isConnected) {
      release();
      return;
    }
    tooltip.textContent = active.text;
    tooltip.hidden = false;
    const ids = new Set((active.anchor.getAttribute("aria-describedby") || "")
      .split(/\s+/).filter(Boolean));
    ids.add(tooltip.id);
    active.anchor.setAttribute("aria-describedby", [...ids].join(" "));
    position();
  }

  function activate(anchor, delay = 350) {
    clearTimeout(leaveTimer);
    if (anchor === active?.anchor) return;
    release();
    if (!anchor?.isConnected) return;
    const text = anchor.getAttribute("title");
    if (!text?.trim()) return;
    active = { anchor, text, label: null };
    if (anchor.matches("button, a, [role='button']") &&
        !anchor.hasAttribute("aria-label") && !anchor.hasAttribute("aria-labelledby") &&
        !anchor.textContent.trim()) {
      active.label = text;
      anchor.setAttribute("aria-label", text);
    }
    suppressNativeTitle();
    showTimer = setTimeout(show, delay);
  }

  const observer = new MutationObserver((records) => {
    if (active && !active.anchor.isConnected) {
      if (!hoverTarget?.isConnected) hoverTarget = null;
      if (!focusTarget?.isConnected) focusTarget = null;
      release();
    }
    if (!records.some((record) => record.type === "attributes")) return;
    if (active && records.some((record) => record.type === "attributes" && record.target === active.anchor)) {
      const text = active.anchor.getAttribute("title");
      if (!text?.trim()) {
        active.text = text || "";
        release();
      } else {
        if (active.label && active.anchor.getAttribute("aria-label") === active.label) {
          active.anchor.setAttribute("aria-label", text);
          active.label = text;
        }
        active.text = text;
        suppressNativeTitle();
        if (!tooltip.hidden) show();
      }
    }
    const anchor = preferredAnchor();
    if (anchor !== active?.anchor) activate(anchor);
  });
  observe();

  document.addEventListener("pointerover", (event) => {
    if (event.pointerType === "touch") return;
    if (tooltip.contains(event.target)) {
      clearTimeout(leaveTimer);
      return;
    }
    hoverTarget = event.target;
    activate(preferredAnchor());
  }, true);

  document.addEventListener("pointerout", (event) => {
    if (event.pointerType === "touch") return;
    const relatedTarget = event.relatedTarget instanceof Node ? event.relatedTarget : null;
    if (tooltip.contains(relatedTarget) || active?.anchor.contains(relatedTarget)) return;
    hoverTarget = relatedTarget;
    clearTimeout(leaveTimer);
    leaveTimer = setTimeout(() => activate(preferredAnchor()), 100);
  }, true);

  document.addEventListener("focusin", (event) => {
    focusTarget = event.target.matches(":focus-visible") ? event.target : null;
    if (focusTarget) hoverTarget = null;
    activate(preferredAnchor(), 0);
  });

  document.addEventListener("focusout", () => {
    focusTarget = null;
    activate(preferredAnchor());
  });

  document.addEventListener("pointerdown", (event) => {
    if (!tooltip.contains(event.target)) hide();
  }, true);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hide();
  }, true);
  document.addEventListener("scroll", (event) => {
    if (!tooltip.contains(event.target)) hide();
  }, true);
  window.addEventListener("resize", () => {
    if (!tooltip.hidden) position();
  });
  window.addEventListener("blur", () => {
    hoverTarget = null;
    focusTarget = null;
    release();
  });
}
