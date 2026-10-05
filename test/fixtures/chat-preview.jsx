import React from "react";
import { createRoot } from "react-dom/client";
import { marked } from "marked";
import DOMPurify from "dompurify";
import "@vscode/codicons/dist/codicon.css";
import "highlight.js/styles/github-dark.min.css";
import "../../src/ui/styles/base.css";
import "../../src/ui/styles/chat.css";
import "../../src/ui/styles/settings.css";
import "../../src/ui/styles/layout-revamp.css";
import AppShell from "../../src/ui/react/AppShell.jsx";
import { createWorkFold, toggleWorkFold, workFoldBody } from "../../src/ui/features/chat/chat-work-fold.js";
import { createChatScroller } from "../../src/ui/features/chat/chat-scroll.js";

globalThis.marked = marked;
globalThis.DOMPurify = DOMPurify;
await import("../../src/ui/core/markdown.js");

const css = document.createElement("style");
css.textContent = `
  #project-setup { visibility: hidden; }
  .preview-controls { position: fixed; top: 76px; left: 44px; width: 220px; padding: 16px; box-sizing: border-box; color: #bbb; background: #111; z-index: 1; }
  .preview-controls h1 { font-size: 20px; font-weight: 500; color: #eee; margin-bottom: 12px; }
  .preview-controls p { font-size: 13px; line-height: 1.7; margin-bottom: 20px; }
  .preview-controls button { margin: 0 6px 8px 0; padding: 8px 10px; border: 1px solid #444; border-radius: 6px; background: #252526; color: #ddd; cursor: pointer; }
  .preview-controls output { display: block; font-size: 12px; color: #aaa; margin-top: 8px; }
  @media (max-width: 900px) { #chat-pane { max-width: 65vw; } }
`;
document.head.append(css);
function Preview() {
  React.useEffect(startPreview, []);
  return <AppShell />;
}
const root = import.meta.hot?.data.root || createRoot(document.getElementById("root"));
root.render(<Preview />);
if (import.meta.hot) import.meta.hot.data.root = root;

