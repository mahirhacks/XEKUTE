/* Markdown rendering for assistant chat (marked + DOMPurify) */

(function initMarkdown() {
  const marked = globalThis.marked;
  const DOMPurify = globalThis.DOMPurify;

  if (!marked || !DOMPurify) {
    console.error("Markdown deps missing: load marked and DOMPurify before markdown.js");
    return;
  }

  const renderScheduled = new WeakMap();
  const renderedBlocks = new WeakMap();
  const renderedDiagrams = new WeakMap();
  const highlightedCode = new Map();
  let streamingRender = false;
  let hljsRef = null;
  let mermaidReady = false;
  let mermaidSeq = 0;

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function highlightCode(text, lang) {
    if (!text) return "";
    if (!hljsRef) return escapeHtml(text);
    const key = `${lang || ""}\n${text}`;
    if (highlightedCode.has(key)) return highlightedCode.get(key);
    try {
      const html = lang && hljsRef.getLanguage(lang)
        ? hljsRef.highlight(text, { language: lang }).value
        : escapeHtml(text);
      if (highlightedCode.size >= 32) highlightedCode.delete(highlightedCode.keys().next().value);
      highlightedCode.set(key, html);
      return html;
    } catch {
      return escapeHtml(text);
    }
  }

  function isMermaid(lang) {
    return String(lang || "").trim().toLowerCase().split(/\s+/)[0] === "mermaid";
  }

  function initMermaid() {
    const mermaid = globalThis.mermaid;
    if (!mermaid) return null;
    if (!mermaidReady) {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "dark",
        fontFamily: "Consolas, 'Cascadia Code', monospace",
      });
      mermaidReady = true;
    }
    return mermaid;
  }

  function normalizeMermaidSource(source) {
    let text = String(source || "")
      .replace(/\r\n?/g, "\n")
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .trim();

    text = text
      .replace(/^\s*```(?:\s*mermaid)?\s*/i, "")
      .replace(/\s*```\s*$/i, "")
      .replace(/^\s*graph\s+([A-Z]{2})\b/i, "flowchart $1")
      .replace(/;\s*/g, "\n");

    // Small models often concatenate two Mermaid statements on one line.
    for (let i = 0; i < 3; i += 1) {
      text = text.replace(
        /(\]|\}|\))\s{2,}([A-Za-z][\w-]*\s*(?:--|==|-.|\[|\{|\())/g,
        "$1\n  $2",
      );
    }

    // Mermaid is picky about quotes inside bracket labels: A[Print "Hi"].
    // Convert plain labels to quoted labels and replace inner double quotes.
    text = text.replace(/(\b[A-Za-z][\w-]*)\[([^\]\n]+)\]/g, (_match, id, label) => {
      const clean = String(label).trim().replace(/^"|"$/g, "").replace(/"/g, "'");
      return `${id}["${clean}"]`;
    });

    return text;
  }

  async function renderMermaidBlocks(root) {
    const mermaid = initMermaid();
    const blocks = [...root.querySelectorAll(".md-mermaid[data-mermaid-source]")];
    for (const block of blocks) {
      const source = decodeURIComponent(block.dataset.mermaidSource || "");
      if (!source.trim()) continue;
      if (renderedDiagrams.get(block) === source) continue;
      renderedDiagrams.set(block, source);
      if (!mermaid) {
        block.classList.add("fallback");
        block.textContent = source;
        continue;
      }
      try {
        const id = `pointer-mermaid-${Date.now()}-${mermaidSeq += 1}`;
        let rendered;
        try {
          rendered = await mermaid.render(id, source);
        } catch {
          rendered = await mermaid.render(`${id}-fixed`, normalizeMermaidSource(source));
        }
        if (decodeURIComponent(block.dataset.mermaidSource || "") !== source) continue;
        block.innerHTML = DOMPurify.sanitize(rendered.svg || "", {
          USE_PROFILES: { svg: true, svgFilters: true },
        });
        root.dispatchEvent(new CustomEvent("markdown-rendered", { bubbles: true }));
      } catch (err) {
        if (decodeURIComponent(block.dataset.mermaidSource || "") !== source) continue;
        block.classList.add("error");
        block.textContent = `Mermaid render error: ${err?.message || "invalid diagram"}`;
      }
    }
  }

  marked.use({
    renderer: {
      code({ text, lang, raw }) {
        if (isMermaid(lang)) {
          const encoded = encodeURIComponent(text);
          return `<div class="md-mermaid-block" data-code="${encoded}">
            <div class="md-code-header">
              <span class="md-code-lang">mermaid</span>
              <button type="button" class="md-code-copy" title="Copy diagram">Copy</button>
            </div>
            <div class="md-mermaid" data-mermaid-source="${encoded}">${escapeHtml(text)}</div>
          </div>`;
        }
        const label = escapeHtml(lang || "text");
        const encoded = encodeURIComponent(text);
        const fence = String(raw || "").match(/^\s*(`{3,}|~{3,})/);
        const lines = String(raw || "").trimEnd().split("\n");
        const closed = fence && lines.length > 1
          && new RegExp(`^\\s*${fence[1][0]}{${fence[1].length},}\\s*$`).test(lines.at(-1));
        const inner = streamingRender && fence && !closed ? escapeHtml(text) : highlightCode(text, lang);
        return `<div class="md-code-block" data-code="${encoded}">
          <div class="md-code-header">
            <span class="md-code-lang">${label}</span>
            <button type="button" class="md-code-copy" title="Copy code">Copy</button>
          </div>
          <pre><code class="hljs">${inner}</code></pre>
        </div>`;
      },
    },
  });

  marked.setOptions({ gfm: true, breaks: true });

  function render(md, { streaming = false } = {}) {
    let html;
    streamingRender = streaming;
    try {
      html = marked.parse(md ?? "");
    } finally {
      streamingRender = false;
    }
    return DOMPurify.sanitize(html, {
      ADD_TAGS: ["button"],
      ADD_ATTR: ["class", "data-code", "data-mermaid-source", "title", "type"],
    });
  }

  function patchChildren(parent, incoming, { streaming = false } = {}) {
    const nextNodes = [...incoming.childNodes];
    for (let index = 0; index < nextNodes.length; index += 1) {
      const next = nextNodes[index];
      let current = parent.childNodes[index];
      const signature = next.nodeType === 1 ? next.outerHTML : next.data;
      if (current && renderedBlocks.get(current) === signature) continue;
      if (!current || current.nodeType !== next.nodeType || current.nodeName !== next.nodeName) {
        const inserted = next.cloneNode(true);
        if (current) current.replaceWith(inserted);
        else parent.appendChild(inserted);
        current = inserted;
        if (streaming && current.nodeType === 1 && current.animate
          && !globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
          current.animate([{ opacity: 0.45 }, { opacity: 1 }], { duration: 140, easing: "ease-out" });
        }
      } else if (current.nodeType === 3) {
        if (next.data.startsWith(current.data)) current.appendData(next.data.slice(current.data.length));
        else current.data = next.data;
      } else if (current.nodeType === 1) {
        for (const attr of [...current.attributes]) {
          if (!next.hasAttribute(attr.name)) current.removeAttribute(attr.name);
        }
        for (const attr of [...next.attributes]) {
          if (current.getAttribute(attr.name) !== attr.value) current.setAttribute(attr.name, attr.value);
        }
        patchChildren(current, next, { streaming });
      }
      renderedBlocks.set(current, signature);
    }
    while (parent.childNodes.length > nextNodes.length) parent.lastChild.remove();
  }

  function renderToElement(el, md, { streaming = false } = {}) {
    const pending = renderScheduled.get(el);
    if (pending) {
      cancelAnimationFrame(pending.frame);
      renderScheduled.delete(el);
    }
    const text = md ?? "";
    el.dataset.rawMd = text;
    const template = document.createElement("template");
    template.innerHTML = render(text, { streaming });
    patchChildren(el, template.content, { streaming });
    el.dispatchEvent(new CustomEvent("markdown-rendered", { bubbles: true, detail: { streaming } }));
    if (!streaming) {
      renderMermaidBlocks(el);
    }
  }

  function scheduleRender(el, getMd, streaming) {
    el.dataset.rawMd = getMd();
    // Always keep the latest markdown producer. Dropping updates while a frame
    // is already scheduled left the chat stuck on the first few streamed chars.
    const previous = renderScheduled.get(el);
    if (previous) {
      previous.getMd = getMd;
      previous.streaming = Boolean(streaming);
      return;
    }
    const pending = { getMd, streaming: Boolean(streaming), frame: 0 };
    pending.frame = requestAnimationFrame(() => {
      const latest = renderScheduled.get(el);
      renderScheduled.delete(el);
      if (!latest) return;
      renderToElement(el, latest.getMd(), { streaming: latest.streaming });
    });
    renderScheduled.set(el, pending);
  }

  function rerenderAll() {
    document.querySelectorAll(".assistant-reply[data-raw-md], .agent-thinking-content[data-raw-md], .thinking-body[data-raw-md]").forEach((el) => {
      if (!renderScheduled.has(el)) renderToElement(el, el.dataset.rawMd, { streaming: el.classList.contains("streaming") });
    });
  }

  globalThis.MarkdownRenderer = {
    render,
    renderToElement,
    scheduleRender,
  };

  globalThis.dispatchEvent(new Event("markdown-ready"));

  import("../../../node_modules/highlight.js/es/common.js")
    .then((mod) => {
      hljsRef = mod.default;
      rerenderAll();
    })
    .catch(() => {
      /* code blocks render without syntax colors */
    });
})();
