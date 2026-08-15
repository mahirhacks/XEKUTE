# Prompt guardrails

This directory contains model-facing guidance only. It cannot authorize,
deny, or dispatch a tool. Runtime filesystem and network decisions live in
`src/agent/authority/scope`.
