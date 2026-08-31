"use strict";

const MAX_DECODED_TEXT = 2 * 1024 * 1024;
const MAX_REGEX_LENGTH = 512;

const OPERATOR_DEFINITIONS = Object.freeze([
  { name: "source", category: "Sources", description: "Limit results to traffic, JavaScript, evidence, tools, map, assets, code, or workspace.", values: ["traffic", "javascript", "evidence", "tool", "map", "asset", "code", "workspace"] },
  { name: "path", category: "Files", description: "Match a workspace path; * and ** wildcards are supported." },
  { name: "file", category: "Files", description: "Match a file name." },
  { name: "ext", category: "Files", description: "Match a file extension.", values: ["js", "ts", "json", "jsonl", "md", "txt", "html"] },
  { name: "size", category: "Files", description: "Compare file size, for example size:>500KB." },
  { name: "after", category: "Files", description: "Only files or records after an ISO date." },
  { name: "before", category: "Files", description: "Only files or records before an ISO date." },
  { name: "case", category: "Matching", description: "Turn case-sensitive matching on or off.", values: ["true", "false"] },
  { name: "regex", category: "Matching", description: "Run a bounded regular expression, for example regex:/user(Id)?/i." },
  { name: "decode", category: "Matching", description: "Search decoded variants without changing evidence.", values: ["url", "base64", "html", "unicode", "jwt", "auto"] },
  { name: "normalized", category: "Matching", description: "Also search normalized URLs and whitespace.", values: ["true", "false"] },
  { name: "host", category: "HTTP", description: "Match the request host." },
  { name: "scheme", category: "HTTP", description: "Match http, https, ws, or wss.", values: ["https", "http", "wss", "ws"] },
  { name: "port", category: "HTTP", description: "Match a request port." },
  { name: "method", category: "HTTP", description: "Match an HTTP method.", values: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] },
  { name: "status", category: "HTTP", description: "Match status codes or ranges such as 2xx, >=400, or 401." },
  { name: "endpoint", category: "HTTP", description: "Match a concrete or normalized endpoint." },
  { name: "param", category: "HTTP", description: "Match query, path, JSON, or form parameter names and values." },
  { name: "header", category: "HTTP", description: "Match request or response header names and values." },
  { name: "cookie", category: "HTTP", description: "Match cookie names and values." },
  { name: "mime", category: "HTTP", description: "Match response content type." },
  { name: "request", category: "HTTP", description: "Search request-only content." },
  { name: "response", category: "HTTP", description: "Search response-only content." },
  { name: "in-scope", category: "Scope", description: "Limit results using app-managed Project Settings scope.", values: ["true", "false"] },
  { name: "asset", category: "Scope", description: "Match a host, URL, target, or asset identifier." },
  { name: "identity", category: "Scope", description: "Match capture identity id, label, or role." },
  { name: "authenticated", category: "Scope", description: "Filter authenticated or anonymous traffic.", values: ["true", "false"] },
  { name: "severity", category: "Evidence", description: "Match evidence severity.", values: ["critical", "high", "medium", "low", "informational", "unrated"] },
  { name: "confidence", category: "Evidence", description: "Compare evidence confidence, for example confidence:>=0.8." },
  { name: "verified", category: "Evidence", description: "Filter verified evidence.", values: ["true", "false"] },
  { name: "evidence-status", category: "Evidence", description: "Match evidence lifecycle status.", values: ["observed", "verified", "rejected", "inconclusive"] },
  { name: "cwe", category: "Evidence", description: "Match CWE identifiers." },
  { name: "owasp", category: "Evidence", description: "Match OWASP categories." },
  { name: "tag", category: "Evidence", description: "Match tags or risk labels." },
  { name: "tool", category: "Evidence", description: "Match the capture or verifier tool." },
  { name: "evidence", category: "Evidence", description: "Match evidence identifiers and references." },
  { name: "url", category: "JavaScript", description: "Match URLs found in JavaScript artifacts." },
  { name: "symbol", category: "JavaScript", description: "Match function, class, or assigned symbols." },
  { name: "secret", category: "JavaScript", description: "Find likely secret material.", values: ["true", "false"] },
  { name: "secret-type", category: "JavaScript", description: "Match a detected secret family.", values: ["jwt", "aws-access-key", "private-key", "bearer-token", "github-token", "stripe-key", "api-key"] },
  { name: "sink", category: "JavaScript", description: "Match security-sensitive sinks.", values: ["dom-xss", "code-execution", "command-execution", "sql", "redirect"] },
  { name: "source-map", category: "JavaScript", description: "Find source-map references.", values: ["true", "false"] },
  { name: "same", category: "Correlation", description: "Group records sharing endpoint, param, resource, status, or response." , values: ["endpoint", "param", "resource", "status", "response"] },
  { name: "different", category: "Correlation", description: "Require a differing value, identity, status, body, or headers.", values: ["value", "identity", "status", "body", "headers"] },
  { name: "compare", category: "Correlation", description: "Compare records across identities or responses.", values: ["identity", "response"] },
  { name: "changed", category: "Correlation", description: "Require changed status, body, headers, or value.", values: ["status", "body", "headers", "value"] },
  { name: "response.diff", category: "Correlation", description: "Require a response difference across a comparison.", values: ["true", "false"] },
  { name: "risk", category: "Correlation", description: "Run a VAPT correlation preset.", values: ["idor", "bola", "auth-bypass"] },
  { name: "reachable-from", category: "Graph", description: "Match graph data reachable from a node label or id." },
  { name: "connected-to", category: "Graph", description: "Match graph data directly connected to a node label or id." },
]);

const OPERATOR_MAP = new Map(OPERATOR_DEFINITIONS.map((entry) => [entry.name, entry]));
const FIELD_ALIASES = new Map([
  ["in_scope", "in-scope"], ["status-code", "status"], ["status_code", "status"],
  ["content-type", "mime"], ["identity-id", "identity"], ["source_map", "source-map"],
  ["evidence_status", "evidence-status"], ["response-diff", "response.diff"],
]);
const CONTROL_FIELDS = new Set(["case", "decode", "normalized", "same", "different", "compare", "changed", "response.diff", "risk"]);
const CORRELATION_FIELDS = new Set(["same", "different", "compare", "changed", "response.diff", "risk"]);
const CLOSED_OPERATOR_VALUES = new Map([
  ["decode", new Set(["url", "base64", "html", "unicode", "jwt", "auto"])],
  ["same", new Set(["endpoint", "param", "resource", "status", "response"])],
  ["different", new Set(["value", "identity", "status", "body", "headers"])],
  ["compare", new Set(["identity", "response"])],
  ["changed", new Set(["status", "body", "headers", "value"])],
  ["risk", new Set(["idor", "bola", "auth-bypass"])],
  ["secret-type", new Set(["jwt", "aws-access-key", "private-key", "bearer-token", "github-token", "stripe-key", "api-key"])],
  ["sink", new Set(["dom-xss", "code-execution", "command-execution", "sql", "redirect"])],
]);
const BOOLEAN_OPERATOR_FIELDS = new Set(["case", "normalized", "authenticated", "verified", "secret", "source-map", "response.diff", "in-scope"]);
const CODE_EXTENSIONS = new Set(["js", "jsx", "ts", "tsx", "mjs", "cjs", "py", "rb", "go", "rs", "java", "c", "h", "cpp", "hpp", "cs", "php"]);
const STRUCTURED_COLLECTION_KEYS = ["artifacts", "records", "evidence", "assets", "endpoints", "pages", "subdomains", "services", "runs"];

class QuerySyntaxError extends Error {
  constructor(message, position = 0, code = "INVALID_ADVANCED_QUERY") {
    super(message);
    this.name = "QuerySyntaxError";
    this.position = Math.max(0, Number(position) || 0);
    this.code = code;
  }
}

function normalizeFieldName(value) {
  const lowered = String(value || "").trim().toLowerCase();
  return FIELD_ALIASES.get(lowered) || lowered;
}

