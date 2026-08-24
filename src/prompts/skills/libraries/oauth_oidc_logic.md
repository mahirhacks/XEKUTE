---
id: oauth_oidc_logic
title: OAuth and OIDC logic
summary: Test redirect, state, nonce, client, scope, token, and account-linking boundaries.
category: authentication
level: advanced
signals: ["oauth", "oidc", "redirect_uri", "state", "nonce", "scope"]
technologies: ["oauth", "oidc", "web"]
related: ["auth_logic", "jwt_logic", "open_redirect"]
---

## Workflow

Map authorization and callback states. Compare exact redirect/client/scope/nonce/state controls using test identities. Verify account linking and token audience, and stop before accessing unrelated accounts or providers.
