---
id: file_download_authorization
title: File-download authorization
summary: Test ownership and tenant controls on downloads, previews, exports, and generated files.
category: files
level: standard
signals: ["download", "export", "preview", "attachment", "file id"]
technologies: ["web", "rest", "storage"]
related: ["bola", "idor", "file_upload"]
---

## Workflow

Build an owner/peer/tenant matrix for every file reference and alternate delivery path. Compare status, content, metadata, cache behavior, and signed-link expiry using disposable files.
