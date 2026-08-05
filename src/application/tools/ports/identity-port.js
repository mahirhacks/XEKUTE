"use strict";

const crypto = require("node:crypto");
const { identityDescriptor, validateIdentityDescriptor } = require("../../../contracts/tool/identity");

function createIdentityPort({ fs, path, protector, assessmentWorkspace } = {}) {
  function storeFile(context) { return path.join(context.workspace, ".xekute", "identity-secrets.json"); }
  function load(context) {
    try { return JSON.parse(fs.readFileSync(storeFile(context), "utf8")); } catch { return { version: 1, identities: {} }; }
  }
  function save(context, value) {
    const target = storeFile(context);
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  }
  function encrypt(secret) {
    if (!protector?.available?.()) return { ok: false, code: "PROTECTED_STORAGE_UNAVAILABLE", error: "Protected local storage is unavailable." };
    return { ok: true, value: protector.encrypt(String(secret || "")) };
  }
  async function execute(input, context) {
    const document = load(context);
    const records = Object.values(document.identities);
    if (input.action === "list") return { ok: true, identities: records.map((item) => item.descriptor).filter((item) => item.assessment_id === input.assessment_id) };
    if (["describe", "status"].includes(input.action)) {
      const record = document.identities[input.identity_id];
      if (!record) return { ok: false, error: "Identity not found.", code: "IDENTITY_NOT_FOUND" };
      const validation = validateIdentityDescriptor(record.descriptor, { assessmentId: input.assessment_id });
      return { ok: validation.ok, identity: record.descriptor, ...(validation.ok ? {} : { error: validation.error, code: validation.code }) };
    }
    if (input.action === "select") {
      const record = document.identities[input.identity_id];
      if (!record) return { ok: false, error: "Identity not found.", code: "IDENTITY_NOT_FOUND" };
      const validation = validateIdentityDescriptor(record.descriptor, { assessmentId: input.assessment_id });
      if (!validation.ok) return validation;
      record.descriptor = identityDescriptor({ ...record.descriptor, selection_scope: input.selection_scope || "operation", selected_by: context.actorId, selection_expires_at: input.expires_at || new Date(Date.now() + 300000).toISOString() });
      save(context, document);
      return { ok: true, identity: record.descriptor };
    }
    if (input.action === "revoke") {
      const record = document.identities[input.identity_id];
      if (!record) return { ok: false, error: "Identity not found.", code: "IDENTITY_NOT_FOUND" };
      record.descriptor = identityDescriptor({ ...record.descriptor, revoked: true, session_status: "revoked" });
      save(context, document);
      return { ok: true, identity: record.descriptor };
    }
    if (input.action === "refresh") return { ok: false, unavailable: true, code: "OPERATOR_SECRET_IMPORT_REQUIRED", error: "Identity refresh requires the trusted local operator path." };
    return { ok: false, error: `Unsupported identity action: ${input.action}`, code: "UNKNOWN_ACTION" };
  }
  function importSecret(context, descriptorInput, secret) {
    const encrypted = encrypt(secret);
    if (!encrypted.ok) return encrypted;
    const document = load(context);
    const descriptor = identityDescriptor({ ...descriptorInput, assessment_id: context.assessmentId || descriptorInput.assessment_id, identity_id: descriptorInput.identity_id || `identity-${crypto.randomUUID()}`, session_status: "active" });
    document.identities[descriptor.identity_id] = { descriptor, encrypted_secret_blob: encrypted.value, secret_version: 1, created_at: new Date().toISOString(), rotated_at: new Date().toISOString() };
    save(context, document);
    return { ok: true, identity: descriptor };
  }
  return Object.freeze({ execute, importSecret });
}

module.exports = { createIdentityPort };