function startPreview() {
  const messages = document.getElementById("messages");
  const scroller = createChatScroller(messages);
  document.getElementById("chat-session-select").innerHTML = '<div class="chat-session-tab active"><span class="chat-session-label">Streaming and layout</span><span class="codicon codicon-close chat-tab-close"></span></div>';
  document.getElementById("model-label").textContent = "Local model";
  const panel = document.createElement("section");
  panel.className = "preview-controls";
  panel.innerHTML = '<h1>Chat UI preview</h1><p>This preview uses the application shell, Markdown renderer, work folds, and scroll controller. It simulates responses locally without contacting a model.</p><button id="preview-stream">Stream response</button><button id="preview-long">Stream long answer</button><button id="preview-stop">Stop</button><button id="preview-narrow">Narrow panel</button><button id="preview-prompts">Prompt spacing</button><button id="preview-blocks">Chat block spacing</button><output id="preview-result">Ready</output>';
  document.getElementById("sidebar").append(panel);
  let timer = null;

  function run(long = false) {
    clearInterval(timer);
    messages.replaceChildren();
    const exchange = document.createElement("div");
    exchange.className = "chat-exchange";
    exchange.innerHTML = '<div class="chat-exchange-body"><div class="chat-turn user"><div class="chat-box"><div class="chat-box-content user-prompt-preview">Review the agent chat and make streamed responses easier to follow.</div></div></div><div class="agent-response-host"><div class="chat-turn assistant agent-stream" aria-busy="true"></div></div></div>';
    messages.append(exchange);
    const turn = exchange.querySelector(".chat-turn.assistant");
    const fold = createWorkFold({ label: "Working for 2s", startedAt: Date.now() });
    turn.append(fold);
    const body = workFoldBody(fold);
    body.innerHTML = '<div class="agent-thinking-fold" data-expanded="false" data-final="false"><button class="agent-thinking-toggle" type="button" aria-expanded="false"><span class="agent-thinking-text">Thinking</span><img class="agent-work-caret" src="/assets/icons/chat_fold_caret.svg" alt=""></button><div class="agent-thinking-body"><div class="agent-thinking-content">Checking the streaming lifecycle and transcript spacing.</div></div></div><button type="button" class="agent-file-row tool-card file-action" title="src/ui/features/chat/chat-transcript.js"><span class="tool-card-header"><img class="tool-card-file-icon" src="/assets/icons/chat_read_edit_file_icon.svg" alt=""><span class="tool-card-file">Read src/ui/features/chat/chat-transcript.js</span></span></button><details class="agent-command-event" data-state="success"><summary class="agent-command-summary"><span class="agent-command-label"><span class="agent-tool-verb">Ran Command</span> <span class="agent-tool-detail">Verify changes</span></span></summary><pre class="agent-command-body"><code>node --test test/markdown-streaming.test.js</code></pre></details><details class="agent-command-event" data-state="error"><summary class="agent-command-summary"><span class="agent-command-label"><span class="agent-tool-verb">Command failed</span> <span class="agent-tool-detail">Inspect workspace</span></span></summary><pre class="agent-command-body"><code>ls missing-directory</code></pre></details>';
    const reply = document.createElement("div");
    reply.className = "assistant-reply streaming";
    reply.dataset.liveReply = "true";
    turn.append(reply);
    const text = 'The chat now keeps completed text stable while the next paragraph streams. You can read earlier messages without being pulled back down.\n\n### What changed\n\n- Completed paragraphs and code blocks keep their position.\n- Tool activity stays compact and expandable.\n- Scroll up to pause following, then scroll back down to resume.\n\n```js\nconst reply = "Keep the conversation steady.";\nconsole.log(reply);\n```\n\nThe composer and activity rows now share consistent spacing. ' + (long ? Array.from({ length: 32 }, (_, i) => `\n\n**Check ${i + 1}.** Open a completed activity row, select text, or scroll upward while this response continues. Your reading position should stay put.`).join("") : 'You can expand the work summary to inspect the files and command output.');
    let cursor = 0;
    let raw = "";
    const output = document.getElementById("preview-result");
    output.textContent = "Streaming";
    scroller.follow({ force: true });

    function finish(stopped = false) {
      clearInterval(timer);
      timer = null;
      globalThis.MarkdownRenderer.renderToElement(reply, raw);
      reply.classList.remove("streaming");
      delete reply.dataset.liveReply;
      turn.setAttribute("aria-busy", "false");
      const thinking = fold.querySelector(".agent-thinking-fold");
      thinking.dataset.final = "true";
      thinking.querySelector(".agent-thinking-text").textContent = "Thought briefly";
      const header = fold.querySelector(".agent-status-text");
      header.textContent = stopped ? "Stopped" : "Worked for 6s";
      fold.querySelector(".agent-work-header").dataset.final = "true";
      if (fold.dataset.userToggled !== "true") {
        fold.dataset.expanded = "false";
        fold.querySelector("button").setAttribute("aria-expanded", "false");
      }
      output.textContent = stopped ? "Stopped. Partial response preserved." : "Finished";
      scroller.follow();
    }

    document.getElementById("preview-stop").onclick = () => finish(true);
    timer = setInterval(() => {
      cursor = Math.min(text.length, cursor + (long ? 35 : 12));
      raw = text.slice(0, cursor);
      globalThis.MarkdownRenderer.scheduleRender(reply, () => raw, true);
      if (cursor === text.length) finish();
    }, 35);
  }

  messages.addEventListener("click", (event) => {
    const header = event.target.closest(".agent-work-header");
    if (header) toggleWorkFold(header.closest(".agent-work-fold"));
    const thinking = event.target.closest(".agent-thinking-toggle");
    if (thinking) {
      const fold = thinking.closest(".agent-thinking-fold");
      fold.dataset.expanded = String(fold.dataset.expanded === "false");
      thinking.setAttribute("aria-expanded", fold.dataset.expanded);
    }
  });
  document.getElementById("preview-blocks").onclick = () => {
    clearInterval(timer);
    scroller.pause();
    const blocks = [
      ['Review this response', 'Completed the review. Each new prompt starts below the response controls.'],
      ['Can you check the layout?', 'The chat blocks now have more room between completed responses and the next prompt.'],
      ['What happened?', 'The latest response starts here.'],
    ];
    messages.innerHTML = blocks.map(([prompt, answer]) => '<div class="chat-exchange"><div class="chat-exchange-body"><div class="chat-turn user"><div class="chat-box"><div class="chat-box-content user-prompt-preview">' + prompt + '</div></div></div><div class="agent-response-host"><div class="chat-turn assistant"><div class="assistant-reply"><p>' + answer + '</p></div></div><div class="assistant-reply-footer"><button class="assistant-reply-copy" type="button" aria-label="Copy response"><span class="codicon codicon-copy"></span></button></div></div></div></div>').join('');
    messages.scrollTop = 0;
    document.getElementById('preview-result').textContent = 'Space between completed chat blocks';
  };
  document.getElementById("preview-prompts").onclick = () => {
    clearInterval(timer);
    scroller.pause();
    const previousText = Array.from({ length: 14 }, () => '<p>Earlier response content scrolls beneath its own pinned prompt.</p>').join('');
    const latestText = Array.from({ length: 10 }, () => '<p>The latest response continues below this prompt.</p>').join('');
    messages.innerHTML = '<div class="chat-exchange"><div class="chat-exchange-body"><div class="chat-turn user"><div class="chat-box"><div class="chat-box-content user-prompt-preview">My previous question</div></div></div><div class="agent-response-host"><div class="chat-turn assistant"><div class="assistant-reply">' + previousText + '</div></div><div class="assistant-reply-footer"><button class="assistant-reply-copy" type="button" aria-label="Copy previous response"><span class="codicon codicon-copy"></span></button><button class="assistant-reply-copy assistant-reply-fork" type="button" aria-label="Fork previous response"><span class="codicon codicon-git-fork"></span></button></div></div></div></div><div class="chat-exchange"><div class="chat-exchange-body"><div class="chat-turn user"><div class="chat-box"><div class="chat-box-content user-prompt-preview">My latest question</div></div></div><div class="agent-response-host"><div class="chat-turn assistant"></div></div></div></div>';
    const latestTurn = messages.querySelector('.chat-exchange:last-child .chat-turn.assistant');
    const fold = createWorkFold({ label: 'Worked for 26s', final: true, expanded: false });
    latestTurn.append(fold);
    const reply = document.createElement('div');
    reply.className = 'assistant-reply';
    reply.innerHTML = latestText;
    latestTurn.append(reply);
    const latestPrompt = messages.querySelector('.chat-exchange:last-child .chat-turn.user');
    messages.scrollTop += latestPrompt.getBoundingClientRect().top - messages.getBoundingClientRect().top - 92;
    document.getElementById('preview-result').textContent = 'Previous prompt is being pushed up';
  };
  document.getElementById("preview-stream").onclick = () => run();
  document.getElementById("preview-long").onclick = () => run(true);
  document.getElementById("preview-narrow").onclick = () => {
    const pane = document.getElementById("chat-pane");
    pane.style.width = pane.style.width === "384px" ? "513px" : "384px";
  };
  run();
  return () => {
    clearInterval(timer);
    scroller.destroy();
    panel.remove();
  };
}
