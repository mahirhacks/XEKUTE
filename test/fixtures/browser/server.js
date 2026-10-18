"use strict";

const http = require("node:http");
const { once } = require("node:events");

const MAX_BODY = 1024 * 1024;
const MAX_CAPTURE = 64 * 1024;
const DOWNLOAD = "Xekute browser fixture download.\n";
const escape = value => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

function page(title, body, script = "") {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>${escape(title)}</title><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{max-width:900px;margin:32px auto;padding:0 20px;font:16px/1.5 system-ui;color:#dedede;background:#171717}a{color:#a7ceff}nav{display:flex;gap:15px;flex-wrap:wrap}button,input,select,textarea{font:inherit;margin:8px;padding:8px}button{cursor:pointer}label{display:block}output{display:block;min-height:24px;padding:10px;background:#292929}iframe{width:95%;height:300px;background:white}canvas{background:#262626;max-width:100%}.drop{display:inline-flex;align-items:center;justify-content:center;width:150px;height:80px;margin:15px;background:#384c70}</style>
<nav><a href="/">Fixtures</a><a href="/form">Forms</a><a href="/spa">SPA</a><a href="/frames">Frames</a><a href="/popups">Popups</a><a href="/dialogs">Dialogs</a><a href="/canvas">Canvas</a><a href="/files">Files</a></nav><h1>${escape(title)}</h1>${body}${script ? `<script>${script}</script>` : ""}</html>`;
}

function send(response, status, body, type = "text/html; charset=utf-8", headers = {}) {
  response.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", ...headers });
  response.end(body);
}
function json(response, status, value, headers) { send(response, status, JSON.stringify(value), "application/json", headers); }
async function body(request) {
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error("Fixture request exceeds 1 MiB."), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${server.address().port}`;
}
async function close(server) {
  const settled = new Promise(resolve => server.close(resolve));
  server.closeAllConnections();
  await settled;
}

async function startBrowserFixtures() {
  const origins = {};
  const captures = [], uploads = [];
  const sessions = new Map();
  const servers = [];
  let sequence = 0, closed = false;
  const allowed = value => {
    try { return [origins.primary, origins.secondary].includes(new URL(value).origin); }
    catch { return false; }
  };
  function handler(originName) {
    return async (request, response) => {
      try {
        const url = new URL(request.url, origins[originName]);
        if (url.pathname === "/health") return json(response, 200, { ok: true, origin: originName });
        if (url.pathname === "/slow") {
          await new Promise(resolve => setTimeout(resolve, 1500));
          return json(response, 200, { finished: true });
        }
        if (url.pathname === "/") return send(response, 200, page("Browser development fixtures", `<p>Phase 1 test environment. These pages contain synthetic data and make no external requests.</p><ul>
<li><a href="/form">Forms, authentication, and focus</a></li><li><a href="/spa">Dynamic elements and stale references</a></li><li><a href="/frames">Cross-origin and nested frames</a></li><li><a href="/popups">Popup tabs</a></li><li><a href="/dialogs">Browser dialogs</a></li><li><a href="/canvas">Visual-only target and dragging</a></li><li><a href="/files">Upload and download</a></li></ul><p>Secondary origin: <a href="${origins.secondary}/frame-content">${origins.secondary}</a></p>`));
        if (url.pathname === "/form") return send(response, 200, page("Form fixture", `<form id="login"><label>User <input id="username" name="username" autocomplete="username" required></label><label>Password <input id="password" name="password" type="password" autocomplete="current-password" required></label><label for="role">Role</label><select id="role" name="role"><option value="user">User</option><option value="admin">Admin</option></select><label><input id="remember" type="checkbox"> Remember fixture session</label><button type="submit">Sign in</button></form><button id="check-session">Check session</button><output id="status" aria-live="polite">Not signed in</output>`, `
const status=document.getElementById('status');
document.getElementById('login').addEventListener('submit',async event=>{event.preventDefault();const data=Object.fromEntries(new FormData(event.target));const response=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const result=await response.json();localStorage.setItem('fixture-user',result.user||'');status.textContent=result.user?'Signed in as '+result.user+' ('+result.role+')':result.error;});
document.getElementById('check-session').onclick=async()=>{const result=await(await fetch('/api/me')).json();status.textContent=result.user?'Session: '+result.user:'Not signed in';};`));
        if (url.pathname === "/prompt-on-load") return send(response, 200, page("Prompt on load", '<output id="status">Waiting</output>', "const answer=prompt('Navigation prompt','default fixture');document.querySelector('#status').textContent=answer===null?'Cancelled':'Accepted: '+answer;"));
        if (url.pathname === "/api/login" && request.method === "POST") {
          let input; try { input = JSON.parse((await body(request)).toString()); } catch { return json(response, 400, { error: "Invalid fixture JSON." }); }
          const user = String(input.username || "").trim().slice(0, 80);
          if (!user || !input.password) return json(response, 400, { error: "Enter fixture credentials." });
          const token = `fixture-${++sequence}`;
          const record = { user, role: input.role === "admin" ? "admin" : "user" };
          sessions.set(token, record);
          return json(response, 200, record, { "Set-Cookie": `fixture_auth=${token}; Path=/; HttpOnly; SameSite=Lax` });
        }
        if (url.pathname === "/api/me") {
          const token = /(?:^|;\s*)fixture_auth=([^;]+)/.exec(request.headers.cookie || "")?.[1];
          return json(response, 200, sessions.get(token) || { user: null });
        }
        if (url.pathname === "/spa") return send(response, 200, page("Dynamic page fixture", `<label>Filter <input id="filter"></label><div id="items"></div><button id="replace">Replace results</button><output id="status">Ready</output>`, `
let revision=0;const items=document.getElementById('items');
function render(){const query=document.getElementById('filter').value.toLowerCase();items.replaceChildren(...['Alpha','Beta','Gamma'].filter(name=>name.toLowerCase().includes(query)).map(name=>{const button=document.createElement('button');button.textContent=name;button.dataset.revision=revision;button.onclick=()=>document.getElementById('status').textContent=name+' selected at revision '+revision;return button;}));}
document.getElementById('filter').oninput=render;document.getElementById('replace').onclick=()=>{revision++;render();document.getElementById('status').textContent='Results replaced '+revision;history.replaceState({},'', '/spa?revision='+revision);};render();`));
        if (url.pathname === "/hybrid") return send(response, 200, page("Hybrid order fixture", `<section id="step-order"><label>Order name <input id="order"></label><button type="button" id="next">Continue to confirmation</button></section><section id="step-confirm" hidden><p>Press Confirm inside the drawing. It has no DOM button.</p><canvas id="confirm" width="320" height="120"></canvas></section><section id="step-note" hidden><label>Delivery note <input id="note"></label><button type="button" id="submit">Submit order</button></section><div id="lane" style="position:relative;height:90px;margin:12px 0;background:#222"><div id="handle" style="position:absolute;left:10px;top:20px;width:60px;height:50px;background:#4a6;touch-action:none">Handle</div><div id="dock" style="position:absolute;left:300px;top:10px;width:90px;height:70px;border:2px dashed #888">Dock</div></div><output id="pointer">Released</output><output id="docked">Docked: 0</output><output id="status">Draft</output>`, `
const $=id=>document.getElementById(id),canvas=$('confirm'),ctx=canvas.getContext('2d');ctx.fillStyle='#262626';ctx.fillRect(0,0,320,120);ctx.fillStyle='#2f9e44';ctx.fillRect(170,30,120,60);ctx.fillStyle='white';ctx.font='18px sans-serif';ctx.fillText('Confirm',196,66);
$('next').onclick=()=>{if(!$('order').value)return;$('step-confirm').hidden=false;$('status').textContent='Awaiting visual confirmation';};
canvas.onclick=event=>{const box=canvas.getBoundingClientRect(),x=(event.clientX-box.left)*canvas.width/box.width,y=(event.clientY-box.top)*canvas.height/box.height;if(x>=170&&x<=290&&y>=30&&y<=90){$('step-note').hidden=false;$('status').textContent='Confirmed';}};
$('submit').onclick=()=>{$('status').textContent='Order '+$('order').value+' confirmed with note '+$('note').value;};
let docked=0,dragging=false;const handle=$('handle'),lane=$('lane');
handle.onpointerdown=event=>{dragging=true;handle.setPointerCapture(event.pointerId);$('pointer').textContent='Pressed';};
handle.onpointermove=event=>{if(!dragging)return;const box=lane.getBoundingClientRect();handle.style.left=(event.clientX-box.left-30)+'px';};
handle.onpointerup=event=>{if(!dragging)return;dragging=false;$('pointer').textContent='Released';const dock=$('dock').getBoundingClientRect();if(event.clientX>=dock.left&&event.clientX<=dock.right&&event.clientY>=dock.top&&event.clientY<=dock.bottom)$('docked').textContent='Docked: '+(++docked);};`));
        if (url.pathname === "/large") return send(response, 200, page("Large page fixture", Array.from({ length: 400 }, (_, index) => `<p>Paragraph ${index + 1} of the large fixture text. <button type="button">Item ${index + 1}</button></p>`).join("")));
        if (url.pathname === "/observe") return send(response, 200, page("Observation fixture", `<form id="rows"><input type="hidden" name="csrf" value="fixture-hidden-token"><button type="button" id="ghost" style="display:none">Ghost action</button><table><tr><th>Project</th><th></th></tr><tr><td>Alpha report</td><td><button type="button" data-row="alpha">Delete</button></td></tr><tr><td>Beta report</td><td><button type="button" data-row="beta">Delete</button></td></tr></table></form><output id="status">Nothing deleted</output>`, `
document.querySelectorAll('[data-row]').forEach(button=>button.onclick=()=>document.getElementById('status').textContent='Deleted '+button.dataset.row);`));
        if (url.pathname === "/frames") return send(response, 200, page("Frame fixture", `<iframe title="Cross-origin fixture" src="${origins.secondary}/frame-content"></iframe><output id="status">Waiting for frame</output>`, `window.addEventListener('message',event=>{if(event.origin===${JSON.stringify(origins.secondary)}&&event.data?.fixture==='frame')document.getElementById('status').textContent=event.data.text;});`));
        if (url.pathname === "/frame-content") return send(response, 200, page("Cross-origin frame", `<button id="frame-button">Activate frame</button><output id="frame-status">Frame ready</output><iframe title="Nested fixture" src="${origins.primary}/nested-content"></iframe>`, `document.getElementById('frame-button').onclick=()=>{document.getElementById('frame-status').textContent='Frame activated';parent.postMessage({fixture:'frame',text:'Frame activated'},${JSON.stringify(origins.primary)});};`));
        if (url.pathname === "/nested-content") return send(response, 200, page("Nested frame", `<button id="nested-button">Activate nested frame</button><output id="status">Nested ready</output>`, `document.getElementById('nested-button').onclick=()=>document.getElementById('status').textContent='Nested activated';`));
        if (url.pathname === "/popups") return send(response, 200, page("Popup fixture", `<button id="open-popup">Open popup</button><a id="popup-link" target="_blank" href="/popup-child">Open linked tab</a><output id="status">Waiting for popup</output>`, `document.getElementById('open-popup').onclick=()=>window.open('/popup-child','fixture-popup');window.addEventListener('message',event=>{if(event.origin===location.origin&&event.data==='fixture-popup-complete')document.getElementById('status').textContent='Popup completed';});`));
        if (url.pathname === "/popup-child") return send(response, 200, page("Popup child", `<button id="complete-popup">Complete popup</button><output id="status">Popup ready</output>`, `document.getElementById('complete-popup').onclick=()=>{opener?.postMessage('fixture-popup-complete',location.origin);document.getElementById('status').textContent='Completed';};`));
        if (url.pathname === "/dialogs") return send(response, 200, page("Dialog fixture", `<button id="alert">Alert</button><button id="confirm">Confirm</button><button id="prompt">Prompt</button><output id="status">Ready</output>`, `document.getElementById('alert').onclick=()=>{alert('Fixture alert');document.getElementById('status').textContent='Alert closed';};document.getElementById('confirm').onclick=()=>document.getElementById('status').textContent=confirm('Fixture confirmation')?'Confirmed':'Cancelled';document.getElementById('prompt').onclick=()=>{try{const value=prompt('Fixture prompt','');document.getElementById('status').textContent=value===null?'Prompt cancelled':'Prompt: '+value;}catch(error){document.getElementById('status').textContent='Prompt unavailable: '+error.message;}};`));
        if (url.pathname === "/canvas") return send(response, 200, page("Visual interaction fixture", `<p>The blue target is drawn inside the canvas. It has no DOM button.</p><canvas id="target" width="320" height="180"></canvas><output id="status">Canvas ready</output><div id="drag-source" class="drop" draggable="true">Drag item</div><div id="drop-target" class="drop">Drop here</div><output id="drag-status">Waiting for drop</output>`, `
const canvas=document.getElementById('target'),ctx=canvas.getContext('2d');ctx.fillStyle='#496edb';ctx.fillRect(60,60,200,60);ctx.fillStyle='white';ctx.font='18px sans-serif';ctx.fillText('Activate target',95,96);
canvas.onclick=event=>{const box=canvas.getBoundingClientRect(),x=(event.clientX-box.left)*canvas.width/box.width,y=(event.clientY-box.top)*canvas.height/box.height;if(x>=60&&x<=260&&y>=60&&y<=120)document.getElementById('status').textContent='Canvas activated';};
document.getElementById('drag-source').ondragstart=event=>event.dataTransfer.setData('text/plain','fixture-item');const drop=document.getElementById('drop-target');drop.ondragover=event=>event.preventDefault();drop.ondrop=event=>{event.preventDefault();if(event.dataTransfer.getData('text/plain')==='fixture-item')document.getElementById('drag-status').textContent='Item dropped';};`));
        if (url.pathname === "/files") return send(response, 200, page("File fixture", `<form id="upload"><label>Fixture file <input id="file" name="file" type="file" required></label><button>Upload file</button></form><a id="download" href="/download">Download fixture report</a><output id="status">No upload</output>`, `document.getElementById('upload').onsubmit=async event=>{event.preventDefault();const result=await(await fetch('/api/upload',{method:'POST',body:new FormData(event.target)})).json();document.getElementById('status').textContent=result.ok?'Uploaded '+result.name+' ('+result.bytes+' bytes)':result.error;};`));
        if (url.pathname === "/api/upload" && request.method === "POST") {
          const data = await body(request);
          const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(request.headers["content-type"] || "");
          if (!boundary) return json(response, 400, { error: "Expected multipart form data." });
          const headerEnd = data.indexOf("\r\n\r\n");
          const name = /filename="([^"\r\n]*)"/.exec(data.subarray(0, headerEnd).toString())?.[1];
          const end = data.indexOf(Buffer.from(`\r\n--${boundary[1] || boundary[2]}`), headerEnd + 4);
          if (!name || headerEnd < 0 || end < 0) return json(response, 400, { error: "Missing fixture file." });
          const content = data.subarray(headerEnd + 4, end);
          const upload = { name: name.split(/[\\/]/).pop(), bytes: content.length, content: content.toString("utf8") };
          uploads.push(upload);
          return json(response, 200, { ok: true, name: upload.name, bytes: upload.bytes });
        }
        if (url.pathname === "/download") return send(response, 200, DOWNLOAD, "text/plain", { "Content-Disposition": 'attachment; filename="fixture-report.txt"' });
        if (url.pathname === "/redirect") {
          const destination = new URL(url.searchParams.get("to") || `${origins.secondary}/frame-content`, origins[originName]);
          if (!allowed(destination.href)) return json(response, 400, { error: "Fixture redirects must stay on fixture origins." });
          return send(response, 302, "", "text/plain", { Location: destination.href });
        }
        return json(response, 404, { error: "Unknown fixture route." });
      } catch (error) { if (!response.headersSent) json(response, error.status || 500, { error: error.status ? error.message : "Fixture request failed." }); else response.destroy(); }
    };
  }
  try {
    for (const name of ["primary", "secondary"]) {
      const server = http.createServer(handler(name)); servers.push(server); origins[name] = await listen(server);
    }
    const proxy = http.createServer(async (request, response) => {
      let destination;
      try { destination = new URL(request.url); } catch { return send(response, 400, "Expected an absolute fixture URL.", "text/plain"); }
      if (!allowed(destination.href)) return send(response, 403, "Only browser fixture origins are supported.", "text/plain");
      try {
        const data = await body(request);
        const capture = { id: `capture-${captures.length + 1}`, method: request.method, url: destination.href,
          identity: String(request.headers["x-fixture-identity"] || "anonymous"), requestBody: data.subarray(0, MAX_CAPTURE).toString(), requestTruncated: data.length > MAX_CAPTURE, status: null, responseBody: "", responseTruncated: false };
        captures.push(capture);
        const headers = { ...request.headers, host: destination.host };
        delete headers["proxy-connection"]; delete headers["proxy-authorization"]; delete headers["x-fixture-identity"];
        const upstream = http.request(destination, { method: request.method, headers }, remote => {
          capture.status = remote.statusCode;
          response.writeHead(remote.statusCode, remote.headers);
          let size = 0; const chunks = [];
          remote.on("data", chunk => { if (size < MAX_CAPTURE) chunks.push(chunk.subarray(0, MAX_CAPTURE - size)); size += chunk.length; });
          remote.on("end", () => { capture.responseBody = Buffer.concat(chunks).toString(); capture.responseTruncated = size > MAX_CAPTURE; });
          remote.on("error", () => response.destroy());
          remote.pipe(response);
        });
        upstream.on("error", () => { if (!response.headersSent) send(response, 502, "Fixture origin unavailable.", "text/plain"); else response.destroy(); });
        response.on("close", () => upstream.destroy());
        upstream.end(data);
      } catch (error) { if (!response.headersSent) send(response, error.status || 500, "Fixture proxy request failed.", "text/plain"); }
    });
    proxy.on("connect", (_request, socket) => socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"));
    servers.push(proxy); origins.proxy = await listen(proxy);
    return Object.freeze({ origins: Object.freeze(origins), captures, uploads, download: DOWNLOAD, allows: allowed,
      async close() { if (closed) return; closed = true; await Promise.all(servers.map(close)); } });
  } catch (error) { await Promise.all(servers.map(server => server.listening ? close(server) : Promise.resolve())); throw error; }
}

module.exports = { startBrowserFixtures };
