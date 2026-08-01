const zlib = require("zlib");
const { promisify } = require("util");

const gunzip = promisify(zlib.gunzip);
const inflate = promisify(zlib.inflate);
const inflateRaw = promisify(zlib.inflateRaw);
const brotliDecompress = promisify(zlib.brotliDecompress);

/** Detect compression from buffer magic bytes as a fallback */
function sniffEncoding(buf) {
  if (!buf || buf.length < 2) return "identity";
  if (buf[0] === 0x1f && buf[1] === 0x8b) return "gzip";
  if (buf[0] === 0x78 && (buf[1] === 0x01 || buf[1] === 0x9c || buf[1] === 0xda || buf[1] === 0x5e)) return "deflate";
  return "identity";
}

async function tryDecompress(fn, buf) {
  try {
    return await fn(buf);
  } catch {
    return null;
  }
}

async function decompressBuffer(buffer, encoding) {
  const enc = String(encoding || "").toLowerCase().trim();
  if (enc === "gzip" || enc === "x-gzip") {
    const result = await tryDecompress(gunzip, buffer);
    if (result) return result;
  } else if (enc === "deflate") {
    const result = await tryDecompress(inflate, buffer) ?? await tryDecompress(inflateRaw, buffer);
    if (result) return result;
  } else if (enc === "br") {
    const result = await tryDecompress(brotliDecompress, buffer);
    if (result) return result;
  }

  const sniffed = sniffEncoding(buffer);
  if (sniffed === "gzip") {
    const result = await tryDecompress(gunzip, buffer);
    if (result) return result;
  } else if (sniffed === "deflate") {
    const result = await tryDecompress(inflate, buffer) ?? await tryDecompress(inflateRaw, buffer);
    if (result) return result;
  }

  return buffer;
}

function isMostlyText(buffer) {
  if (!buffer || buffer.length === 0) return true;
  let replacement = 0;
  let control = 0;
  const text = buffer.toString("utf8");
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code === 0xfffd) replacement += 1;
    else if (code < 32 && code !== 9 && code !== 10 && code !== 13) control += 1;
  }
  const len = Math.max(text.length, 1);
  return replacement <= Math.max(1, len * 0.02) && control <= Math.max(1, len * 0.05);
}

function formatBinaryBody(buffer) {
  const max = 512;
  const preview = buffer.subarray(0, max);
  const hexLines = [];
  for (let i = 0; i < preview.length; i += 16) {
    const slice = preview.subarray(i, i + 16);
    const hex = [...slice].map((b) => b.toString(16).padStart(2, "0")).join(" ");
    const ascii = [...slice].map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : ".")).join("");
    hexLines.push(`${i.toString(16).padStart(4, "0")}: ${hex.padEnd(48)}  ${ascii}`);
  }
  const suffix = buffer.length > max ? `\n... (${buffer.length - max} more bytes)` : "";
  return `[binary body, ${buffer.length} bytes]\n${hexLines.join("\n")}${suffix}`;
}

function bufferToDisplayText(buffer) {
  if (!buffer || buffer.length === 0) return "";
  if (isMostlyText(buffer)) return buffer.toString("utf8");
  return formatBinaryBody(buffer);
}

function headerValue(headers = {}, wanted = "") {
  const entry = Object.entries(headers).find(([name]) => name.toLowerCase() === String(wanted).toLowerCase());
  return entry ? String(entry[1]) : "";
}

function decodeTextBuffer(buffer, contentType = "") {
  const charset = String(contentType).match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1]?.toLowerCase() || "utf-8";
  if (["latin1", "iso-8859-1", "windows-1252"].includes(charset)) return buffer.toString("latin1");
  if (["utf-16", "utf-16le", "ucs-2", "ucs2"].includes(charset)) return buffer.toString("utf16le");
  return buffer.toString("utf8");
}

function isTextContentType(contentType = "") {
  const type = String(contentType).split(";", 1)[0].trim().toLowerCase();
  return type.startsWith("text/")
    || /(?:json|xml|javascript|graphql|x-www-form-urlencoded|yaml|csv|sql)$/.test(type)
    || type === "application/http";
}

