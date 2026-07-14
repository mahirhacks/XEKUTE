const dns = require("node:dns");
const net = require("node:net");

const DEFAULT_TIMEOUT_MS = 12000;
const MAX_SEARCH_BYTES = 750000;
const MAX_PAGE_BYTES = 1000000;
const MAX_RAW_ASSET_BYTES = 3000000;
const MAX_REDIRECTS = 4;
const USER_AGENT = "Pointer/0.1 local research assistant";

function decodeHtmlEntities(value) {
  const named = {
    amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"',
    ndash: "-", mdash: "-", hellip: "...", rsquo: "'", lsquo: "'",
    rdquo: '"', ldquo: '"', bull: "*", middot: "*",
  };
  return String(value || "").replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === "#") {
      const hex = entity[1]?.toLowerCase() === "x";
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
        try { return String.fromCodePoint(code); } catch { return match; }
      }
      return match;
    }
    return named[entity.toLowerCase()] ?? match;
  });
}

function stripTags(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]*>/g, " "))
    .replace(/[\t\r ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

function isPrivateIpv4(address) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = parts;
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0 && c === 2)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a >= 224;
}

function isPrivateIp(rawAddress) {
  const address = String(rawAddress || "").trim().toLowerCase().replace(/^\[|\]$/g, "");
  const family = net.isIP(address);
  if (family === 4) return isPrivateIpv4(address);
  if (family !== 6) return true;

  const mapped = address.match(/^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return isPrivateIpv4(mapped[1]);
  return address === "::"
    || address === "::1"
    || address.startsWith("fc")
    || address.startsWith("fd")
    || /^fe[89ab]/.test(address)
    || address.startsWith("ff")
    || address.startsWith("2001:db8:");
}

function isPrivateHostname(rawHostname) {
  const hostname = String(rawHostname || "").trim().toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  if (!hostname) return true;
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) return true;
  if (hostname === "metadata.google.internal" || hostname.endsWith(".internal")) return true;
  return net.isIP(hostname) ? isPrivateIp(hostname) : false;
}

function parseHttpUrl(rawUrl) {
  let url;
  try { url = new URL(String(rawUrl || "").trim()); } catch { throw new Error("Invalid URL"); }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only HTTP and HTTPS URLs are allowed");
  if (url.username || url.password) throw new Error("URLs containing credentials are blocked");
  if (isPrivateHostname(url.hostname)) throw new Error("Private or local network URLs are blocked");
  return url;
}

async function assertPublicDestination(url, lookup) {
  if (net.isIP(url.hostname.replace(/^\[|\]$/g, ""))) return;
  let records;
  try {
    records = await lookup(url.hostname, { all: true, verbatim: true });
  } catch (error) {
    throw new Error(`Could not resolve ${url.hostname}: ${error.message}`);
  }
  const addresses = Array.isArray(records) ? records : [records];
  if (!addresses.length || addresses.some((record) => isPrivateIp(record?.address || record))) {
    throw new Error("The URL resolves to a private or reserved network address");
  }
}

async function readResponseText(response, maxBytes) {
  const declared = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error(`Response exceeds the ${maxBytes}-byte limit`);

  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        try { await reader.cancel(); } catch { /* ignore */ }
        throw new Error(`Response exceeds the ${maxBytes}-byte limit`);
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks).toString("utf8");
  }

  const text = typeof response.text === "function" ? await response.text() : String(response.body || "");
  if (Buffer.byteLength(text, "utf8") > maxBytes) throw new Error(`Response exceeds the ${maxBytes}-byte limit`);
  return text;
}

async function fetchPublicUrl(rawUrl, {
  fetchImpl,
  lookup,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxBytes = MAX_PAGE_BYTES,
  validateDestination = true,
} = {}) {
  let current = parseHttpUrl(rawUrl);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    if (validateDestination) await assertPublicDestination(current, lookup);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: { Accept: "text/html,text/plain,application/json,application/xhtml+xml", "User-Agent": USER_AGENT },
      });
    } catch (error) {
      if (error?.name === "AbortError") throw new Error(`Request timed out after ${timeoutMs}ms`);
      throw error;
    } finally {
      clearTimeout(timer);
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers?.get?.("location");
      if (!location) throw new Error("Redirect response did not include a destination");
      if (redirects === MAX_REDIRECTS) throw new Error("Too many redirects");
      current = parseHttpUrl(new URL(location, current).toString());
      continue;
    }
    if (!response.ok) throw new Error(`Request failed with HTTP ${response.status}`);
    return { response, finalUrl: current.toString(), text: await readResponseText(response, maxBytes) };
  }
  throw new Error("Too many redirects");
}

function normalizeSearchUrl(rawHref) {
  const href = decodeHtmlEntities(rawHref).trim();
  try {
    const url = new URL(href, "https://html.duckduckgo.com");
    const redirected = url.searchParams.get("uddg");
    const target = redirected ? new URL(redirected) : url;
    if (!["http:", "https:"].includes(target.protocol) || isPrivateHostname(target.hostname)) return "";
    return target.toString();
  } catch {
    return "";
  }
}

