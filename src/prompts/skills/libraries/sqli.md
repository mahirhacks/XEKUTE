---
id: sqli
title: SQL injection
summary: Test whether controlled input changes database query semantics using bounded differential and error-based checks.
category: injection
level: standard
signals: ["sql", "database", "query", "search", "filter", "sort", "error"]
technologies: ["sql", "rest", "web", "orm"]
related: ["advance_sqli", "nosqli", "command_injection", "server_template_injection"]
---

## Prerequisites

Identify a permitted input, baseline response, request budget, and a non-destructive control. Prefer supplied errors, query patterns, or code artifacts over blind probing.

## Workflow

- Change one parameter at a time and compare status, body fingerprint, timing, row count, and error behavior.
- Test the parameter's observed type and context: numeric, string, sort, filter, JSON, path, or header.
- Use benign syntax variations and negative controls before any proof requiring more than a single request.
- Confirm whether an ORM, stored procedure, query builder, or API gateway changes the interpretation.
- Stop when the differential is explained by validation, normalization, caching, or a stable application error.

## Verification rules

Require a reproducible query-semantics change tied to the controlled input and a consistent control. Do not infer SQLi from a database product banner, generic `500`, or scanner title.
