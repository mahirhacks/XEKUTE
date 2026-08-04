const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createAssessmentWorkspace } = require("../src/domain/assessment/assessment-workspace");
const { createAssessmentMap, normalizeRoutePath } = require("../src/domain/assessment/assessment-map");

function fixture() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-map-"));
  const root = path.join(parent, "assessment");
  const assessmentWorkspace = createAssessmentWorkspace({ fs, path });
  assessmentWorkspace.repair(root, { createRoot: true });
  const map = createAssessmentMap({
    fs,
    path,
    crypto,
    assessmentWorkspace,
    now: () => new Date("2026-07-12T08:00:00.000Z"),
  });
  return { parent, root, assessmentWorkspace, map };
}

function exchange(requestId, url, {
  statusCode = 200,
  cookie = "sid=user-a",
  responseBody = '{"id":272,"email":"a@example.com"}',
  responseContentType = "application/json",
  responseHeaders = {},
  requestHeaders = {},
  requestBody = "",
  requestContentType = "application/json",
  method = "GET",
} = {}) {
  const parsed = new URL(url);
  const requestHeaderLines = Object.entries(requestHeaders).map(([name, value]) => `${name}: ${value}`).join("\r\n");
  const responseHeaderLines = Object.entries(responseHeaders).map(([name, value]) => `${name}: ${value}`).join("\r\n");
  return {
    tool: "interceptor",
    requestId,
    method,
    url,
    statusCode,
    request: `${method} ${parsed.pathname}${parsed.search} HTTP/1.1\r\nHost: ${parsed.host}\r\nCookie: ${cookie}\r\nAccept: application/json\r\nContent-Type: ${requestContentType}\r\n${requestHeaderLines}${requestHeaderLines ? "\r\n" : ""}\r\n${requestBody}`,
    response: `HTTP/1.1 ${statusCode} OK\r\nContent-Type: ${responseContentType}\r\n${responseHeaderLines}${responseHeaderLines ? "\r\n" : ""}\r\n${responseBody}`,
  };
}

test("route normalization deduplicates dynamic identifiers while retaining parameter meaning", () => {
  assert.deepEqual(normalizeRoutePath("/customers/272/orders/550e8400-e29b-41d4-a716-446655440000"), {
    template: "/customers/{customer_id}/orders/{order_id}",
    parameters: [
      { name: "customer_id", location: "path", category: "id", observedValue: "272" },
      { name: "order_id", location: "path", category: "id", observedValue: "550e8400-e29b-41d4-a716-446655440000" },
    ],
  });
});

test("Map building remains available when an unrelated assessment file differs from its template", () => {
  const { parent, root, assessmentWorkspace, map } = fixture();
  fs.writeFileSync(path.join(root, "enumeration", "assets.json"), "[]\n", "utf8");
  assert.equal(assessmentWorkspace.verify(root).valid, false);
  assessmentWorkspace.appendTrafficRecord(root, exchange("advisory-map", "https://app.example/"));
  const built = map.build(root);
  assert.equal(built.ok, true);
  assert.equal(built.graph.stats.routes, 1);
  fs.rmSync(parent, { recursive: true, force: true });
});

test("behavior Map builds a stable, deduplicated, evidence-preserving route graph", () => {
  const { parent, root, assessmentWorkspace, map } = fixture();
  assert.equal(map.read(root).exists, false);

  assessmentWorkspace.appendTrafficRecord(root, exchange("req-own", "https://shop.example/customers/272"));
  assessmentWorkspace.appendTrafficRecord(root, exchange("req-foreign", "https://shop.example/customers/391"));
  assessmentWorkspace.appendTrafficRecord(root, exchange("req-denied", "https://shop.example/customers/845", { statusCode: 403, cookie: "" }));
  assessmentWorkspace.appendTrafficRecord(root, exchange("req-orders", "https://shop.example/orders/99", { method: "POST", responseBody: '{"id":99,"status":"created"}' }));
  assessmentWorkspace.appendTrafficRecord(root, exchange("req-static", "https://shop.example/assets/app.js", { responseBody: "console.log(1)" }));

  const built = map.build(root);
  assert.equal(built.ok, true);
  assert.equal(built.graph.stats.observations, 5);
  assert.equal(built.graph.stats.routes, 3);
  assert.equal(built.graph.stats.hiddenRoutes, 1);
  assert.ok(built.graph.stats.transitions >= 1);
  assert.equal(built.graph.source.path, "traffic/raw.jsonl");
  assert.equal(built.graph.filters.hiddenEvidencePreserved, true);

  const customer = built.graph.nodes.find((node) => node.type === "Route" && node.template === "/customers/{customer_id}");
  assert.ok(customer);
  assert.equal(customer.observedCount, 3);
  assert.deepEqual(customer.statusCodes, [200, 403]);
  assert.equal(customer.variants.length, 2);
  assert.deepEqual(new Set(customer.variants.flatMap((variant) => variant.evidenceIds)), new Set(["req-own", "req-foreign", "req-denied"]));
  assert.ok(customer.riskTags.includes("object_identifier"));
  assert.ok(customer.riskTags.includes("sensitive_response"));

  const staticRoute = built.graph.nodes.find((node) => node.type === "Route" && node.template === "/assets/app.js");
  assert.equal(staticRoute.visibility, "hidden");
  assert.equal(staticRoute.filterReason, "static_asset");

  const persisted = map.read(root);
  assert.equal(persisted.exists, true);
  assert.equal(persisted.graph.builtAt, "2026-07-12T08:00:00.000Z");
  assert.equal(fs.existsSync(path.join(root, "Map", "application-map.json")), true);

  const rebuilt = map.build(root);
  assert.deepEqual(rebuilt.graph.nodes.map((node) => node.id), built.graph.nodes.map((node) => node.id));
  fs.rmSync(parent, { recursive: true, force: true });
});

