"use strict";

const GRAPH_DIRECTORY = "traffic/graph";
const GRAPH_MANIFEST = `${GRAPH_DIRECTORY}/manifest.json`;
const GRAPH_CACHE_MANIFEST = `${GRAPH_DIRECTORY}/cache/source-manifest.json`;
const LEGACY_GRAPH = "Map/application-map.json";

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function snapshotFileStem(date) {
  return date.toISOString().replace(/:/g, "-").replace(/\.(\d{3})Z$/, "-$1Z");
}

function isGraphSnapshotPath(relative = "") {
  return /^traffic\/graph\/[^/\\]+\.json$/i.test(String(relative || "").replace(/\\/g, "/"));
}

function materialGraphProjection(graph) {
  const clone = JSON.parse(JSON.stringify(graph || {}));
  delete clone.builtAt;
  delete clone.snapshot;
  delete clone.intelligence;
  if (clone.source) {
    delete clone.source.warnings;
  }
  return clone;
}

function publicGraphProjection(graph) {
  const strip = (value, key = "") => {
    if (["evidenceId", "evidenceIds", "evidenceRefs", "evidenceSample", "representativeEvidenceId", "requestId", "trafficId", "objectPath", "sourceRef", "canonicalKey", "contentHash", "rootHash", "correlation"].includes(key)) return undefined;
    if (Array.isArray(value)) return value.map((item) => strip(item)).filter((item) => item !== undefined);
    if (value && typeof value === "object") {
      const out = {};
      for (const [name, child] of Object.entries(value)) {
        const projected = strip(child, name);
        if (projected !== undefined) out[name] = projected;
      }
      return out;
    }
    return value;
  };
  return strip({
    kind: graph.kind,
    schemaVersion: graph.schemaVersion,
    builderVersion: graph.builderVersion,
    builtAt: graph.builtAt,
    stats: graph.stats,
    stateModel: graph.stateModel || null,
    communities: graph.communities || [],
    nodes: graph.nodes || [],
    edges: graph.edges || [],
  });
}

function safeEmbeddedJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

