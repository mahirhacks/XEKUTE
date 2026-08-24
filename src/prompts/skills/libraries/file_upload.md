---
id: file_upload
title: File-upload security
summary: Test type, content, storage, retrieval, authorization, and processing controls with harmless test files.
category: files
level: standard
signals: ["upload", "multipart", "file", "image", "document", "processing"]
technologies: ["web", "rest", "storage"]
related: ["xss", "xxe", "path_traversal", "file_download_authorization"]
---

## Workflow

Use disposable files and inspect MIME, extension, content, storage path, retrieval authorization, preview, and processing behavior. Never upload executable or weaponized content. Verify cross-user access and server-side type enforcement.
