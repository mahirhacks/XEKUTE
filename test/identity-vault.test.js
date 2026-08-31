"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { createIdentityVault } = require("../src/app/storage/identity-vault-store.js");

function protector(available = true) {
  return {
    available: () => available,
    encrypt: (value) => Buffer.from(String(value), "utf8").toString("base64"),
    decrypt: (value) => Buffer.from(String(value), "base64").toString("utf8"),
  };
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-identity-vault-"));
  const workspace = path.join(root, "workspace");
  fs.mkdirSync(workspace);
  const vault = createIdentityVault({
    fs,
    path,
    crypto,
    baseDir: path.join(root, "data"),
    protector: protector(),
    projectResolver: () => ({ projectId: "project-fixture" }),
  });
  return { root, workspace, vault };
}

test("identity vault encrypts secrets and keeps workspace metadata sanitized", () => {
  const { root, workspace, vault } = fixture();
  try {
    assert.equal(vault.create(workspace, { identityId: "account-a", name: "Account A", metadata: { note: "safe", token: "do-not-store" } }).ok, true);
    const saved = vault.saveSecret(workspace, "account-a", {
      storageState: { cookies: [{ name: "session", value: "cookie-secret", domain: "fixture.test", path: "/" }], origins: [] },
      headerBindings: [{ origin: "https://fixture.test/", headers: { Authorization: "Bearer header-secret" } }],
    });
    assert.equal(saved.ok, true);
    const metadata = JSON.parse(fs.readFileSync(path.join(workspace, ".xekute", "identities", "account-a.json"), "utf8"));
    assert.equal(JSON.stringify(metadata).includes("cookie-secret"), false);
    assert.equal(JSON.stringify(metadata).includes("header-secret"), false);
    assert.equal(JSON.stringify(metadata).includes("do-not-store"), false);
    const vaultFile = path.join(root, "data", "identities", "project-fixture.json");
    const envelope = JSON.parse(fs.readFileSync(vaultFile, "utf8"));
    assert.equal(envelope.encrypted, true);
    assert.equal(JSON.stringify(envelope).includes("cookie-secret"), false);
    assert.equal(vault.readSecret(workspace, "account-a").secret.storageState.cookies[0].value, "cookie-secret");
    assert.ok(vault.metadataFor(workspace, "account-a").authSavedAt);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("identity vault stores multiple test credentials encrypted and exposes only public metadata", () => {
  const { root, workspace, vault } = fixture();
  try {
    const first = vault.createCredential(workspace, { credentialId: "account-a", label: "Account A", username: "alice@example.test", password: "password-a", role: "user" });
    const second = vault.createCredential(workspace, { credentialId: "account-b", label: "Account B", username: "bob@example.test", password: "password-b", role: "admin" });
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    const listed = vault.listCredentials(workspace);
    assert.equal(listed.ok, true);
    assert.deepEqual(listed.value.credentials.map((item) => item.credentialId), ["account-a", "account-b"]);
    assert.equal(listed.value.credentials[0].username, "alice@example.test");
    assert.equal(listed.value.credentials[0].passwordSet, true);
    assert.equal("password" in listed.value.credentials[0], false);
    const vaultFile = path.join(root, "data", "identities", "project-fixture.json");
    const envelope = JSON.parse(fs.readFileSync(vaultFile, "utf8"));
    assert.equal(envelope.encrypted, true);
    assert.equal(JSON.stringify(envelope).includes("password-a"), false);
    assert.equal(vault.readCredential(workspace, "account-b").secret.password, "password-b");
    assert.equal(vault.removeCredential(workspace, "account-a").ok, true);
    assert.deepEqual(vault.listCredentials(workspace).value.credentials.map((item) => item.credentialId), ["account-b"]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("test credential persistence fails closed when secure storage is unavailable", () => {
  const { root, workspace } = fixture();
  try {
    const vault = createIdentityVault({ fs, path, crypto, baseDir: path.join(root, "data"), protector: protector(false), projectResolver: () => ({ projectId: "project-no-secure" }) });
    const result = vault.createCredential(workspace, { label: "Account", username: "user", password: "secret" });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "SECURE_STORAGE_UNAVAILABLE");
    assert.equal(fs.existsSync(path.join(root, "data", "identities", "project-no-secure.json")), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("existing encrypted credentials report secure-storage failure without being treated as corruption", () => {
  const { root, workspace, vault } = fixture();
  try {
    assert.equal(vault.createCredential(workspace, { label: "Account", username: "user", password: "secret" }).ok, true);
    const unavailableVault = createIdentityVault({
      fs,
      path,
      crypto,
      baseDir: path.join(root, "data"),
      protector: protector(false),
      projectResolver: () => ({ projectId: "project-fixture" }),
    });
    const result = unavailableVault.listCredentials(workspace);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "SECURE_STORAGE_UNAVAILABLE");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("test credentials are isolated by project", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-credential-isolation-"));
  const workspaceA = path.join(root, "workspace-a");
  const workspaceB = path.join(root, "workspace-b");
  fs.mkdirSync(workspaceA);
  fs.mkdirSync(workspaceB);
  try {
    const vault = createIdentityVault({
      fs,
      path,
      crypto,
      baseDir: path.join(root, "data"),
      protector: protector(),
      projectResolver: (workspace) => ({ projectId: path.basename(workspace) }),
    });
    assert.equal(vault.createCredential(workspaceA, { credentialId: "account-a", label: "Account A", username: "alice", password: "secret-a" }).ok, true);
    assert.deepEqual(vault.listCredentials(workspaceA).value.credentials.map((item) => item.credentialId), ["account-a"]);
    assert.deepEqual(vault.listCredentials(workspaceB).value.credentials, []);
    assert.equal(vault.readCredential(workspaceB, "account-a").error.code, "CREDENTIAL_NOT_FOUND");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("engagement accounts update encrypted credentials and preserve omitted secrets", () => {
  const { root, workspace, vault } = fixture();
  try {
    const created = vault.saveCredential(workspace, { label: "Test Account 1", username: "alice", password: "secret-a", role: "user", cookie: "session=one" });
    assert.equal(created.ok, true);
    const credentialId = created.value.credential.credentialId;
    assert.equal(created.value.credential.cookieSet, true);
    const updated = vault.saveCredential(workspace, { credentialId, label: "Test Account 1", username: "alice-admin", password: "", role: "admin", cookie: "" });
    assert.equal(updated.ok, true);
    assert.equal(updated.value.credential.username, "alice-admin");
    assert.equal(updated.value.credential.role, "admin");
    const decrypted = vault.readCredential(workspace, credentialId);
    assert.equal(decrypted.secret.password, "secret-a");
    assert.equal(decrypted.secret.cookie, "session=one");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("identity vault repairs a corrupt primary without destroying the good encrypted backup", () => {
  const { root, workspace, vault } = fixture();
  try {
    vault.create(workspace, { identityId: "account-a" });
    vault.saveSecret(workspace, "account-a", { cookies: [{ name: "s", value: "secret-1", domain: "fixture.test", path: "/" }] });
    vault.saveSecret(workspace, "account-a", { cookies: [{ name: "s", value: "secret-2", domain: "fixture.test", path: "/" }] });
    const vaultFile = path.join(root, "data", "identities", "project-fixture.json");
    fs.writeFileSync(vaultFile, "not-json");
    const recovered = vault.readSecret(workspace, "account-a");
    assert.equal(recovered.ok, true);
    assert.equal(recovered.secret.storageState.cookies[0].value, "secret-1");
    fs.writeFileSync(vaultFile, "still-damaged");
    const recoveredAgain = vault.readSecret(workspace, "account-a");
    assert.equal(recoveredAgain.ok, true);
    assert.equal(recoveredAgain.secret.storageState.cookies[0].value, "secret-1");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("identity vault fails closed without secure storage", () => {
  const { root, workspace } = fixture();
  try {
    const vault = createIdentityVault({ fs, path, crypto, baseDir: path.join(root, "data"), protector: protector(false), projectResolver: () => ({ projectId: "project-no-secure" }) });
    assert.equal(vault.create(workspace, { identityId: "account-a" }).ok, true);
    assert.equal(vault.saveSecret(workspace, "account-a", { cookies: [{ name: "s", value: "secret", domain: "fixture.test", path: "/" }] }).error.code, "SECURE_STORAGE_UNAVAILABLE");
    assert.equal(fs.existsSync(path.join(root, "data", "identities", "project-no-secure.json")), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("legacy identity migration encrypts secrets and removes plaintext backups", () => {
  const { root, workspace, vault } = fixture();
  try {
    const legacyDir = path.join(workspace, ".xekute", "identities");
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, "legacy.json"), JSON.stringify({ identityId: "legacy", name: "Legacy", cookies: [{ name: "sid", value: "secret", domain: "fixture.test", path: "/" }], tokens: { accessToken: "token" } }));
    const result = vault.migrateLegacy(workspace);
    assert.equal(result.ok, true);
    assert.equal(result.migrated, 1);
    const metadataFile = path.join(legacyDir, "legacy.json");
    const metadata = JSON.parse(fs.readFileSync(metadataFile, "utf8"));
    assert.equal(metadata.cookies, undefined);
    assert.equal(metadata.tokens, undefined);
    assert.equal(fs.existsSync(`${metadataFile}.bak`), false);
    const loaded = vault.readSecret(workspace, "legacy");
    assert.equal(loaded.ok, true);
    assert.equal(loaded.secret.unmappedTokens.accessToken, "token");
    assert.equal(loaded.metadata.requiresMapping, true);
    assert.equal(vault.migrateLegacy(workspace).migrated, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("identity deletion removes encrypted current and backup records", () => {
  const { root, workspace, vault } = fixture();
  try {
    vault.create(workspace, { identityId: "account-a" });
    vault.saveSecret(workspace, "account-a", { cookies: [{ name: "s", value: "secret", domain: "fixture.test", path: "/" }] });
    vault.saveSecret(workspace, "account-a", { cookies: [{ name: "s", value: "secret-2", domain: "fixture.test", path: "/" }] });
    assert.equal(vault.remove(workspace, "account-a").ok, true);
    assert.equal(vault.list(workspace).value.identities.length, 0);
    assert.equal(fs.existsSync(path.join(root, "data", "identities", "project-fixture.json.bak")), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("identity vault keeps client private keys encrypted while exposing only a safe certificate reference to working memory", () => {
  const { root, workspace, vault } = fixture();
  try {
    vault.create(workspace, { identityId: "mtls" });
    const saved = vault.saveSecret(workspace, "mtls", {
      clientCertificates: [{
        certificateId: "client-a",
        origin: "https://fixture.test",
        certificateChain: "-----BEGIN CERTIFICATE-----\ncert",
        privateKey: "-----BEGIN PRIVATE KEY-----\nprivate-key-secret",
        passphrase: "certificate-passphrase",
      }],
    });
    assert.equal(saved.ok, true);
    assert.equal(saved.value.identity.certificateCount, 1);
    const vaultFile = path.join(root, "data", "identities", "project-fixture.json");
    const persisted = fs.readFileSync(vaultFile, "utf8");
    assert.equal(persisted.includes("private-key-secret"), false);
    assert.equal(persisted.includes("certificate-passphrase"), false);
    const loaded = vault.readSecret(workspace, "mtls");
    assert.equal(loaded.ok, true);
    assert.equal(loaded.secret.clientCertificates[0].privateKey.includes("private-key-secret"), true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