function renderStandaloneGraphHtml(graph) {
  const payload = safeEmbeddedJson(publicGraphProjection(graph));
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>XEKUTE Application Graph</title>
<style>
:root{color-scheme:dark;font:13px/1.4 Segoe UI,Arial,sans-serif;background:#111;color:#ddd}*{box-sizing:border-box}body{margin:0;overflow:hidden}.top{height:54px;display:flex;align-items:center;gap:14px;padding:0 18px;border-bottom:1px solid #303030;background:#181818}.top strong{font-size:15px;color:#fff}.top span{color:#8b8b8b}.top input{margin-left:auto;width:min(360px,34vw);background:transparent;border:0;border-bottom:1px solid #555;color:#eee;padding:7px 2px;outline:0}.layout{height:calc(100vh - 54px);display:grid;grid-template-columns:1fr 320px}.stage{position:relative;overflow:hidden;background:radial-gradient(circle at center,#1b1b1b,#121212 70%)}svg{width:100%;height:100%}.edge{stroke:#49647a;stroke-opacity:.42;fill:none}.node circle{fill:#292929;stroke:#6e9fc4;stroke-width:1.5}.node.Route circle{fill:#26323a}.node.Host circle{fill:#163d59}.node.JavaScript circle{fill:#5b4618;stroke:#d7b85a}.node.Identity circle{fill:#442b5f;stroke:#b894dc}.node.ResponseVariant circle{fill:#384026;stroke:#a4bd73}.node.Parameter circle{fill:#3b3030;stroke:#b78484}.node.ApplicationState circle{fill:#194d4b;stroke:#57c7c1}.node.Action circle{fill:#4d3b1d;stroke:#d7a84f}.node.Workflow circle{fill:#263d5b;stroke:#6da4df}.node.BusinessObject circle{fill:#20504f;stroke:#56aaa7}.node text{fill:#d8d8d8;font-size:10px;pointer-events:none}.node.risk circle{stroke:#f48771;stroke-width:2}.node.dim{opacity:.1}.side{overflow:auto;border-left:1px solid #303030;background:#181818;padding:16px}.side h2{font-size:14px;margin:0 0 8px;color:#fff}.side .muted{color:#888}.stats{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:14px 0}.stats div{background:#212121;border:1px solid #303030;border-radius:5px;padding:9px}.stats strong{display:block;font-size:18px;color:#fff}.tags{display:flex;flex-wrap:wrap;gap:5px}.tags span{border:1px solid #444;border-radius:10px;padding:2px 7px;color:#aaa}.legend{position:absolute;left:14px;bottom:14px;background:#181818dd;border:1px solid #333;border-radius:5px;padding:8px 10px;color:#999}.legend i{display:inline-block;width:8px;height:8px;border-radius:50%;margin:0 4px 0 10px}.legend i:first-child{margin-left:0}.empty{color:#777;padding-top:20px}.node{cursor:pointer}
</style></head><body>
<header class="top"><strong>XEKUTE Application Graph</strong><span id="summary"></span><input id="search" type="search" placeholder="Filter nodes, routes, identities, or scripts"></header>
<main class="layout"><section class="stage"><svg id="graph" viewBox="0 0 1400 900" role="img" aria-label="Application behavior graph"></svg><div class="legend"><i style="background:#3686b9"></i>Host <i style="background:#506b7a"></i>Route <i style="background:#ad8b35"></i>JavaScript <i style="background:#815baa"></i>Identity</div></section><aside class="side"><h2 id="title">Select a node</h2><div id="detail" class="empty">Select a node to inspect its deterministic, sanitized projection. Raw traffic remains in XEKUTE and is not embedded in this viewer.</div></aside></main>
<script>
const data=${payload};const svg=document.getElementById('graph'),detail=document.getElementById('detail'),title=document.getElementById('title'),search=document.getElementById('search');
document.getElementById('summary').textContent=(data.nodes?.length||0)+' nodes · '+(data.edges?.length||0)+' relationships · '+(data.communities?.length||0)+' communities';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nodes=data.nodes||[],edges=data.edges||[],byId=new Map(nodes.map(n=>[n.id,n]));
function position(n,i){const group=Math.max(0,Number(n.communityIndex)||0),groups=Math.max(1,data.communities?.length||1),a=(i*2.399963)+(group/groups)*Math.PI*2,r=90+Math.sqrt(i+1)*29;return{x:700+Math.cos(a)*Math.min(r,590),y:450+Math.sin(a)*Math.min(r,370)}}
const pos=new Map(nodes.map(position).map((p,i)=>[nodes[i].id,p]));
function render(q=''){q=q.trim().toLowerCase();const match=new Set(nodes.filter(n=>!q||JSON.stringify([n.label,n.type,n.host,n.template,n.method,n.riskTags]).toLowerCase().includes(q)).map(n=>n.id));const lines=edges.filter(e=>byId.has(e.source)&&byId.has(e.target)).map(e=>{const a=pos.get(e.source),b=pos.get(e.target);return '<line class="edge" x1="'+a.x+'" y1="'+a.y+'" x2="'+b.x+'" y2="'+b.y+'"><title>'+esc(e.type)+'</title></line>'}).join('');const points=nodes.map((n,i)=>{const p=pos.get(n.id),r=n.type==='Host'?12:n.type==='JavaScript'?9:7,label=String(n.label||n.type),dim=!match.has(n.id),priority=Number(n.priorityScore??n.riskScore)||0;return '<g class="node '+esc(n.type)+' '+(priority>=70?'risk ':'')+(dim?'dim':'')+'" transform="translate('+p.x+' '+p.y+')" data-index="'+i+'"><circle r="'+r+'"></circle><text x="'+(r+5)+'" y="3">'+esc(label.length>34?label.slice(0,33)+'…':label)+'</text></g>'}).join('');svg.innerHTML=lines+points;svg.querySelectorAll('.node').forEach(el=>el.onclick=()=>inspect(nodes[Number(el.dataset.index)]))}
function inspect(n){title.textContent=n.label||n.type;const rows=[['Type',n.type],['Method',n.method],['Host',n.host],['Route',n.template],['Observed',n.observedCount],['Confidence',n.confidence],['Community',n.communityLabel],['Priority',n.priorityScore??n.riskScore],['Priority tier',n.priorityTier]].filter(x=>x[1]!==undefined&&x[1]!==''&&x[1]!==null);detail.className='';detail.innerHTML=rows.map(x=>'<p><span class="muted">'+esc(x[0])+'</span><br>'+esc(x[1])+'</p>').join('')+(n.aiSummary?'<p>'+esc(n.aiSummary)+'</p>':'')+((n.riskTags||[]).length?'<div class="tags">'+n.riskTags.map(x=>'<span>'+esc(x)+'</span>').join('')+'</div>':'')}
search.addEventListener('input',()=>render(search.value));render();
</script></body></html>`;
}

function createTrafficGraphStore({ fs, path, crypto, now = () => new Date() } = {}) {
  if (!fs || !path || !crypto?.createHash || !crypto?.randomBytes) throw new TypeError("fs, path, and crypto are required");
  const rootOf = (workspace) => path.resolve(String(workspace || ""));
  const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");
  const absolute = (workspace, relative) => path.join(rootOf(workspace), ...String(relative).split("/"));

  function atomicWrite(target, content) {
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    const temporary = `${target}.${crypto.randomBytes(6).toString("hex")}.tmp`;
    try {
      fs.writeFileSync(temporary, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
      fs.renameSync(temporary, target);
    } finally { if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true }); }
  }

  function readManifest(workspace) {
    const target = absolute(workspace, GRAPH_MANIFEST);
    if (!fs.existsSync(target)) return null;
    try {
      const value = JSON.parse(fs.readFileSync(target, "utf8"));
      return value?.kind === "xekute-traffic-graph-manifest" && Array.isArray(value.snapshots) ? value : null;
    } catch { return null; }
  }

  function readGraphFile(workspace, relative) {
    if (!isGraphSnapshotPath(relative) && relative !== LEGACY_GRAPH) return null;
    try {
      const graph = JSON.parse(fs.readFileSync(absolute(workspace, relative), "utf8"));
      if (graph?.kind !== "xekute-application-behavior-map" || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) return null;
      return graph;
    } catch { return null; }
  }

  function read(workspace) {
    const manifest = readManifest(workspace);
    if (manifest) {
      const candidates = [manifest.latest, ...manifest.snapshots.slice().reverse()].filter(Boolean);
      const seen = new Set();
      for (const snapshot of candidates) {
        if (!snapshot.file || seen.has(snapshot.file)) continue;
        seen.add(snapshot.file);
        const graph = readGraphFile(workspace, snapshot.file);
        if (graph) return { ok: true, exists: true, path: snapshot.file, htmlPath: snapshot.viewer || "", graph, manifest, recovered: snapshot.file !== manifest.latest?.file };
      }
    }
    try {
      const directory = absolute(workspace, GRAPH_DIRECTORY);
      const recoveredFiles = fs.existsSync(directory)
        ? fs.readdirSync(directory)
          .filter((name) => name !== "manifest.json" && /^[^/\\]+\.json$/i.test(name))
          .map((name) => ({ name, modified: fs.statSync(path.join(directory, name)).mtimeMs }))
          .sort((a, b) => b.modified - a.modified || b.name.localeCompare(a.name, undefined, { numeric: true }))
        : [];
      for (const { name } of recoveredFiles) {
        const relative = `${GRAPH_DIRECTORY}/${name}`;
        const graph = readGraphFile(workspace, relative);
        if (graph) return { ok: true, exists: true, path: relative, htmlPath: relative.replace(/\.json$/i, ".html"), graph, manifest, recovered: true };
      }
    } catch { /* Fall through to the non-destructive legacy reader. */ }
    const legacy = readGraphFile(workspace, LEGACY_GRAPH);
    if (legacy) return { ok: true, exists: true, path: LEGACY_GRAPH, htmlPath: "", graph: legacy, manifest: null, legacy: true };
    return { ok: true, exists: false, path: GRAPH_MANIFEST, htmlPath: "", graph: null, manifest };
  }

  function persist(workspace, graph) {
    const root = rootOf(workspace);
    const contentHash = `sha256:${digest(canonicalJson(materialGraphProjection(graph)))}`;
    const existing = read(root);
    if (existing.exists && existing.manifest?.latest?.contentHash === contentHash) {
      return { ok: true, exists: true, unchanged: true, path: existing.path, htmlPath: existing.htmlPath, graph: existing.graph, manifest: existing.manifest };
    }
    const createdAt = now();
    let stem = snapshotFileStem(createdAt);
    let suffix = 1;
    while (fs.existsSync(absolute(root, `${GRAPH_DIRECTORY}/${stem}.json`))) stem = `${snapshotFileStem(createdAt)}-${suffix++}`;
    const jsonRelative = `${GRAPH_DIRECTORY}/${stem}.json`;
    const htmlRelative = `${GRAPH_DIRECTORY}/${stem}.html`;
    const snapshotId = `graph:${digest(`${contentHash}|${stem}`).slice(0, 24)}`;
    const persistedGraph = { ...graph, builtAt: createdAt.toISOString(), snapshot: { id: snapshotId, contentHash, json: jsonRelative, html: htmlRelative } };
    atomicWrite(absolute(root, jsonRelative), `${JSON.stringify(persistedGraph, null, 2)}\n`);
    atomicWrite(absolute(root, htmlRelative), renderStandaloneGraphHtml(persistedGraph));
    const previous = existing.manifest || { kind: "xekute-traffic-graph-manifest", schemaVersion: 1, createdAt: createdAt.toISOString(), snapshots: [], migration: existing.legacy ? { source: LEGACY_GRAPH, preserved: true, migratedAt: createdAt.toISOString() } : null };
    const snapshot = { id: snapshotId, createdAt: createdAt.toISOString(), contentHash, file: jsonRelative, viewer: htmlRelative, stats: persistedGraph.stats || {}, source: { traffic: persistedGraph.source?.snapshotHash || "", javascript: persistedGraph.source?.javascriptSnapshotHash || "" } };
    const manifest = {
      ...previous,
      kind: "xekute-traffic-graph-manifest",
      schemaVersion: 1,
      updatedAt: createdAt.toISOString(),
      latest: snapshot,
      snapshots: [...(previous.snapshots || []).filter((item) => item.id !== snapshot.id), snapshot].slice(-5000),
    };
    atomicWrite(absolute(root, GRAPH_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
    atomicWrite(absolute(root, GRAPH_CACHE_MANIFEST), `${JSON.stringify({
      kind: "xekute-traffic-graph-source-cache",
      schemaVersion: 1,
      updatedAt: createdAt.toISOString(),
      contentHash,
      latestSnapshot: snapshotId,
      sources: snapshot.source,
      builderVersion: persistedGraph.builderVersion || "",
    }, null, 2)}\n`);
    return { ok: true, exists: true, unchanged: false, path: jsonRelative, htmlPath: htmlRelative, graph: persistedGraph, manifest };
  }

  return Object.freeze({ read, persist, readManifest, manifestRelativePath: GRAPH_MANIFEST, legacyRelativePath: LEGACY_GRAPH });
}

module.exports = {
  GRAPH_DIRECTORY,
  GRAPH_MANIFEST,
  GRAPH_CACHE_MANIFEST,
  LEGACY_GRAPH,
  createTrafficGraphStore,
  materialGraphProjection,
  publicGraphProjection,
  renderStandaloneGraphHtml,
  isGraphSnapshotPath,
  snapshotFileStem,
};