function editDistanceAtMostTwo(left, right) {
  const a = String(left).toLowerCase();
  const b = String(right).toLowerCase();
  if (Math.abs(a.length - b.length) > 2) return false;
  let prior = Array.from({ length: b.length + 1 }, (_unused, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    const next = [row];
    let rowMinimum = row;
    for (let column = 1; column <= b.length; column += 1) {
      next[column] = Math.min(next[column - 1] + 1, prior[column] + 1, prior[column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1));
      rowMinimum = Math.min(rowMinimum, next[column]);
    }
    if (rowMinimum > 2) return false;
    prior = next;
  }
  return prior[b.length] <= 2;
}

function hasAdvancedSyntax(query) {
  const value = String(query || "");
  const operatorProbe = value
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "")
    .replace(/\b[a-z]:[\\/]\S+/gi, "");
  const fieldPrefixes = [...operatorProbe.matchAll(/(^|\s)([a-z][\w.-]*)\s*:/gi)].map((match) => normalizeFieldName(match[2]));
  const operatorLike = fieldPrefixes.some((field) => OPERATOR_MAP.has(field)
    || field.length >= 5 && OPERATOR_DEFINITIONS.some((entry) => editDistanceAtMostTwo(field, entry.name)));
  return /(^|\s)(?:AND|OR|NOT)(?=\s|$)/.test(value)
    || /(^|\s)-(?=[\w"(])/.test(value)
    || /[()"]/.test(value)
    || operatorLike;
}

function lexQuery(query) {
  const input = String(query || "");
  const tokens = [];
  let index = 0;
  const push = (type, value, start, extra = {}) => tokens.push({ type, value, start, end: index, ...extra });

  while (index < input.length) {
    if (/\s/.test(input[index])) { index += 1; continue; }
    const start = index;
    const char = input[index];
    if (char === "(") { index += 1; push("LPAREN", char, start); continue; }
    if (char === ")") { index += 1; push("RPAREN", char, start); continue; }
    if (char === ",") { index += 1; push("COMMA", char, start); continue; }
    if (char === "-" && /[\w"(]/.test(input[index + 1] || "")) { index += 1; push("NOT", "-", start); continue; }
    if (char === '"' || char === "'") {
      const quote = char;
      index += 1;
      let value = "";
      let closed = false;
      while (index < input.length) {
        const next = input[index++];
        if (next === "\\" && index < input.length) {
          const escaped = input[index++];
          value += escaped === "n" ? "\n" : escaped === "t" ? "\t" : escaped;
        } else if (next === quote) { closed = true; break; }
        else value += next;
      }
      if (!closed) throw new QuerySyntaxError("Unclosed quoted phrase", start);
      push("VALUE", value, start, { quoted: true });
      continue;
    }

    const regexPrefix = input.slice(index).match(/^(regex):\//i);
    if (regexPrefix) {
      const field = regexPrefix[1];
      index += regexPrefix[0].length;
      let pattern = "";
      let escaped = false;
      let closed = false;
      while (index < input.length) {
        const next = input[index++];
        if (!escaped && next === "/") { closed = true; break; }
        pattern += next;
        escaped = !escaped && next === "\\";
        if (next !== "\\") escaped = false;
      }
      if (!closed) throw new QuerySyntaxError("Unclosed regular expression", start);
      const flagsStart = index;
      while (/[a-z]/i.test(input[index] || "")) index += 1;
      push("FIELD_REGEX", pattern, start, { field, flags: input.slice(flagsStart, index) });
      continue;
    }

    let value = "";
    while (index < input.length && !/[\s(),]/.test(input[index])) value += input[index++];
    if (!value) throw new QuerySyntaxError(`Unexpected character ${JSON.stringify(input[index])}`, start);
    if (["AND", "OR", "NOT"].includes(value)) push(value, value, start);
    else push("WORD", value, start);
  }
  tokens.push({ type: "EOF", value: "", start: input.length, end: input.length });
  return tokens;
}

function validateRegex(pattern, flags = "") {
  if (String(pattern).length > MAX_REGEX_LENGTH) throw new QuerySyntaxError(`Regular expressions are limited to ${MAX_REGEX_LENGTH} characters`);
  if (/[^gimsuy]/.test(flags)) throw new QuerySyntaxError(`Unsupported regular-expression flags: ${flags}`);
  if (/\((?:[^()]|\\.)*[+*](?:[^()]|\\.)*\)[+*{]/.test(pattern) || /(?:\.\*|\.\+|\w[+*])[+*{]/.test(pattern)) {
    throw new QuerySyntaxError("The regular expression contains a potentially unsafe nested repetition");
  }
  try { return new RegExp(pattern, [...new Set(String(flags).replace(/g/g, ""))].join("")); }
  catch (error) { throw new QuerySyntaxError(`Invalid regular expression: ${error.message}`); }
}

function parseAdvancedQuery(query) {
  let tokens;
  try { tokens = lexQuery(query); }
  catch (error) {
    return { ok: false, error: error.message, code: error.code || "INVALID_ADVANCED_QUERY", position: error.position || 0 };
  }
  let cursor = 0;
  const peek = () => tokens[cursor];
  const consume = (type = null) => {
    const token = tokens[cursor];
    if (type && token.type !== type) throw new QuerySyntaxError(`Expected ${type.toLowerCase()}`, token.start);
    cursor += 1;
    return token;
  };
  const startsPrimary = (token) => ["WORD", "VALUE", "FIELD_REGEX", "LPAREN", "NOT"].includes(token.type);

  function fieldNode(rawField, rawValues, token, extra = {}) {
    const field = normalizeFieldName(rawField);
    if (!OPERATOR_MAP.has(field)) {
      const candidates = OPERATOR_DEFINITIONS.map((entry) => entry.name)
        .filter((name) => name.startsWith(field.slice(0, 2)))
        .slice(0, 4);
      const hint = candidates.length ? ` Did you mean ${candidates.join(", ")}?` : " Quote the text if the colon is literal.";
      throw new QuerySyntaxError(`Unknown search operator “${rawField}”.${hint}`, token.start, "UNKNOWN_SEARCH_OPERATOR");
    }
    const values = rawValues.map((value) => String(value ?? "").trim()).filter(Boolean);
    if (!values.length) throw new QuerySyntaxError(`Operator ${field}: needs a value`, token.end);
    if (BOOLEAN_OPERATOR_FIELDS.has(field) && values.some((value) => !/^(?:true|false|yes|no|1|0|on|off)$/i.test(value))) {
      throw new QuerySyntaxError(`${field}: accepts only true or false`, token.start, "INVALID_SEARCH_OPERATOR_VALUE");
    }
    const allowedValues = CLOSED_OPERATOR_VALUES.get(field);
    if (allowedValues && values.some((value) => !allowedValues.has(value.toLowerCase()))) {
      throw new QuerySyntaxError(`${field}: accepts ${[...allowedValues].join(", ")}`, token.start, "INVALID_SEARCH_OPERATOR_VALUE");
    }
    if (field === "size" && values.some((value) => !parseSize(value))) {
      throw new QuerySyntaxError("size: expects a number with an optional comparison and B, KB, MB, or GB unit", token.start, "INVALID_SEARCH_OPERATOR_VALUE");
    }
    if (["after", "before"].includes(field) && values.some((value) => !Number.isFinite(new Date(value).getTime()))) {
      throw new QuerySyntaxError(`${field}: expects a valid date such as 2026-08-23`, token.start, "INVALID_SEARCH_OPERATOR_VALUE");
    }
    if (field === "confidence" && values.some((value) => !/^(?:<=|>=|<|>|=)?\s*(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(value))) {
      throw new QuerySyntaxError("confidence: expects a value from 0 to 1, optionally prefixed with <, <=, >, or >=", token.start, "INVALID_SEARCH_OPERATOR_VALUE");
    }
    if (field === "regex") {
      const regex = validateRegex(values[0], extra.flags || "");
      return { type: "field", field, values, regex, regexFlags: extra.flags || "", position: token.start };
    }
    return { type: "field", field, values, position: token.start };
  }

  function parseFieldList(field, token) {
    consume("LPAREN");
    const values = [];
    while (peek().type !== "RPAREN" && peek().type !== "EOF") {
      const value = consume();
      if (!["WORD", "VALUE"].includes(value.type)) throw new QuerySyntaxError(`Expected a value inside ${field}:(...)`, value.start);
      values.push(value.value);
      if (peek().type === "COMMA" || peek().type === "OR") consume();
      else if (peek().type !== "RPAREN") throw new QuerySyntaxError(`Separate ${field}: values with commas or OR`, peek().start);
    }
    if (peek().type !== "RPAREN") throw new QuerySyntaxError(`Missing closing parenthesis for ${field}:`, token.start);
    consume("RPAREN");
    return fieldNode(field, values, token);
  }

  function parsePrimary() {
    const token = peek();
    if (token.type === "LPAREN") {
      consume();
      const expression = parseOr();
      if (peek().type !== "RPAREN") throw new QuerySyntaxError("Missing closing parenthesis", token.start);
      consume();
      return expression;
    }
    if (token.type === "FIELD_REGEX") {
      consume();
      return fieldNode(token.field, [token.value], token, { flags: token.flags });
    }
    if (token.type === "VALUE") {
      consume();
      if (!token.value) throw new QuerySyntaxError("Empty phrases cannot be searched", token.start);
      return { type: "term", value: token.value, phrase: true, position: token.start };
    }
    if (token.type !== "WORD") throw new QuerySyntaxError("Expected a search term or filter", token.start);
    consume();
    const colon = token.value.indexOf(":");
    if (colon < 0 || /^[a-z][a-z0-9+.-]*:\/\//i.test(token.value) || /^[a-z]:[\\/]/i.test(token.value)) {
      return { type: "term", value: token.value, phrase: false, position: token.start };
    }
    const field = token.value.slice(0, colon);
    const inlineValue = token.value.slice(colon + 1);
    if (inlineValue) return fieldNode(field, [inlineValue], token);
    if (peek().type === "LPAREN") return parseFieldList(field, token);
    if (["WORD", "VALUE"].includes(peek().type)) return fieldNode(field, [consume().value], token);
    throw new QuerySyntaxError(`Operator ${field}: needs a value`, token.end);
  }

  function parseUnary() {
    if (peek().type === "NOT") {
      const token = consume();
      return { type: "not", child: parseUnary(), position: token.start };
    }
    return parsePrimary();
  }

  function parseAnd() {
    let node = parseUnary();
    while (peek().type === "AND" || startsPrimary(peek())) {
      if (peek().type === "AND") consume();
      const right = parseUnary();
      node = { type: "and", left: node, right, position: node.position };
    }
    return node;
  }

  function parseOr() {
    let node = parseAnd();
    while (peek().type === "OR") {
      consume();
      const right = parseAnd();
      node = { type: "or", left: node, right, position: node.position };
    }
    return node;
  }

  try {
    if (peek().type === "EOF") throw new QuerySyntaxError("Empty search query", 0);
    const ast = parseOr();
    if (peek().type !== "EOF") throw new QuerySyntaxError(`Unexpected token ${peek().value || peek().type}`, peek().start);
    const options = collectQueryOptions(ast);
    walkAst(ast, (node) => {
      if (node.type === "field" && node.field === "regex" && !options.caseSensitive && !node.regexFlags.includes("i")) {
        node.regex = validateRegex(node.values[0], `${node.regexFlags}i`);
      }
    });
    return { ok: true, ast, options, fields: collectFieldValues(ast), terms: collectTerms(ast) };
  } catch (error) {
    return { ok: false, error: error.message, code: error.code || "INVALID_ADVANCED_QUERY", position: error.position || 0 };
  }
}

function walkAst(node, visit, negated = false) {
  if (!node) return;
  if (node.type === "not") return walkAst(node.child, visit, !negated);
  if (node.type === "and" || node.type === "or") {
    walkAst(node.left, visit, negated);
    walkAst(node.right, visit, negated);
    return;
  }
  visit(node, negated);
}

function collectTerms(ast) {
  const values = [];
  walkAst(ast, (node, negated) => { if (!negated && node.type === "term") values.push(node.value); });
  return values;
}

function collectFieldValues(ast) {
  const fields = {};
  walkAst(ast, (node, negated) => {
    if (negated || node.type !== "field") return;
    fields[node.field] = [...(fields[node.field] || []), ...node.values];
  });
  return fields;
}

function booleanValue(value, fallback = false) {
  if (/^(?:true|yes|1|on)$/i.test(String(value))) return true;
  if (/^(?:false|no|0|off)$/i.test(String(value))) return false;
  return fallback;
}

function collectQueryOptions(ast) {
  const fields = collectFieldValues(ast);
  const decoders = new Set((fields.decode || []).flatMap((value) => String(value).toLowerCase() === "auto"
    ? ["url", "base64", "html", "unicode", "jwt"]
    : [String(value).toLowerCase()]));
  return {
    caseSensitive: booleanValue(fields.case?.at(-1), false),
    normalized: booleanValue(fields.normalized?.at(-1), false),
    decoders,
    correlation: Object.keys(fields).some((field) => CORRELATION_FIELDS.has(field)),
    requestedFields: new Set(Object.keys(fields)),
    hasTerms: collectTerms(ast).length > 0,
  };
}

function wildcardRegex(pattern, caseSensitive = false) {
  const value = String(pattern).replace(/\\/g, "/");
  let expression = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "*" && value[index + 1] === "*") {
      if (value[index + 2] === "/") { expression += "(?:.*/)?"; index += 2; }
      else { expression += ".*"; index += 1; }
    } else if (char === "*") expression += "[^/]*";
    else if (char === "?") expression += "[^/]";
    else expression += /[.+^${}()|[\]\\]/.test(char) ? `\\${char}` : char;
  }
  return new RegExp(`^${expression}$`, caseSensitive ? "" : "i");
}

function parseSize(value) {
  const match = String(value || "").trim().match(/^(<=|>=|<|>|=)?\s*(\d+(?:\.\d+)?)\s*(b|kb|kib|mb|mib|gb|gib)?$/i);
  if (!match) return null;
  const units = { b: 1, kb: 1000, kib: 1024, mb: 1_000_000, mib: 1_048_576, gb: 1_000_000_000, gib: 1_073_741_824 };
  return { operator: match[1] || "=", bytes: Number(match[2]) * (units[(match[3] || "b").toLowerCase()] || 1) };
}

function compareNumber(actual, expression) {
  const match = String(expression || "").trim().match(/^(<=|>=|<|>|=)?\s*(-?\d+(?:\.\d+)?)$/);
  if (!match || !Number.isFinite(Number(actual))) return false;
  const expected = Number(match[2]);
  if (match[1] === ">") return Number(actual) > expected;
  if (match[1] === ">=") return Number(actual) >= expected;
  if (match[1] === "<") return Number(actual) < expected;
  if (match[1] === "<=") return Number(actual) <= expected;
  return Number(actual) === expected;
}

function valuesOf(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value.flatMap(valuesOf);
  if (typeof value === "object") return Object.entries(value).flatMap(([key, child]) => [key, ...valuesOf(child)]);
  return [String(value)];
}

function flattenRecord(value, prefix = "", out = {}, depth = 0) {
  if (depth > 7 || value == null) return out;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 2_000)) flattenRecord(item, prefix, out, depth + 1);
    return out;
  }
  if (typeof value !== "object") {
    if (prefix) (out[prefix.toLowerCase()] ||= []).push(String(value));
    return out;
  }
  for (const [key, child] of Object.entries(value).slice(0, 4_000)) {
    const next = prefix ? `${prefix}.${key}` : key;
    flattenRecord(child, next, out, depth + 1);
    (out[key.toLowerCase()] ||= []).push(...valuesOf(child).slice(0, 500));
  }
  return out;
}

function safeStringify(value, max = MAX_DECODED_TEXT) {
  let output = "";
  try { output = typeof value === "string" ? value : JSON.stringify(value); }
  catch { output = String(value ?? ""); }
  return output.length > max ? output.slice(0, max) : output;
}

function parseHeaders(lines) {
  const headers = {};
  for (const line of lines) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (key) headers[key] = headers[key] ? `${headers[key]}, ${value}` : value;
  }
  return headers;
}

function normalizeHttpPart(value, kind) {
  if (value && typeof value === "object") {
    return {
      raw: safeStringify(value),
      method: kind === "request" ? String(value.method || "") : "",
      url: kind === "request" ? String(value.url || value.path || "") : "",
      status: kind === "response" ? Number(value.status ?? value.statusCode) || 0 : 0,
      headers: value.headers && typeof value.headers === "object" ? value.headers : {},
      body: value.body == null ? "" : safeStringify(value.body),
      query: value.query && typeof value.query === "object" ? value.query : {},
    };
  }
  const raw = String(value || "");
  const [head = "", ...bodyParts] = raw.split(/\r?\n\r?\n/);
  const lines = head.split(/\r?\n/);
  const first = lines.shift() || "";
  const requestLine = first.match(/^([A-Z]+)\s+(\S+)\s+HTTP\//i);
  const responseLine = first.match(/^HTTP\/\S+\s+(\d{3})/i);
  return {
    raw,
    method: requestLine?.[1]?.toUpperCase() || "",
    url: requestLine?.[2] || "",
    status: Number(responseLine?.[1]) || 0,
    headers: parseHeaders(lines),
    body: bodyParts.join("\n\n"),
    query: {},
  };
}

function headerEntries(headers) {
  return Object.entries(headers || {}).map(([key, value]) => [String(key), Array.isArray(value) ? value.join(", ") : String(value ?? "")]);
}

function headerValue(headers, name) {
  return headerEntries(headers).find(([key]) => key.toLowerCase() === String(name).toLowerCase())?.[1] || "";
}

function tryUrl(raw, hostHeader = "") {
  const value = String(raw || "");
  if (!value && !hostHeader) return null;
  try { return new URL(value); }
  catch {
    try { return new URL(value || "/", `http://${hostHeader || "unknown.invalid"}`); }
    catch { return null; }
  }
}

function isIdentifierSegment(value) {
  return /^\d+$/.test(value)
    || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value)
    || /^[0-9a-f]{16,}$/i.test(value)
    || /^[A-Za-z0-9_-]{20,}$/.test(value);
}

function normalizeEndpoint(pathname) {
  const value = String(pathname || "/").replace(/\/+/g, "/");
  return value.split("/").map((segment) => isIdentifierSegment(segment) ? "{id}" : segment).join("/") || "/";
}

function bodyParameters(body) {
  const output = [];
  const add = (name, value, location = "body") => {
    if (!name) return;
    output.push({ name: String(name), value: typeof value === "object" ? safeStringify(value, 2_000) : String(value ?? ""), location });
  };
  const walk = (value, prefix = "", depth = 0) => {
    if (depth > 5 || value == null) return;
    if (Array.isArray(value)) return value.slice(0, 100).forEach((item, index) => walk(item, `${prefix}[${index}]`, depth + 1));
    if (typeof value !== "object") return add(prefix, value);
    for (const [key, child] of Object.entries(value).slice(0, 500)) {
      const name = prefix ? `${prefix}.${key}` : key;
      if (child && typeof child === "object") walk(child, name, depth + 1);
      else add(name, child);
    }
  };
  const text = String(body || "").trim();
  if (!text) return output;
  try { walk(JSON.parse(text)); return output; } catch { /* not JSON */ }
  if (/^[^=&\s]+=[^&]*(?:&|$)/.test(text)) {
    try { for (const [key, value] of new URLSearchParams(text)) add(key, value, "form"); } catch { /* malformed form */ }
  }
  return output;
}

function detectSecrets(text) {
  const value = String(text || "");
  const types = new Set();
  const tests = [
    ["jwt", /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}(?:\.[A-Za-z0-9_-]{6,})?\b/],
    ["aws-access-key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
    ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ["bearer-token", /\bBearer\s+[A-Za-z0-9._~+\/-]{12,}={0,2}/i],
    ["github-token", /\bgh[pousr]_[A-Za-z0-9]{20,}\b/],
    ["stripe-key", /\bsk_live_[A-Za-z0-9]{16,}\b/],
    ["api-key", /\b(?:api[_-]?key|client[_-]?secret|access[_-]?token)\b\s*[:=]\s*["']?[A-Za-z0-9._~+\/-]{12,}/i],
  ];
  for (const [name, pattern] of tests) if (pattern.test(value)) types.add(name);
  return [...types];
}

function detectSinks(text) {
  const value = String(text || "");
  const sinks = new Set();
  if (/\b(?:innerHTML|outerHTML|insertAdjacentHTML|document\.write|dangerouslySetInnerHTML)\b/.test(value)) sinks.add("dom-xss");
  if (/\b(?:eval|Function)\s*\(/.test(value)) sinks.add("code-execution");
  if (/\b(?:exec|execSync|spawn|system|popen)\s*\(/.test(value)) sinks.add("command-execution");
  if (/\b(?:query|execute|raw)\s*\([^\n]*(?:SELECT|INSERT|UPDATE|DELETE)/i.test(value)) sinks.add("sql");
  if (/\b(?:location(?:\.href)?|window\.open|redirect)\s*(?:=|\()/i.test(value)) sinks.add("redirect");
  return [...sinks];
}

function extractSymbols(text) {
  const symbols = new Set();
  const pattern = /\b(?:function|class)\s+([A-Za-z_$][\w$]*)|\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=|\bdef\s+([A-Za-z_][\w]*)/g;
  for (const match of String(text || "").matchAll(pattern)) {
    symbols.add(match[1] || match[2] || match[3]);
    if (symbols.size >= 500) break;
  }
  return [...symbols].filter(Boolean);
}

function extractUrlLiterals(text) {
  const urls = new Set();
  const value = String(text || "");
  for (const match of value.matchAll(/https?:\/\/[^\s"'`<>)}\]]+/gi)) {
    urls.add(match[0]);
    if (urls.size >= 500) break;
  }
  for (const match of value.matchAll(/["'`](\/(?:api|graphql|v\d+|admin|internal|account|user)[^"'`\s]*)["'`]/gi)) {
    urls.add(match[1]);
    if (urls.size >= 500) break;
  }
  return [...urls];
}

function decodeHtml(value) {
  const entities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return String(value).replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_all, token) => {
    if (token[0] !== "#") return entities[token.toLowerCase()] || _all;
    const radix = token[1]?.toLowerCase() === "x" ? 16 : 10;
    const number = parseInt(token.slice(radix === 16 ? 2 : 1), radix);
    try { return Number.isFinite(number) ? String.fromCodePoint(number) : _all; } catch { return _all; }
  });
}

function decodeUnicode(value) {
  return String(value).replace(/\\u\{([0-9a-f]{1,6})\}|\\u([0-9a-f]{4})|\\x([0-9a-f]{2})/gi, (_all, braced, four, two) => {
    try { return String.fromCodePoint(parseInt(braced || four || two, 16)); } catch { return _all; }
  });
}

function printableDecodedBase64(token) {
  try {
    const normalized = token.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = Buffer.from(normalized, "base64").toString("utf8");
    if (decoded.length < 3 || decoded.includes("\u0000")) return "";
    const printable = [...decoded].filter((char) => /[\x09\x0a\x0d\x20-\x7e\u00a0-\uffff]/.test(char)).length / decoded.length;
    return printable >= 0.88 ? decoded : "";
  } catch { return ""; }
}

function buildDecodedVariants(text, decoders = new Set(), normalized = false) {
  if (!decoders?.size && !normalized) return { variants: [], available: new Set() };
  const base = String(text || "").slice(0, MAX_DECODED_TEXT);
  const variants = [];
  const available = new Set();
  const add = (type, value) => {
    const clean = String(value || "").slice(0, MAX_DECODED_TEXT);
    if (!clean || clean === base || variants.some((entry) => entry.text === clean)) return;
    variants.push({ type, text: clean });
    available.add(type);
  };
  if (decoders.has("url")) {
    try { add("url", decodeURIComponent(base.replace(/\+/g, "%20"))); } catch { /* malformed URL encoding */ }
  }
  if (decoders.has("html")) add("html", decodeHtml(base));
  if (decoders.has("unicode")) add("unicode", decodeUnicode(base));
  if (decoders.has("base64") || decoders.has("jwt")) {
    const tokens = base.match(/[A-Za-z0-9_-]{8,}={0,2}/g) || [];
    let decoded = 0;
    for (const token of tokens) {
      if (decoded >= 100) break;
      if (decoders.has("base64")) {
        const value = printableDecodedBase64(token);
        if (value) { add("base64", value); decoded += 1; }
      }
    }
    if (decoders.has("jwt")) {
      for (const token of base.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?/g) || []) {
        const [header, payload] = token.split(".");
        const decodedJwt = [printableDecodedBase64(header), printableDecodedBase64(payload)].filter(Boolean).join("\n");
        if (decodedJwt) add("jwt", decodedJwt);
      }
    }
  }
  if (normalized) add("normalized", base.normalize("NFKC").replace(/\s+/g, " ").trim());
  return { variants, available };
}

function classifySources(relativePath, record = null) {
  const rel = String(relativePath || "").replace(/\\/g, "/").toLowerCase();
  const ext = rel.split(".").pop() || "";
  const sources = new Set(["workspace"]);
  if (/^(?:traffic\/(?:raw|filtered)\.jsonl|traffic\/captures\/)/.test(rel) || ext === "har" || record?.recordType === "http-exchange" || record?.request && record?.response) sources.add("traffic");
  if (/(?:^|\/)\.xekute\/evidence(?:\/|$)/.test(rel) || record?.severity && record?.title) sources.add("evidence");
  if (/traffic\/artifacts\/javascript/.test(rel) || ["js", "jsx", "ts", "tsx", "mjs", "cjs"].includes(ext) || record?.sourceMaps || record?.endpoints && record?.sha256) sources.add("javascript");
  if (/(?:^|\/)evidence(?:\/|$)/.test(rel) || record?.recordType?.includes?.("evidence")) sources.add("evidence");
  if (/(?:^|\/)\.xekute\/logs\//.test(rel) || /(?:^|\/)(?:scans?|tools?)(?:\/|$)/.test(rel) || record?.tool && record?.exitCode !== undefined) sources.add("tool");
  if (/(?:^|\/)(?:map|traffic\/graph)(?:\/|$)/.test(rel) || record?.kind === "xekute-application-behavior-map") sources.add("map");
  if (/(?:^|\/)(?:enumeration|recon|scope)(?:\/|$)/.test(rel) || record?.inScope !== undefined || record?.targetId) sources.add("asset");
  if (CODE_EXTENSIONS.has(ext)) sources.add("code");
  const priority = ["traffic", "javascript", "evidence", "map", "asset", "tool", "code", "workspace"];
  return { sources: [...sources], primary: priority.find((name) => sources.has(name)) || "workspace" };
}

function graphMetadata(record) {
  if (!record || !Array.isArray(record.nodes) || !Array.isArray(record.edges)) return { connections: [], reachable: [], endpoints: [], hosts: [], identities: [], urls: [], tags: [] };
  const nodes = new Map(record.nodes.map((node) => [String(node.id), node]));
  const label = (node) => [node?.id, node?.label, node?.host, node?.template, node?.url].filter(Boolean).map(String);
  const connections = [];
  const reachable = new Set();
  const connected = new Set();
  for (const edge of record.edges.slice(0, 100_000)) {
    const left = label(nodes.get(String(edge.source)));
    const right = label(nodes.get(String(edge.target)));
    connections.push(...left.flatMap((a) => right.map((b) => `${a} -> ${b}`)));
    left.forEach((value) => { reachable.add(value); connected.add(value); });
    right.forEach((value) => connected.add(value));
  }
  const allNodes = [...nodes.values()];
  return {
    connections: [...connected, ...connections],
    reachable: [...reachable],
    endpoints: allNodes.flatMap((node) => [node.template, node.route, node.path].filter(Boolean).map(String)),
    hosts: allNodes.flatMap((node) => [node.host, node.hostname].filter(Boolean).map(String)),
    identities: allNodes.filter((node) => String(node.type).toLowerCase() === "identity").flatMap(label),
    urls: allNodes.flatMap((node) => [node.url].filter(Boolean).map(String)),
    tags: allNodes.flatMap((node) => valuesOf(node.riskTags || node.tags)),
  };
}

function deriveDocument({ relativePath, content, stat = {}, record = null, line = 1, column = 1, scopeDecision = null, options = {} }) {
  const rel = String(relativePath || "").replace(/\\/g, "/");
  const ext = rel.includes(".") ? rel.split(".").pop().toLowerCase() : "";
  const rawRecord = record && typeof record === "object" ? record : null;
  const rawText = String(content ?? safeStringify(rawRecord));
  const requestedFields = options.requestedFields instanceof Set ? options.requestedFields : null;
  const selective = Boolean(requestedFields?.size);
  const wants = (...fields) => !selective || fields.some((field) => requestedFields.has(field));
  const flattened = flattenRecord(rawRecord || {});
  const request = normalizeHttpPart(rawRecord?.request ?? flattened.request?.[0] ?? "", "request");
  const response = normalizeHttpPart(rawRecord?.response ?? flattened.response?.[0] ?? "", "response");
  const topUrl = rawRecord?.url || rawRecord?.requestUrl || request.url || flattened.url?.[0] || "";
  const parsedUrl = tryUrl(topUrl, headerValue(request.headers, "host"));
  const method = String(rawRecord?.method || request.method || flattened.method?.[0] || "").toUpperCase();
  const status = Number(rawRecord?.statusCode ?? rawRecord?.status ?? response.status ?? flattened.statuscode?.[0] ?? flattened.status?.[0]) || 0;
  const host = parsedUrl?.hostname || headerValue(request.headers, "host").split(":")[0] || String(rawRecord?.host || "");
  const port = parsedUrl?.port || (parsedUrl?.protocol === "https:" ? "443" : parsedUrl?.protocol === "http:" ? "80" : "");
  const pathname = parsedUrl?.pathname || String(rawRecord?.path || "");
  const endpoint = normalizeEndpoint(pathname || "/");
  const params = [];
  if (parsedUrl) for (const [name, value] of parsedUrl.searchParams) params.push({ name, value, location: "query" });
  for (const [name, value] of Object.entries(request.query || {})) params.push({ name, value: String(value), location: "query" });
  params.push(...bodyParameters(request.body));
  const pathSegments = pathname.split("/").filter(Boolean);
  pathSegments.forEach((value, index) => { if (isIdentifierSegment(value)) params.push({ name: `path[${index}]`, value, location: "path" }); });
  const requestHeaders = headerEntries(request.headers);
  const responseHeaders = headerEntries(response.headers);
  const cookieHeader = headerValue(request.headers, "cookie");
  const setCookieHeader = headerValue(response.headers, "set-cookie");
  const cookies = [cookieHeader, setCookieHeader].filter(Boolean).flatMap((value) => value.split(/[,;]\s*/)).filter(Boolean);
  const captureIdentity = rawRecord?.captureIdentity && typeof rawRecord.captureIdentity === "object" ? rawRecord.captureIdentity : {};
  const identities = [rawRecord?.identityId, rawRecord?.identity, captureIdentity.id, captureIdentity.label, captureIdentity.role, flattened.identityid?.[0]].filter(Boolean).map(String);
  const authenticated = identities.length > 0 || Boolean(headerValue(request.headers, "authorization") || cookieHeader);
  const mime = String(rawRecord?.contentType || headerValue(response.headers, "content-type") || flattened.contenttype?.[0] || "").split(";", 1)[0];
  const sources = classifySources(rel, rawRecord);
  const sourceMaps = wants("source-map") ? [
    ...(valuesOf(rawRecord?.sourceMaps)),
    ...((rawText.match(/sourceMappingURL\s*=\s*([^\s*]+)/g) || [])),
  ] : [];
  const graph = wants("reachable-from", "connected-to", "endpoint", "host", "identity", "url", "tag") ? graphMetadata(rawRecord) : { connections: [], reachable: [], endpoints: [], hosts: [], identities: [], urls: [], tags: [] };
  const decoded = buildDecodedVariants(rawText, options.decoders || new Set(), options.normalized);
  const decodedRequest = buildDecodedVariants(`${request.raw}\n${request.body}`, options.decoders || new Set(), options.normalized);
  const decodedResponse = buildDecodedVariants(`${response.raw}\n${response.body}`, options.decoders || new Set(), options.normalized);
  for (const type of [...decodedRequest.available, ...decodedResponse.available]) decoded.available.add(type);
  const secretTypes = wants("secret", "secret-type")
    ? [...new Set([rawText, ...decoded.variants.map((entry) => entry.text)].flatMap(detectSecrets))]
    : [];
  const sinks = wants("sink")
    ? [...new Set([rawText, ...decoded.variants.map((entry) => entry.text)].flatMap(detectSinks))]
    : [];
  const corpus = [rawText, ...decoded.variants.map((entry) => entry.text)];
  const timestamp = rawRecord?.isoTimestamp || rawRecord?.timestamp || rawRecord?.updatedAt || rawRecord?.createdAt || stat.mtimeMs || 0;
  const evidenceStatus = rawRecord?.evidenceStatus || (sources.sources.includes("evidence") ? rawRecord?.status : "") || "";
  const verified = Boolean(rawRecord?.verified === true || rawRecord?.verification?.verified === true || String(evidenceStatus).toLowerCase() === "verified");
  const tags = [...valuesOf(rawRecord?.tags), ...valuesOf(rawRecord?.riskTags), ...valuesOf(rawRecord?.categories), ...valuesOf(rawRecord?.metadata?.tags)];
  const evidence = [...valuesOf(rawRecord?.evidence), ...valuesOf(rawRecord?.evidenceRefs), ...valuesOf(rawRecord?.evidenceIds), ...valuesOf(rawRecord?.reproductionRefs)];
  const cwe = [...valuesOf(rawRecord?.cwe), ...valuesOf(rawRecord?.cwes), ...valuesOf(rawRecord?.metadata?.cwe)];
  const owasp = [...valuesOf(rawRecord?.owasp), ...valuesOf(rawRecord?.owaspCategory), ...valuesOf(rawRecord?.metadata?.owasp)];
  const symbols = wants("symbol") && sources.sources.includes("javascript") ? [...valuesOf(rawRecord?.symbols), ...extractSymbols(rawText)] : [];
  const urlValues = [topUrl, ...valuesOf(rawRecord?.urls), ...valuesOf(rawRecord?.endpoints).filter((value) => /^https?:|^\//i.test(value)), ...(wants("url", "endpoint") && sources.sources.includes("javascript") ? extractUrlLiterals(rawText) : [])];
  const inScope = typeof scopeDecision === "function" ? scopeDecision(topUrl || host) : rawRecord?.inScope;

  return {
    relativePath: rel,
    line: Number(line) || 1,
    column: Number(column) || 1,
    content: rawText,
    record: rawRecord,
    corpus,
    decodedTypes: decoded.available,
    source: sources.primary,
    sources: sources.sources,
    stat: { size: Number(stat.size) || Buffer.byteLength(rawText), mtimeMs: Number(stat.mtimeMs) || 0 },
    fields: {
      path: [rel], file: [rel.split("/").pop() || rel], ext: [ext], source: sources.sources,
      host: [host, ...graph.hosts].filter(Boolean), scheme: [parsedUrl?.protocol?.replace(":", "") || ""], port: [port], method: [method], status: status ? [String(status)] : [],
      endpoint: [pathname, endpoint, topUrl, ...graph.endpoints].filter(Boolean),
      param: params.flatMap((entry) => [entry.name, `${entry.name}=${entry.value}`, entry.value]),
      header: [...requestHeaders, ...responseHeaders].flatMap(([name, value]) => [name, `${name}: ${value}`, value]),
      cookie: cookies.flatMap((cookie) => [cookie, cookie.split("=", 1)[0]]), mime: [mime],
      request: [request.raw, request.body, ...decodedRequest.variants.map((entry) => entry.text)],
      response: [response.raw, response.body, ...decodedResponse.variants.map((entry) => entry.text)],
      asset: [host, topUrl, rawRecord?.targetId, rawRecord?.asset?.host, rawRecord?.asset?.url].filter(Boolean),
      identity: [...identities, ...graph.identities], authenticated: [String(authenticated)], "in-scope": inScope === undefined ? [] : [String(Boolean(inScope))],
      severity: valuesOf(rawRecord?.severity), confidence: valuesOf(rawRecord?.confidence), verified: [String(verified)], "evidence-status": valuesOf(evidenceStatus),
      cwe, owasp, tag: [...tags, ...graph.tags], tool: [rawRecord?.tool, rawRecord?.source, rawRecord?.capturedBy].filter(Boolean), evidence,
      url: [...urlValues, ...graph.urls], symbol: symbols, secret: [String(secretTypes.length > 0)], "secret-type": secretTypes, sink: sinks,
      "source-map": sourceMaps.length ? ["true", ...sourceMaps] : ["false"],
      "reachable-from": graph.reachable, "connected-to": graph.connections,
    },
    http: {
      isHttp: sources.sources.includes("traffic") || Boolean(method || topUrl || status), method, status, url: topUrl,
      host, pathname, endpoint, params, requestHeaders: Object.fromEntries(requestHeaders.map(([key, value]) => [key.toLowerCase(), value])),
      responseHeaders: Object.fromEntries(responseHeaders.map(([key, value]) => [key.toLowerCase(), value])), requestBody: request.body,
      responseBody: response.body, identity: identities[0] || "anonymous", identityLabels: identities, authenticated,
    },
  };
}

function normalizeComparable(value, caseSensitive) {
  const text = String(value ?? "");
  return caseSensitive ? text : text.toLowerCase();
}

function includesValue(actualValues, wanted, caseSensitive, { exact = false, glob = false } = {}) {
  const expected = normalizeComparable(wanted, caseSensitive);
  if (glob || /[*?]/.test(expected)) {
    const pattern = wildcardRegex(wanted, caseSensitive);
    return actualValues.some((actual) => pattern.test(String(actual)));
  }
  return actualValues.some((actual) => {
    const comparable = normalizeComparable(actual, caseSensitive);
    return exact ? comparable === expected : comparable.includes(expected);
  });
}

function matchesStatus(actual, wanted) {
  const value = String(wanted || "").trim().toLowerCase();
  if (/^[1-5]xx$/.test(value)) return Math.floor(Number(actual) / 100) === Number(value[0]);
  return compareNumber(actual, value);
}

function evaluateField(node, document, options) {
  const { field, values } = node;
  if (CONTROL_FIELDS.has(field)) {
    if (field === "decode") return values.some((value) => document.decodedTypes.has(String(value).toLowerCase()) || String(value).toLowerCase() === "auto" && document.decodedTypes.size > 0);
    if (["case", "normalized", "same", "different", "compare", "changed", "response.diff", "risk"].includes(field)) return true;
  }
  if (field === "regex") return document.corpus.some((text) => {
    node.regex.lastIndex = 0;
    return node.regex.test(String(text).slice(0, MAX_DECODED_TEXT));
  });
  if (field === "size") return values.some((value) => {
    const parsed = parseSize(value);
    return parsed ? compareNumber(document.stat.size, `${parsed.operator}${parsed.bytes}`) : false;
  });
  if (field === "after" || field === "before") {
    const actual = new Date(document.record?.isoTimestamp || document.record?.timestamp || document.record?.updatedAt || document.record?.createdAt || document.stat.mtimeMs).getTime();
    return values.some((value) => {
      const expected = new Date(value).getTime();
      return Number.isFinite(actual) && Number.isFinite(expected) && (field === "after" ? actual >= expected : actual <= expected);
    });
  }
  if (field === "status") {
    const actual = Number(document.http.status || document.fields.status?.[0]);
    if (actual) return values.some((value) => matchesStatus(actual, value));
    return values.some((value) => includesValue(document.fields["evidence-status"] || [], value, options.caseSensitive, { exact: true }));
  }
  if (field === "confidence") return values.some((value) => (document.fields.confidence || []).some((actual) => compareNumber(actual, value)));
  if (["authenticated", "verified", "in-scope", "secret", "source-map"].includes(field) && /^(?:true|false|yes|no|1|0|on|off)$/i.test(values[0])) {
    return values.some((value) => includesValue(document.fields[field] || [], String(booleanValue(value)), false, { exact: true }));
  }
  const actualValues = document.fields[field] || [];
  if (field === "source") {
    const aliases = { js: "javascript", scripts: "javascript", tools: "tool", graphs: "map", files: "workspace" };
    return values.some((value) => includesValue(actualValues, aliases[String(value).toLowerCase()] || value, false, { exact: true }));
  }
  if (field === "severity") {
    return values.some((value) => {
      const wanted = String(value).toLowerCase() === "info" ? "informational" : value;
      return includesValue(actualValues.map((actual) => String(actual).toLowerCase() === "info" ? "informational" : actual), wanted, false, { exact: true });
    });
  }
  if (field === "ext") {
    return values.some((value) => includesValue(actualValues, String(value).replace(/^\./, ""), false, { exact: true }));
  }
  const exactFields = new Set(["source", "ext", "scheme", "port", "method", "severity", "verified", "evidence-status", "authenticated", "in-scope", "secret", "secret-type", "sink"]);
  return values.some((value) => includesValue(actualValues, value, options.caseSensitive, {
    exact: exactFields.has(field),
    glob: field === "path" || field === "file",
  }));
}

function evaluateAst(ast, document, options = {}) {
  if (!ast) return false;
  if (ast.type === "and") return evaluateAst(ast.left, document, options) && evaluateAst(ast.right, document, options);
  if (ast.type === "or") return evaluateAst(ast.left, document, options) || evaluateAst(ast.right, document, options);
  if (ast.type === "not") return !evaluateAst(ast.child, document, options);
  if (ast.type === "term") return document.corpus.some((text) => includesValue([text], ast.value, options.caseSensitive));
  if (ast.type === "field") return evaluateField(ast, document, options);
  return false;
}

function metadataOnlyQuery(ast) {
  let contentRequired = false;
  walkAst(ast, (node) => {
    if (node.type === "term" || node.type === "field" && !["source", "path", "file", "ext", "size", "after", "before", "case", "normalized"].includes(node.field)) contentRequired = true;
  });
  return !contentRequired;
}

function extractStructuredItems(parsed, relativePath) {
  if (parsed == null || typeof parsed !== "object") return [];
  if (Array.isArray(parsed?.log?.entries)) {
    return parsed.log.entries.slice(0, 100_000).map((entry) => ({
      recordType: "http-exchange",
      requestId: entry?._requestId || entry?.id,
      isoTimestamp: entry?.startedDateTime,
      source: "har",
      method: entry?.request?.method,
      url: entry?.request?.url,
      statusCode: entry?.response?.status,
      durationMs: entry?.time,
      request: {
        method: entry?.request?.method,
        url: entry?.request?.url,
        headers: Object.fromEntries((entry?.request?.headers || []).map((header) => [header.name, header.value])),
        query: Object.fromEntries((entry?.request?.queryString || []).map((item) => [item.name, item.value])),
        body: entry?.request?.postData?.text,
      },
      response: {
        status: entry?.response?.status,
        headers: Object.fromEntries((entry?.response?.headers || []).map((header) => [header.name, header.value])),
        body: entry?.response?.content?.text,
      },
    }));
  }
  if (Array.isArray(parsed)) return parsed.filter((item) => item && typeof item === "object").slice(0, 100_000);
  if (parsed.kind === "xekute-application-behavior-map" && Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) return [parsed];
  for (const key of STRUCTURED_COLLECTION_KEYS) {
    if (Array.isArray(parsed[key])) return parsed[key].filter((item) => item && typeof item === "object").slice(0, 100_000);
  }
  if (/manifest\.json$/i.test(relativePath) && Array.isArray(parsed.snapshots)) return parsed.snapshots;
  return [parsed];
}

function locateStructuredLine(lines, record) {
  const anchors = [record?.id, record?.requestId, record?.title, record?.url, record?.sha256, record?.host, record?.name]
    .map(String).filter((value) => value && value !== "undefined").sort((a, b) => b.length - a.length);
  for (const anchor of anchors) {
    const encoded = JSON.stringify(anchor).slice(1, -1);
    const index = lines.findIndex((line) => line.includes(encoded) || line.includes(anchor));
    if (index >= 0) return index + 1;
  }
  return 1;
}

function findResultAnchor(lines, document, parsedQuery) {
  const activeFields = Object.keys(parsedQuery.fields || {}).filter((field) => !CONTROL_FIELDS.has(field));
  const candidates = [
    ...(parsedQuery.terms || []),
    ...Object.entries(parsedQuery.fields || {})
      .filter(([field]) => !CONTROL_FIELDS.has(field) && !["source", "ext", "size", "after", "before", "case"].includes(field))
      .flatMap(([, values]) => values),
    ...activeFields.flatMap((field) => (document.fields[field] || []).filter((value) => String(value).length > 0 && String(value).length <= 160)),
  ].filter((value) => value && !/^(?:true|false)$/i.test(value));
  const caseSensitive = parsedQuery.options?.caseSensitive;
  for (const candidate of candidates) {
    const expected = normalizeComparable(candidate, caseSensitive);
    for (let index = 0; index < lines.length; index += 1) {
      const column = normalizeComparable(lines[index], caseSensitive).indexOf(expected);
      if (column >= 0) return { line: index + 1, column: column + 1, match: lines[index].slice(column, column + String(candidate).length) };
    }
  }
  const line = Math.max(1, Math.min(lines.length, Number(document.line) || 1));
  return { line, column: Number(document.column) || 1, match: candidates[0] || "" };
}

function compactPreview(lineText, match = "") {
  const trimmed = String(lineText || "").trim();
  const index = trimmed.toLowerCase().indexOf(String(match || "").toLowerCase());
  const start = trimmed.length > 360 ? Math.max(0, index > -1 ? index - 140 : 0) : 0;
  const end = Math.min(trimmed.length, start + 360);
  return `${start ? "…" : ""}${trimmed.slice(start, end)}${end < trimmed.length ? "…" : ""}`;
}

function titleForDocument(document) {
  if (document.source === "traffic") return `${document.http.method || "HTTP"} ${document.http.host || ""}${document.http.pathname || document.http.url || ""}`.trim();
  if (document.source === "finding") return String(document.record?.title || document.record?.id || document.relativePath);
  if (document.source === "javascript") return String(document.record?.url || document.record?.id || document.relativePath);
  return document.relativePath;
}

function resultForDocument(document, lines, parsedQuery) {
  const anchor = findResultAnchor(lines, document, parsedQuery);
  const rawLine = lines[anchor.line - 1] || document.content.split(/\r?\n/)[0] || "";
  const preview = compactPreview(rawLine, anchor.match);
  return {
    path: document.relativePath,
    line: anchor.line,
    column: anchor.column,
    match: anchor.match,
    highlights: anchor.match ? [anchor.match] : [],
    lineText: preview,
    snippet: `${anchor.line}: ${preview}`,
    title: titleForDocument(document),
    source: document.source,
    kind: document.source,
    method: document.http.method || "",
    status: document.http.status || null,
    identity: document.http.identity || "",
  };
}

function bodySignature(body) {
  return String(body || "").replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "{id}").replace(/\b\d+\b/g, "{n}").replace(/\s+/g, " ").trim().slice(0, 20_000);
}

function headersSignature(headers) {
  return Object.entries(headers || {}).filter(([name]) => !/^(?:date|set-cookie|etag|last-modified|x-request-id|traceparent)$/i.test(name))
    .sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => `${name}:${value}`).join("\n");
}

function responseSimilarity(left, right) {
  const a = bodySignature(left);
  const b = bodySignature(right);
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  if (a === b) return 1;
  const aTokens = new Set(a.toLowerCase().match(/[a-z_][a-z0-9_-]{2,}/g) || []);
  const bTokens = new Set(b.toLowerCase().match(/[a-z_][a-z0-9_-]{2,}/g) || []);
  if (!aTokens.size || !bTokens.size) return 0;
  let overlap = 0;
  for (const token of aTokens) if (bTokens.has(token)) overlap += 1;
  return overlap / new Set([...aTokens, ...bTokens]).size;
}

function valuesFor(fields, name) {
  return (fields?.[name] || []).map((value) => String(value).toLowerCase());
}

function pairFeatures(left, right) {
  const leftParams = new Map(left.http.params.map((entry) => [entry.name.toLowerCase(), entry.value]));
  const rightParams = new Map(right.http.params.map((entry) => [entry.name.toLowerCase(), entry.value]));
  const commonParams = [...leftParams.keys()].filter((name) => rightParams.has(name));
  const identifierParams = commonParams.filter((name) => /(?:^|[._-])(?:id|uuid|user|account|customer|tenant|org|order|invoice|object|owner)(?:$|[._-])/i.test(name) || name.startsWith("path["));
  const sameValues = commonParams.filter((name) => leftParams.get(name) === rightParams.get(name));
  const differentValues = commonParams.filter((name) => leftParams.get(name) !== rightParams.get(name));
  const leftSuccess = left.http.status >= 200 && left.http.status < 400;
  const rightSuccess = right.http.status >= 200 && right.http.status < 400;
  const statusChanged = left.http.status !== right.http.status;
  const bodyChanged = bodySignature(left.http.responseBody) !== bodySignature(right.http.responseBody);
  const headersChanged = headersSignature(left.http.responseHeaders) !== headersSignature(right.http.responseHeaders);
  const similarity = responseSimilarity(left.http.responseBody, right.http.responseBody);
  const authChanged = left.http.authenticated !== right.http.authenticated;
  return { commonParams, identifierParams, sameValues, differentValues, leftSuccess, rightSuccess, statusChanged, bodyChanged, headersChanged, similarity, authChanged };
}

function authorizationScore(left, right, features, risk) {
  let score = 20;
  if (features.identifierParams.length) score += 24;
  if (features.sameValues.some((name) => features.identifierParams.includes(name))) score += 25;
  if (features.differentValues.some((name) => features.identifierParams.includes(name)) && features.similarity >= 0.65) score += 18;
  if (features.leftSuccess && features.rightSuccess) score += 12;
  if (/\b(?:admin|account|user|customer|tenant|org|order|invoice|profile|document|object)\b/i.test(left.http.endpoint)) score += 10;
  if (left.http.authenticated !== right.http.authenticated && features.leftSuccess && features.rightSuccess) score += 18;
  if (risk === "auth-bypass" && left.http.authenticated !== right.http.authenticated) score += 20;
  return Math.min(100, score);
}

function correlationMatchesControls(features, fields, risk) {
  const same = valuesFor(fields, "same");
  const different = valuesFor(fields, "different");
  const changed = valuesFor(fields, "changed");
  if (same.includes("param") && !features.commonParams.length) return false;
  if (same.includes("resource") && !features.sameValues.length) return false;
  if (same.includes("status") && features.statusChanged) return false;
  if (same.includes("response") && (features.bodyChanged || features.statusChanged)) return false;
  if (different.includes("value") && !features.differentValues.length) return false;
  if (different.includes("status") && !features.statusChanged) return false;
  if (different.includes("body") && !features.bodyChanged) return false;
  if (different.includes("headers") && !features.headersChanged) return false;
  if (changed.includes("status") && !features.statusChanged) return false;
  if (changed.includes("body") && !features.bodyChanged) return false;
  if (changed.includes("headers") && !features.headersChanged) return false;
  if (changed.includes("value") && !features.differentValues.length) return false;
  if (fields?.["response.diff"]?.length) {
    const responseDiffers = features.statusChanged || features.bodyChanged || features.headersChanged;
    if (booleanValue(fields["response.diff"].at(-1), false) !== responseDiffers) return false;
  }
  if (["idor", "bola"].includes(risk) && (!features.identifierParams.length || !(features.leftSuccess || features.rightSuccess))) return false;
  if (risk === "bola" && valuesFor(fields, "different").includes("value") && !features.differentValues.some((name) => features.identifierParams.includes(name))) return false;
  if (risk === "auth-bypass" && !(features.authChanged && features.leftSuccess && features.rightSuccess)) return false;
  return true;
}

function correlateAuthorization(documents, parsedQuery, { limit = 50_000 } = {}) {
  const fields = parsedQuery.fields || {};
  const risk = valuesFor(fields, "risk")[0] || "authorization";
  const requiresDistinctIdentity = ["idor", "bola", "auth-bypass"].includes(risk)
    || valuesFor(fields, "compare").includes("identity")
    || valuesFor(fields, "different").includes("identity");
  const groups = new Map();
  for (const document of documents) {
    if (!document.http?.isHttp || !document.http.endpoint) continue;
    const key = `${document.http.method || "GET"}|${document.http.host}|${document.http.endpoint}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(document);
  }
  const results = [];
  let totalCount = 0;
  let comparisons = 0;
  let comparisonCapped = false;
  const maximumComparisons = Math.max(10_000, Math.min(250_000, Number(limit) * 20));
  groupLoop: for (const group of groups.values()) {
    const byIdentity = new Map();
    for (const document of group) {
      const identity = document.http.identity || "anonymous";
      if (!byIdentity.has(identity)) byIdentity.set(identity, []);
      if (byIdentity.get(identity).length < 40) byIdentity.get(identity).push(document);
    }
    const buckets = requiresDistinctIdentity
      ? [...byIdentity.entries()]
      : group.slice(0, 100).map((document, index) => [`${document.http.identity || "anonymous"}#${index}`, [document]]);
    if (buckets.length < 2) continue;
    for (let leftIndex = 0; leftIndex < buckets.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < buckets.length; rightIndex += 1) {
        if (results.length >= limit || comparisons >= maximumComparisons) {
          comparisonCapped = true;
          break groupLoop;
        }
        let best = null;
        for (const left of buckets[leftIndex][1]) {
          for (const right of buckets[rightIndex][1]) {
            comparisons += 1;
            if (comparisons >= maximumComparisons) { comparisonCapped = true; break; }
            const features = pairFeatures(left, right);
            if (!correlationMatchesControls(features, fields, risk)) continue;
            const score = authorizationScore(left, right, features, risk);
            if (!best || score > best.score) best = { left, right, features, score };
          }
          if (comparisonCapped) break;
        }
        if (comparisonCapped && !best) break groupLoop;
        if (!best) continue;
        totalCount += 1;
        if (results.length >= limit) continue;
        const { left, right, features, score } = best;
        const statuses = `${left.http.status || "—"}/${right.http.status || "—"}`;
        const parameter = features.identifierParams[0] || features.commonParams[0] || "route";
        const parameterValue = left.http.params.find((entry) => entry.name.toLowerCase() === parameter)?.value || parameter;
        const evidenceColumn = Math.max(1, String(left.content || "").indexOf(String(parameterValue)) + 1);
        const relationship = features.sameValues.includes(parameter) ? `same ${parameter} value` : features.differentValues.includes(parameter) ? `different ${parameter} values` : "same normalized endpoint";
        const label = risk === "auth-bypass" ? "Authentication bypass comparison" : risk === "bola" ? "Potential BOLA comparison" : risk === "idor" ? "Potential IDOR comparison" : "Authorization comparison";
        const changed = [["status", features.statusChanged], ["body", features.bodyChanged], ["headers", features.headersChanged]].filter(([, yes]) => yes).map(([name]) => name);
        const evidenceLocation = left.relativePath === right.relativePath ? `L${left.line}/L${right.line}` : `${left.relativePath}:L${left.line} ↔ ${right.relativePath}:L${right.line}`;
        const detail = `${left.http.identity} ↔ ${right.http.identity} · ${relationship} · HTTP ${statuses} · response similarity ${Math.round(features.similarity * 100)}%${changed.length ? ` · changed ${changed.join(", ")}` : ""} · ${evidenceLocation}`;
        results.push({
          path: left.relativePath,
          line: left.line,
          column: evidenceColumn,
          match: String(parameterValue),
          highlights: [String(parameterValue), parameter, left.http.identity, right.http.identity].filter(Boolean),
          lineText: detail,
          snippet: `${left.line}: ${detail}`,
          title: `${label} · ${left.http.method} ${left.http.endpoint}`,
          source: "correlation",
          kind: "authorization-correlation",
          key: `Signal ${score}`,
          risk: risk === "authorization" ? "authorization" : risk,
          riskScore: score,
          identities: [left.http.identity, right.http.identity],
          status: [left.http.status, right.http.status],
          evidence: [
            { path: left.relativePath, line: left.line, identity: left.http.identity },
            { path: right.relativePath, line: right.line, identity: right.http.identity },
          ],
        });
      }
    }
  }
  results.sort((a, b) => b.riskScore - a.riskScore || a.title.localeCompare(b.title));
  return { results, totalCount, truncated: comparisonCapped || totalCount > results.length, comparisons };
}

module.exports = {
  OPERATOR_DEFINITIONS,
  CONTROL_FIELDS,
  CORRELATION_FIELDS,
  QuerySyntaxError,
  hasAdvancedSyntax,
  lexQuery,
  parseAdvancedQuery,
  collectFieldValues,
  collectQueryOptions,
  metadataOnlyQuery,
  extractStructuredItems,
  locateStructuredLine,
  deriveDocument,
  evaluateAst,
  resultForDocument,
  correlateAuthorization,
  buildDecodedVariants,
  detectSecrets,
  detectSinks,
  extractUrlLiterals,
  normalizeEndpoint,
  compactPreview,
};