test("multi-pass connectivity links a late root response, subdomains, referrers, and shared objects", () => {
  const { parent, root, assessmentWorkspace, map } = fixture();
  assessmentWorkspace.appendTrafficRecord(root, exchange("req-about", "https://leadbondhuai.online/about", {
    requestHeaders: { Referer: "https://leadbondhuai.online/" },
  }));
  assessmentWorkspace.appendTrafficRecord(root, exchange("req-api", "https://api.leadbondhuai.online/leads/42", {
    responseBody: '{"lead_id":42,"name":"Test lead"}',
  }));
  assessmentWorkspace.appendTrafficRecord(root, exchange("req-audit", "https://leadbondhuai.online/lead-audit", {
    responseBody: '{"lead_id":42,"action":"viewed"}',
  }));
  assessmentWorkspace.appendTrafficRecord(root, exchange("req-root", "https://leadbondhuai.online/", {
    responseContentType: "text/html",
    responseBody: '<html><body><a href="/about">About</a><a href="https://auth.leadbondhuai.online/login">Login</a><script>fetch("https://api.leadbondhuai.online/leads/42")</script></body></html>',
  }));

  const built = map.build(root);
  assert.equal(built.ok, true);
  assert.equal(built.graph.schemaVersion, 3);
  assert.equal(built.graph.analysisModel, "auditable-multi-pass-connectivity");
  assert.equal(built.graph.verification.verified, true);
  assert.equal(built.graph.verification.checkedNodes, built.graph.nodes.length);
  assert.equal(built.graph.verification.checkedEdges, built.graph.edges.length);
  assert.equal(built.graph.verification.danglingEdges, 0);
  assert.equal(built.graph.verification.orphanRoutes, 0);

  const route = (host, template) => built.graph.nodes.find((node) => node.type === "Route" && node.host === host && node.template === template);
  const rootRoute = route("leadbondhuai.online", "/");
  const aboutRoute = route("leadbondhuai.online", "/about");
  const apiRoute = route("api.leadbondhuai.online", "/leads/{lead_id}");
  const discoveredAuthRoute = route("auth.leadbondhuai.online", "/login");
  const auditRoute = route("leadbondhuai.online", "/lead-audit");
  assert.ok(rootRoute?.entryPointReasons.some((reason) => reason.type === "root-route"), "GET / should be a first-class entry-point node");
  assert.ok(aboutRoute);
  assert.ok(apiRoute, "the api subdomain route should be captured independently");
  assert.equal(discoveredAuthRoute?.observed, false, "a subdomain referenced only inside a response should still be represented");
  assert.ok(auditRoute);

  const hasEdge = (source, target, type) => built.graph.edges.some((edge) => edge.source === source.id && edge.target === target.id && edge.type === type);
  assert.equal(hasEdge(rootRoute, aboutRoute, "LINKS_TO"), true, "a later root response should connect an earlier /about observation");
  assert.equal(hasEdge(rootRoute, aboutRoute, "REFERRED_TO"), true, "request referrers should independently confirm the route connection");
  assert.equal(hasEdge(rootRoute, apiRoute, "LINKS_TO"), true, "absolute response URLs should connect across subdomains");
  assert.equal(hasEdge(rootRoute, discoveredAuthRoute, "LINKS_TO"), true);
  const discoveredLink = built.graph.edges.find((edge) => edge.source === rootRoute.id && edge.target === discoveredAuthRoute.id && edge.type === "LINKS_TO");
  assert.equal(discoveredLink.observationType, "discovered");
  assert.equal(discoveredLink.provenanceSamples[0].location, "response.body");
  assert.equal(discoveredLink.provenanceSamples[0].extractor, "html-tag-parser");
  assert.equal(built.graph.edges.some((edge) => edge.type === "SUBDOMAIN_OF"), true);
  assert.equal(built.graph.edges.some((edge) => edge.type === "REFERENCES_HOST"), true);
  assert.equal(
    built.graph.edges.some((edge) => edge.type === "SHARES_OBJECT" && [edge.source, edge.target].includes(apiRoute.id) && [edge.source, edge.target].includes(auditRoute.id)),
    true,
    "matching lead_id evidence should bridge routes even when it appears in a later exchange",
  );
  assert.equal(built.graph.stats.components, 1);
  fs.rmSync(parent, { recursive: true, force: true });
});

