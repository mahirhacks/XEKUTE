---
id: sensitive_data_exposure
title: Sensitive data exposure
summary: Test whether secrets, personal data, debug details, or internal metadata cross an intended trust boundary.
category: platform
level: standard
signals: ["secret", "token", "pii", "debug", "stack trace", "source map"]
technologies: ["web", "rest", "logs", "javascript"]
related: ["bola", "file_download_authorization", "client_storage"]
---

## Workflow

Inspect redacted traffic, artifacts, logs, errors, and storage for data classes. Verify owner/tenant/role access and retention without copying secrets into model context. Record classification, location, exposure path, and remediation.
