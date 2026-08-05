# Identity Secret Storage

XEKUTE stores public identity descriptors separately from host-only secret records.

- **Encryption:** the injected Electron `safeStorage` adapter encrypts each secret blob before persistence.
- **Key ownership:** platform key ownership remains with Electron/safeStorage; XEKUTE never writes keys or plaintext secrets to project files.
- **Assessment isolation:** records live under the assessment workspace `.xekute/identity-secrets.json`, with `0700` directory and `0600` file permissions where supported.
- **Rotation:** trusted local operator code replaces the encrypted blob and increments `secret_version`; model-visible identity IDs remain stable.
- **Revocation:** revocation updates only the public descriptor status and immediately prevents selection/replay.
- **Backup/deletion:** backups must remain platform-protected; deletion removes the encrypted record and descriptor through the trusted operator path.
- **Migration:** no legacy secret values are imported into model-visible schemas. Migration may copy encrypted records only when the operator explicitly selects an assessment.

The model receives only `IdentityDescriptor` metadata and opaque `identity_id` values. Raw cookies, tokens, headers, credentials, and encrypted blobs never enter model context, logs, audit records, or evidence metadata.