test("route identity separates scheme and effective port while deduplicating explicit defaults", () => {
  const { parent, root, assessmentWorkspace, map } = fixture();
  [
    ["http-default", "http://app.example/admin"],
    ["http-explicit", "http://app.example:80/admin"],
    ["https-default", "https://app.example/admin"],
    ["https-explicit", "https://app.example:443/admin"],
    ["https-alt", "https://app.example:8443/admin"],
  ].forEach(([id, url]) => assessmentWorkspace.appendTrafficRecord(root, exchange(id, url)));
  const graph = map.build(root).graph;
  const routes = graph.nodes.filter((node) => node.type === "Route" && node.template === "/admin");
  assert.equal(routes.length, 3);
  assert.deepEqual(routes.map((node) => `${node.scheme}:${node.port}`).sort(), ["http:80", "https:443", "https:8443"]);
  assert.equal(new Set(routes.map((node) => node.id)).size, 3);
  fs.rmSync(parent, { recursive: true, force: true });
});

test("discovered routes retain method evidence, origin, and extractor provenance without ROOT_OF", () => {
  const { parent, root, assessmentWorkspace, map } = fixture();
  assessmentWorkspace.appendTrafficRecord(root, exchange("root", "https://app.example/", {
    cookie: "",
    responseContentType: "text/html",
    responseBody: '<a href="/about">About</a><form method="POST" action="/login"></form><script>fetch("/api/jobs", {method: "PATCH"})</script>',
  }));
  assessmentWorkspace.appendTrafficRecord(root, exchange("isolated", "https://app.example/isolated", { cookie: "" }));
  const graph = map.build(root).graph;
  const route = (method, template) => graph.nodes.find((node) => node.type === "Route" && node.method === method && node.template === template);
  assert.equal(route("GET", "/")?.observationType, "observed");
  assert.equal(route("GET", "/")?.confidence, 1);
  assert.equal(route("GET", "/about")?.observationType, "discovered");
  assert.ok(route("GET", "/about")?.methodConfidence < 1);
  assert.equal(route("POST", "/login")?.methodConfidence, 0.99);
  assert.equal(route("PATCH", "/api/jobs")?.methodConfidence, 0.99);
  assert.equal(route("GET", "/login"), undefined, "form actions must not also create guessed GET routes");
  assert.equal(graph.edges.some((edge) => edge.type === "ROOT_OF"), false);
  assert.ok(graph.edges.every((edge) => edge.observationType && typeof edge.semantic === "boolean"));
  const loginEdge = graph.edges.find((edge) => edge.type === "LINKS_TO" && edge.target === route("POST", "/login").id);
  assert.equal(loginEdge.provenanceSamples[0].extractor, "html-tag-parser");
  assert.equal(loginEdge.provenanceSamples[0].selector, "form[action]");
  assert.equal(graph.nodes.find((node) => node.type === "Route" && node.template === "/isolated").entryPointReasons.some((reason) => reason.type === "no-observed-incoming-navigation"), true);
  fs.rmSync(parent, { recursive: true, force: true });
});