function parseSearchHtml(html, limit = 6) {
  const source = String(html || "");
  const anchors = [...source.matchAll(/<a\b[^>]*class=["'][^"']*(?:result__a|result-link)[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const results = [];
  for (let index = 0; index < anchors.length && results.length < limit; index += 1) {
    const match = anchors[index];
    const url = normalizeSearchUrl(match[1]);
    const title = stripTags(match[2]);
    if (!url || !title || results.some((row) => row.url === url)) continue;
    const end = anchors[index + 1]?.index ?? Math.min(source.length, match.index + 5000);
    const block = source.slice(match.index, end);
    const snippetMatch = block.match(/<(?:a|div|span)\b[^>]*class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div|span)>/i);
    results.push({ rank: results.length + 1, title, url, snippet: stripTags(snippetMatch?.[1] || "") });
  }
  return results;
}

function extractReadableText(html, maxChars = 18000) {
  const source = String(html || "");
  const title = stripTags(source.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
  const body = source.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] || source;
  let content = body
    .replace(/<!--([\s\S]*?)-->/g, " ")
    .replace(/<(script|style|noscript|svg|canvas|iframe|form|nav|header|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|hr)\b[^>]*>/gi, "\n")
    .replace(/<\/(p|div|section|article|main|aside|li|h[1-6]|tr|pre|blockquote)>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "- ");
  content = stripTags(content)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const limit = Math.max(1000, Math.min(Number(maxChars) || 18000, 30000));
  const truncated = content.length > limit;
  return { title, content: truncated ? `${content.slice(0, limit)}\n...(page truncated)` : content, truncated };
}

function createWebResearch({ fetchImpl = globalThis.fetch, lookup = dns.promises.lookup } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required");

  async function searchWeb(query, options = {}) {
    const cleanQuery = String(query || "").trim().slice(0, 300);
    if (!cleanQuery) return { error: "Missing search query" };
    const limit = Math.max(1, Math.min(Math.round(Number(options.limit) || 6), 10));
    const endpoint = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(cleanQuery)}`;
    try {
      const { text } = await fetchPublicUrl(endpoint, {
        fetchImpl,
        lookup,
        maxBytes: MAX_SEARCH_BYTES,
        timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
      });
      const results = parseSearchHtml(text, limit);
      if (!results.length) return { error: "The search provider returned no readable results. Try a more specific query." };
      return { ok: true, provider: "DuckDuckGo", query: cleanQuery, count: results.length, results };
    } catch (error) {
      return { error: `Web search failed: ${error.message}` };
    }
  }

  async function fetchWebPage(rawUrl, options = {}) {
    try {
      const { response, finalUrl, text } = await fetchPublicUrl(rawUrl, {
        fetchImpl,
        lookup,
        maxBytes: MAX_PAGE_BYTES,
        timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
      });
      const contentType = String(response.headers?.get?.("content-type") || "").toLowerCase();
      if (contentType && !/text\/(?:html|plain)|application\/(?:json|xhtml\+xml)/.test(contentType)) {
        return { error: `Unsupported content type: ${contentType.split(";")[0]}` };
      }
      const maxChars = Math.max(1000, Math.min(Number(options.maxChars) || 18000, 30000));
      const readable = /html|xhtml/.test(contentType) || /<html\b|<body\b/i.test(text)
        ? extractReadableText(text, maxChars)
        : { title: "", content: text.length > maxChars ? `${text.slice(0, maxChars)}\n...(page truncated)` : text, truncated: text.length > maxChars };
      if (!readable.content.trim()) return { error: "The page did not contain readable text" };
      return { ok: true, url: String(rawUrl), finalUrl, contentType, ...readable };
    } catch (error) {
      return { error: `Page fetch failed: ${error.message}` };
    }
  }

  async function fetchRawUrl(rawUrl, options = {}) {
    try {
      const result = await fetchPublicUrl(rawUrl, {
        fetchImpl,
        lookup,
        // Raw WebClone assets (especially bundled JavaScript) can be larger
        // than readable-page responses, while still remaining bounded.
        maxBytes: Math.max(1024, Math.min(Number(options.maxBytes) || MAX_PAGE_BYTES, MAX_RAW_ASSET_BYTES)),
        timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
      });
      return { ok: true, url: String(rawUrl), finalUrl: result.finalUrl, response: result.response, text: result.text };
    } catch (error) {
      return { error: `Page fetch failed: ${error.message}` };
    }
  }

  return { searchWeb, fetchWebPage, fetchRawUrl };
}

module.exports = {
  createWebResearch,
  decodeHtmlEntities,
  extractReadableText,
  isPrivateHostname,
  isPrivateIp,
  parseHttpUrl,
  parseSearchHtml,
};
