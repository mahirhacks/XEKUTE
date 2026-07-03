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

  marked.use({
    renderer: {
      code({ text, lang }) {
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
      ADD_ATTR: ["class", "data-code", "title", "type"],
    });
  }

  function renderToElement(el, md, { streaming = false } = {}) {
    const text = md ?? "";
    el.dataset.rawMd = text;
    el.innerHTML = render(text);
    if (streaming) {
      const cursor = document.createElement("span");
      cursor.className = "stream-cursor";
      cursor.setAttribute("aria-hidden", "true");
      el.appendChild(cursor);
    }
  }

  function scheduleRender(el, getMd, streaming) {
    if (renderScheduled.get(el)) return;
    renderScheduled.set(el, true);
    requestAnimationFrame(() => {
      renderScheduled.set(el, false);
      renderToElement(el, getMd(), { streaming });
    });
  }

  function rerenderAll() {
    document.querySelectorAll(".assistant-reply[data-raw-md]").forEach((el) => {
      renderToElement(el, el.dataset.rawMd);
    });
  }

  globalThis.MarkdownRenderer = {
    render,
    renderToElement,
    scheduleRender,
  };

  globalThis.dispatchEvent(new Event("markdown-ready"));

  import("../node_modules/highlight.js/es/common.js")
    .then((mod) => {
      hljsRef = mod.default;
      rerenderAll();
    })
    .catch(() => {
      /* code blocks render without syntax colors */
    });
})();
