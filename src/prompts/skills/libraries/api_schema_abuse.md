---
id: api_schema_abuse
title: API schema and input abuse
summary: Test undocumented fields, type confusion, excessive data exposure, and schema enforcement across observed APIs.
category: api
level: standard
signals: ["openapi", "schema", "json", "field", "type", "api"]
technologies: ["rest", "graphql", "grpc"]
related: ["mass_assignment", "bola", "graphql", "sqli"]
---

## Workflow

Compare documented/observed schemas with one-field additions, omissions, type changes, and response projections. Require an actual authorization, integrity, or confidentiality effect and preserve a negative control.
