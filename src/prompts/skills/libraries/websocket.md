---
id: websocket
title: WebSocket authorization
summary: Test handshake, channel, message, object, and tenant authorization for observed WebSocket flows.
category: api
level: advanced
signals: ["websocket", "channel", "message", "subscribe", "event"]
technologies: ["websocket", "web", "realtime"]
related: ["bola", "bfla", "csrf"]
---

## Workflow

Map handshake identity and message schemas. Compare authorized/unauthorized subscriptions and object messages with a disposable channel. Preserve event evidence and close sessions after minimal proof.