test("project-scoped HMAC correlation is private, stable, and different across projects", () => {
  const first = fixture();
  const second = fixture();
  for (const current of [first, second]) {
    current.assessmentWorkspace.appendTrafficRecord(current.root, exchange("produce", "https://app.example/leads/272", {
      cookie: "sid=super-secret-session",
      responseBody: '{"lead_id":272,"email":"secret@example.com"}',
    }));
    current.assessmentWorkspace.appendTrafficRecord(current.root, exchange("consume", "https://app.example/lead-audit", {
      cookie: "sid=super-secret-session",
      method: "POST",
      requestBody: '{"lead_id":272}',
      responseBody: '{"ok":true}',
    }));
  }
  const firstGraph = first.map.build(first.root).graph;
  const rebuilt = first.map.build(first.root).graph;
  const secondGraph = second.map.build(second.root).graph;
  const correlation = (graph) => graph.edges.find((edge) => edge.type === "SHARES_OBJECT")?.correlation?.fingerprint;
  assert.match(correlation(firstGraph), /^hmac:[0-9a-f]{64}$/);
  assert.equal(correlation(rebuilt), correlation(firstGraph));
  assert.notEqual(correlation(secondGraph), correlation(firstGraph));
  const serialized = JSON.stringify(firstGraph);
  assert.doesNotMatch(serialized, /super-secret-session|secret@example\.com|"272"/);
  assert.equal(firstGraph.verification.leakedSecrets, 0);
  assert.equal(fs.existsSync(path.join(first.root, "Map", ".correlation-key")), true);
  fs.rmSync(first.parent, { recursive: true, force: true });
  fs.rmSync(second.parent, { recursive: true, force: true });
});

test("workflow transitions aggregate by sorted authenticated sessions and exclude anonymous adjacency", () => {
  const { parent, root, assessmentWorkspace, map } = fixture();
  const timed = (id, url, cookie, isoTimestamp) => ({ ...exchange(id, url, { cookie, method: url.includes("login") ? "POST" : "GET" }), isoTimestamp });
  [
    timed("a-dash-2", "https://app.example/dashboard", "sid=a", "2026-07-12T10:05:05.000Z"),
    timed("b-login", "https://app.example/login", "sid=b", "2026-07-12T10:01:00.000Z"),
    timed("a-login-1", "https://app.example/login", "sid=a", "2026-07-12T10:00:00.000Z"),
    timed("b-dash", "https://app.example/dashboard", "sid=b", "2026-07-12T10:01:05.000Z"),
    timed("a-login-2", "https://app.example/login", "sid=a", "2026-07-12T10:05:00.000Z"),
    timed("a-dash-1", "https://app.example/dashboard", "sid=a", "2026-07-12T10:00:05.000Z"),
    timed("anon-one", "https://app.example/public-a", "", "2026-07-12T11:00:00.000Z"),
    timed("anon-two", "https://app.example/public-b", "", "2026-07-12T11:00:01.000Z"),
  ].forEach((record) => assessmentWorkspace.appendTrafficRecord(root, record));
  const graph = map.build(root).graph;
  const route = (method, template) => graph.nodes.find((node) => node.type === "Route" && node.method === method && node.template === template);
  const transition = graph.edges.find((edge) => edge.type === "FOLLOWED_BY" && edge.source === route("POST", "/login").id && edge.target === route("GET", "/dashboard").id);
  assert.equal(transition.transitionCount, 3);
  assert.equal(transition.distinctSessions, 2);
  assert.equal(transition.supportCount, 3);
  const publicA = route("GET", "/public-a"); const publicB = route("GET", "/public-b");
  assert.equal(graph.edges.some((edge) => edge.type === "FOLLOWED_BY" && edge.source === publicA.id && edge.target === publicB.id), false);
  fs.rmSync(parent, { recursive: true, force: true });
});

test("unchanged input rebuilds idempotently with stable snapshot and builder metadata", () => {
  const { parent, root, assessmentWorkspace, map } = fixture();
  assessmentWorkspace.appendTrafficRecord(root, exchange("one", "https://app.example/"));
  fs.appendFileSync(path.join(root, "traffic", "raw.jsonl"), "not-json\n", "utf8");
  const first = map.build(root).graph;
  const second = map.build(root).graph;
  assert.deepEqual(second, first);
  assert.equal(first.schemaVersion, 3);
  assert.equal(first.builderVersion, "0.4.0");
  assert.match(first.source.snapshotHash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(first.source.failedCount, 1);
  assert.ok(first.source.warnings.some((warning) => warning.includes("malformed")));
  assert.ok(first.passReports.length >= 8);
  assert.deepEqual(fs.readdirSync(path.join(root, "Map")).filter((name) => name.endsWith(".tmp")), []);
  fs.rmSync(parent, { recursive: true, force: true });
});

test("Map exposes bounded AI queries, summaries, hypotheses, and provenance-safe annotations", () => {
  const { parent, root, assessmentWorkspace, map } = fixture();
  assessmentWorkspace.appendTrafficRecord(root, exchange("one", "https://shop.example/customers/272"));
  assessmentWorkspace.appendTrafficRecord(root, exchange("two", "https://shop.example/customers/391", { cookie: "sid=user-b" }));
  const graph = map.build(root).graph;
  const route = graph.nodes.find((node) => node.type === "Route" && node.template.includes("customer_id"));
  assert.ok(route);
  assert.match(route.aiSummary, /customers/);
  assert.ok(graph.analysis.queryCapabilities.includes("paths"));
  assert.ok(Array.isArray(graph.hypotheses));

  const overview = map.getOverview(root);
  assert.equal(overview.ok, true);
  assert.equal(overview.overview.routes, graph.stats.routes);
  assert.equal(map.getNode(root, route.id).node.aiSummary, route.aiSummary);
  assert.ok(map.searchRoutes(root, "customers").routes.some((node) => node.id === route.id));
  assert.ok(map.getNeighbors(root, route.id).neighbors.length >= 0);
  assert.ok(map.getEvidence(root, "one").evidence[0].request.includes("[REDACTED]"));

  const annotation = map.annotateFinding(root, { hypothesis: "possible_idor", routes: [route.id], result: "untested" });
  assert.equal(annotation.ok, true);
  assert.equal(annotation.annotation.source, "agent-asserted");
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, "Map", "agent-annotations.json"), "utf8"))[0].source, "agent-asserted");
  assert.ok(map.getHypotheses(root).hypotheses.some((item) => item.annotationId === annotation.annotation.id || item.id === annotation.annotation.id));
  fs.rmSync(parent, { recursive: true, force: true });
});

