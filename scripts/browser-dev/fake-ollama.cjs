"use strict";
const http = require("node:http");

// A scripted Ollama for driving the real app without a GPU. The chat model
// obeys "RELEASE n" and "RECALL n" in the prompt, answers "BIG" prompts with a
// long reply and "HUGE" prompts with one larger than a 32K window, and
// otherwise answers and ends its turn. Summarizer requests (non-streaming
// JSON) go to `summarize`, which may hold them open.
function startFakeOllama({ model = "fixture:1b", contextLength = 32768, summarize = null } = {}) {
  const requests = [];
  const summaries = [];
  const send = (res, body) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", async () => {
      const body = raw ? JSON.parse(raw) : {};
      if (req.url === "/api/tags") return send(res, { models: [{ name: model, model, details: {} }] });
      if (req.url === "/api/ps") return send(res, { models: [] });
      if (req.url === "/api/show") return send(res, { parameters: "", model_info: { "fixture.context_length": contextLength }, capabilities: ["completion", "tools"], details: {} });
      if (req.url !== "/api/chat") { res.writeHead(404); return res.end("{}"); }
      if (body.stream === false) {
        const entry = { body, aborted: false, answered: false };
        summaries.push(entry);
        res.on("close", () => { if (!res.writableEnded) entry.aborted = true; });
        const answer = summarize ? await summarize(entry) : {};
        if (res.destroyed) return;
        entry.answered = true;
        return send(res, { message: { role: "assistant", content: JSON.stringify(answer || {}) }, done: true });
      }
      const messages = Array.isArray(body.messages) ? body.messages : [];
      requests.push(messages);
      const last = messages.at(-1) || {};
      const prompt = [...messages].reverse().find((message) => message.role === "user" && !/^\[Block \d+ released/.test(String(message.content)))?.content || "";
      const release = /RELEASE (\d+)/.exec(prompt);
      const recall = /RECALL (\d+)/.exec(prompt);
      let message;
      if (last.role !== "tool" && release) message = { role: "assistant", content: "", tool_calls: [{ function: { name: "release_blocks", arguments: { operation: "release", blocks: [{ index: Number(release[1]), note: "fixture release" }] } } }] };
      else if (last.role !== "tool" && recall) message = { role: "assistant", content: "", tool_calls: [{ function: { name: "recall_block", arguments: { index: Number(recall[1]) } } }] };
      else message = { role: "assistant", content: /HUGE/.test(prompt) ? `OK ${"detail ".repeat(22_000)}` : /BIG/.test(prompt) ? `OK ${"detail ".repeat(5_200)}` : "OK", tool_calls: [{ function: { name: "end_turn", arguments: { status: "stop" } } }] };
      res.writeHead(200, { "Content-Type": "application/x-ndjson" });
      res.write(`${JSON.stringify({ model, message, done: false })}\n`);
      res.end(`${JSON.stringify({ model, message: { role: "assistant", content: "" }, done: true, done_reason: "stop", prompt_eval_count: 100, eval_count: 5 })}\n`);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, requests, summaries, model, url: `http://127.0.0.1:${server.address().port}` })));
}

module.exports = { startFakeOllama };
