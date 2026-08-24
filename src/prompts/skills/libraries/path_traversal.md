---
id: path_traversal
title: Path traversal
summary: Test file path normalization and authorization using an in-scope disposable path or known safe fixture.
category: files
level: standard
signals: ["file", "path", "download", "include", "filename"]
technologies: ["web", "rest", "server"]
related: ["file_upload", "file_download_authorization", "ssrf"]
---

## Workflow

Identify file operations and compare canonical, encoded, separator, and normalization variants only against approved fixtures. Require access beyond the intended directory or object and stop before reading sensitive system files.