test("Map builds from passive-recon observations when no traffic exists (passive seed)", () => {
  const { parent, root, assessmentWorkspace, map } = fixture();
  // Seed passive-recon discovered assets but no Traffic/Raw.
  const passiveTarget = path.join(root, "recon", "passive-recon.json");
  const passiveDoc = JSON.parse(fs.readFileSync(passiveTarget, "utf8"));
  passiveDoc.discoveredAssets = [
    { type: "domain", value: "shop.example.com", source: "dns-crt-sh", confidence: "medium" },
    { type: "url", value: "https://shop.example.com/api/login", source: "robots-parse", confidence: "high" },
    { type: "domain", value: "cdn.shop.example.com", source: "dns-crt-sh", confidence: "low" },
  ];
  fs.writeFileSync(passiveTarget, JSON.stringify(passiveDoc, null, 2));

  const built = map.build(root);
  assert.equal(built.ok, true, built.error);
  assert.equal(built.graph.source.origin, "passive-seed");
  assert.equal(built.graph.source.seededFromPassive, 3);
  assert.equal(built.graph.source.path, "recon/passive-recon.json");
  assert.equal(built.graph.stats.hosts, 2);
  assert.equal(built.graph.stats.routes, 1);
  assert.ok(built.graph.nodes.filter((n) => n.type === "Route").every((n) => n.discoveredBy.length > 0));

  // After seeding, annotation no longer dead-ends on MAP_NOT_BUILT.
  const route = built.graph.nodes.find((n) => n.type === "Route");
  const annotation = map.annotateFinding(root, { hypothesis: "passive_route", routes: [route.id], result: "untested" });
  assert.equal(annotation.ok, true);

  fs.rmSync(parent, { recursive: true, force: true });
});

test("redirect semantics and Public Suffix List topology remain precise", () => {
  const { parent, root, assessmentWorkspace, map } = fixture();
  assessmentWorkspace.appendTrafficRecord(root, exchange("preserve", "https://app.example.co.uk/submit", {
    method: "POST", statusCode: 307, responseHeaders: { Location: "/continue" }, responseBody: "",
  }));
  assessmentWorkspace.appendTrafficRecord(root, exchange("switch", "https://app.example.co.uk/finish", {
    method: "POST", statusCode: 303, responseHeaders: { Location: "/done" }, responseBody: "",
  }));
  const graph = map.build(root).graph;
  const route = (method, template) => graph.nodes.find((node) => node.type === "Route" && node.method === method && node.template === template);
  assert.ok(route("POST", "/continue"), "307 should preserve the originating method");
  assert.ok(route("GET", "/done"), "303 should resolve as a GET destination");
  const appHost = graph.nodes.find((node) => node.type === "Host" && node.host === "app.example.co.uk");
  const parentHost = graph.nodes.find((node) => node.type === "Host" && node.host === "example.co.uk");
  assert.ok(parentHost);
  assert.equal(graph.nodes.some((node) => node.type === "Host" && node.host === "co.uk"), false);
  assert.equal(graph.edges.some((edge) => edge.type === "SUBDOMAIN_OF" && edge.source === appHost.id && edge.target === parentHost.id), true);
  fs.rmSync(parent, { recursive: true, force: true });
});