function formatMultipartBody(buffer, contentType = "") {
  const boundary = String(contentType).match(/boundary\s*=\s*(?:"([^"]+)"|([^;\s]+))/i)?.slice(1).find(Boolean);
  if (!boundary) return bufferToDisplayText(buffer);
  const delimiter = Buffer.from(`--${boundary}`);
  const parts = [];
  let cursor = 0;
  while (cursor < buffer.length) {
    const start = buffer.indexOf(delimiter, cursor);
    if (start < 0) break;
    const next = buffer.indexOf(delimiter, start + delimiter.length);
    if (next < 0) break;
    let part = buffer.subarray(start + delimiter.length, next);
    if (part.subarray(0, 2).equals(Buffer.from("\r\n"))) part = part.subarray(2);
    if (part.length >= 2 && part.subarray(part.length - 2).equals(Buffer.from("\r\n"))) part = part.subarray(0, part.length - 2);
    const separator = part.indexOf(Buffer.from("\r\n\r\n"));
    if (separator >= 0) {
      const head = part.subarray(0, separator).toString("utf8");
      const body = part.subarray(separator + 4);
      const partType = head.match(/^content-type:\s*(.+)$/im)?.[1] || "";
      const disposition = head.match(/^content-disposition:\s*(.+)$/im)?.[1] || "";
      const name = disposition.match(/\bname="([^"]*)"/i)?.[1] || "field";
      const fileName = disposition.match(/\bfilename="([^"]*)"/i)?.[1] || "";
      const display = !fileName && (isTextContentType(partType) || isMostlyText(body))
        ? decodeTextBuffer(body, partType)
        : `[binary upload${fileName ? `: ${fileName}` : ""}, ${body.length} bytes${partType ? `, ${partType}` : ""}]`;
      parts.push(`${head}\r\n\r\n${display}`);
      if (!head) parts.push(`Content-Disposition: form-data; name="${name}"\r\n\r\n${display}`);
    }
    cursor = next;
  }
  if (!parts.length) return bufferToDisplayText(buffer);
  return parts.map((part) => `--${boundary}\r\n${part}\r\n`).join("") + `--${boundary}--`;
}

async function decodeHttpRequestBody(buffer, headers = {}) {
  if (!buffer || buffer.length === 0) return "";
  const decoded = await decompressBuffer(buffer, getContentEncoding(headers));
  const contentType = headerValue(headers, "content-type");
  if (/^multipart\//i.test(contentType)) return formatMultipartBody(decoded, contentType);
  if (isTextContentType(contentType)) return decodeTextBuffer(decoded, contentType);
  return bufferToDisplayText(decoded);
}

/**
 * Decode an HTTP body for display: honor Content-Encoding, sniff gzip/deflate,
 * then render readable text or a hex dump for binary/protobuf payloads.
 */
async function decodeHttpBody(buffer, contentEncoding) {
  if (!buffer || buffer.length === 0) return "";
  const decoded = await decompressBuffer(buffer, contentEncoding);
  return bufferToDisplayText(decoded);
}

function getContentEncoding(headers = {}) {
  const entry = Object.entries(headers).find(([k]) => k.toLowerCase() === "content-encoding");
  return entry ? String(entry[1]) : "";
}

function headersWithoutEncoding(headers = {}) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() !== "content-encoding") out[k] = v;
  }
  return out;
}

function headersWithDecodedBodyLength(headers = {}, body = "") {
  const out = headersWithoutEncoding(headers);
  if (body) out["content-length"] = String(Buffer.byteLength(body, "utf8"));
  else delete out["content-length"];
  return out;
}

module.exports = {
  decodeHttpBody,
  sniffEncoding,
  formatBinaryBody,
  bufferToDisplayText,
  getContentEncoding,
  headersWithoutEncoding,
  headersWithDecodedBodyLength,
  decodeHttpRequestBody,
  formatMultipartBody,
  isTextContentType,
};
