---
id: nosqli
title: NoSQL injection
summary: Test JSON, query, and filter inputs for unintended NoSQL operator or expression semantics.
category: injection
level: standard
signals: ["mongodb", "nosql", "json filter", "operator", "query"]
technologies: ["mongodb", "document db", "rest", "graphql"]
related: ["sqli", "advance_sqli", "api_schema_abuse"]
---

## Workflow

Use observed JSON schemas and a baseline query. Compare one field's expected scalar type with a bounded operator/control variant, and require reproducible authorization or query-semantics impact. Do not extract records.
