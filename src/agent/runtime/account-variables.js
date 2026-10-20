"use strict";

// Account variables let the agent use the project's test accounts without
// seeing their secrets. Tool arguments carry {{account.<id>.<field>}}; the main
// process swaps in the stored value just before a tool runs, and every tool
// result has the project's stored passwords and cookies masked back to their
// variable before the agent or the audit log sees it.

const VARIABLE = /\{\{\s*account\.([A-Za-z0-9._-]+)\.(username|password|cookie)\s*\}\}/g;
// Shorter values would also mask unrelated text in every result.
const MIN_MASKED_LENGTH = 4;
// Screenshots and other encoded blobs could contain a short secret by chance.
const ENCODED_BLOB = /^(?:data:[^,]{0,100},)?[A-Za-z0-9+/=\r\n]{4096,}$/;

function accountVariable(accountId, field) {
  return `{{account.${accountId}.${field}}}`;
}

function mapStrings(value, transform) {
  if (typeof value === "string") return transform(value);
  if (Array.isArray(value)) return value.map(item => mapStrings(item, transform));
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return value;
  const result = {};
  for (const [key, item] of Object.entries(value)) result[key] = mapStrings(item, transform);
  return result;
}

// accounts: Map of accountId -> { secret: { username, password, cookie } }.
function resolveAccountVariables(args, accounts) {
  let failure = "";
  const resolved = mapStrings(args, text => text.replace(VARIABLE, (match, accountId, field) => {
    const value = accounts.get(accountId)?.secret?.[field];
    if (value) return value;
    failure ||= accounts.has(accountId)
      ? `Test account ${accountId} has no ${field} saved. Ask the operator to add it in Settings > Project > Engagement.`
      : `There is no test account ${accountId}. Use one listed under testAccounts in the project settings.`;
    return match;
  }));
  if (failure) return { ok: false, error: { code: "ACCOUNT_VARIABLE_UNRESOLVED", message: failure, retryable: false } };
  return { ok: true, args: resolved };
}

// The raw value and the forms it takes in URLs and form bodies.
function variants(value) {
  if (value.length < MIN_MASKED_LENGTH) return [];
  const uri = encodeURIComponent(value);
  return [...new Set([value, uri, uri.replace(/%20/g, "+"), new URLSearchParams({ v: value }).toString().slice(2)])];
}

function cookieValues(cookie) {
  return String(cookie || "").split(";")
    .map(pair => pair.slice(pair.indexOf("=") + 1).trim())
    .filter(Boolean);
}

// Each needle is replaced by the variable that produces it, longest first so a
// cookie header is masked whole before its individual values.
function accountMasks(accounts) {
  const masks = new Map();
  for (const [accountId, { secret = {} }] of accounts) {
    const { username = "", password = "", cookie = "" } = secret;
    if (password.length >= MIN_MASKED_LENGTH) {
      for (const form of variants(password)) masks.set(form, accountVariable(accountId, "password"));
      if (username) {
        const basic = Buffer.from(`${username}:${password}`).toString("base64");
        masks.set(basic, `base64(${accountVariable(accountId, "username")}:${accountVariable(accountId, "password")})`);
      }
    }
    if (cookie.length >= MIN_MASKED_LENGTH) {
      for (const form of variants(cookie)) masks.set(form, accountVariable(accountId, "cookie"));
      for (const part of cookieValues(cookie)) {
        for (const form of variants(part)) if (!masks.has(form)) masks.set(form, accountVariable(accountId, "cookie"));
      }
    }
  }
  return [...masks].sort((a, b) => b[0].length - a[0].length);
}

function maskAccountSecrets(value, masks) {
  if (!masks.length) return value;
  return mapStrings(value, text => {
    if (ENCODED_BLOB.test(text)) return text;
    let masked = text;
    for (const [needle, variable] of masks) if (masked.includes(needle)) masked = masked.split(needle).join(variable);
    return masked;
  });
}

// vault: the identity vault store. Returns a Map of accountId -> { label,
// role, username, passwordSet, cookieSet, secret }.
function loadAccounts(vault, workspace) {
  const accounts = new Map();
  if (!workspace || typeof vault?.listCredentials !== "function") return accounts;
  const listed = vault.listCredentials(workspace);
  if (!listed?.ok) return accounts;
  for (const credential of listed.value?.credentials || []) {
    const read = vault.readCredential(workspace, credential.credentialId);
    if (read?.ok) accounts.set(credential.credentialId, { ...credential, secret: read.secret || {} });
  }
  return accounts;
}

// What the model is told: labels, roles, usernames and the variables to use.
function describeAccounts(accounts) {
  if (!accounts.size) return null;
  return {
    usage: "Use these variables wherever an account value belongs: browser fields, request headers or bodies, and commands. Xekute substitutes the stored value when the tool runs and masks it in results. Passwords and cookies are never shown; write the variable, not a guess.",
    accounts: [...accounts].map(([accountId, account]) => ({
      label: account.label,
      role: account.role || "user",
      username: account.username,
      variables: {
        username: accountVariable(accountId, "username"),
        ...(account.secret?.password ? { password: accountVariable(accountId, "password") } : {}),
        ...(account.secret?.cookie ? { cookie: accountVariable(accountId, "cookie") } : {}),
      },
    })),
  };
}

module.exports = {
  accountMasks,
  accountVariable,
  describeAccounts,
  loadAccounts,
  maskAccountSecrets,
  resolveAccountVariables,
};
