/* Markdown rendering for assistant chat (marked + DOMPurify) */

(function initMarkdown() {
  const marked = globalThis.marked;
  const DOMPurify = globalThis.DOMPurify;

  if (!marked || !DOMPurify) {
    console.error("Markdown deps missing: load marked and DOMPurify before markdown.js");
    return;
  }

  const renderScheduled = new WeakMap();
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
    try {
      if (lang && hljsRef.getLanguage(lang)) {
        return hljsRef.highlight(text, { language: lang }).value;
      }
      return hljsRef.highlightAuto(text).value;
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
        block.innerHTML = DOMPurify.sanitize(rendered.svg || "", {
          USE_PROFILES: { svg: true, svgFilters: true },
        });
      } catch (err) {
        block.classList.add("error");
        block.textContent = `Mermaid render error: ${err?.message || "invalid diagram"}`;
      }
    }
  }

  marked.use({
    renderer: {
      code({ text, lang }) {
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
        const inner = highlightCode(text, lang);
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

  function render(md) {
    const html = marked.parse(md ?? "");
    return DOMPurify.sanitize(html, {
      ADD_TAGS: ["button"],
      ADD_ATTR: ["class", "data-code", "data-mermaid-source", "title", "type"],
    });
  }

  function renderToElement(el, md, { streaming = false } = {}) {
    const text = md ?? "";
    el.dataset.rawMd = text;
    el.innerHTML = render(text);
    if (!streaming) {
      renderMermaidBlocks(el);
    }
  }

  function scheduleRender(el, getMd, streaming) {
    // Always keep the latest markdown producer. Dropping updates while a frame
    // is already scheduled left the chat stuck on the first few streamed chars.
    const previous = renderScheduled.get(el);
    const alreadyQueued = Boolean(previous?.queued);
    renderScheduled.set(el, { getMd, streaming: Boolean(streaming), queued: true });
    if (alreadyQueued) return;
    requestAnimationFrame(() => {
      const latest = renderScheduled.get(el);
      renderScheduled.delete(el);
      if (!latest) return;
      renderToElement(el, latest.getMd(), { streaming: latest.streaming });
    });
  }

  function rerenderAll() {
    document.querySelectorAll(".assistant-reply[data-raw-md], .thinking-body[data-raw-md]").forEach((el) => {
      renderToElement(el, el.dataset.rawMd);
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
