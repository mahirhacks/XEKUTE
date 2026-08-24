---
id: cache_deception
title: Cache deception
summary: Test whether private responses are cached under public-looking paths or extensions.
category: server-side
level: advanced
signals: ["cache", "private", "path", "extension", "cdn"]
technologies: ["cdn", "web"]
related: ["cache_poisoning", "file_download_authorization", "bola"]
---

## Workflow

Use disposable authenticated content and compare private/public cache headers, path normalization, and clean-session retrieval. Do not expose real personal data.
