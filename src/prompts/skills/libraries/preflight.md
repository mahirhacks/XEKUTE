---
title: Target Preflight & Technology Discovery
phase: initialization
---

# XEKUTE Preflight

## 1. Metadata

```yaml
id: preflight
name: Target Preflight & Technology Discovery
version: 1.0
phase: initialization
priority: mandatory

purpose:
  - target_identification
  - technology_discovery
  - infrastructure_discovery
  - architecture_classification
  - intelligence_initialization

risk_level: low

execution:
  passive_preferred: true
  low_impact_requests_allowed: true
  exploitation_allowed: false
  vulnerability_testing_allowed: false
```

Preflight runs at the beginning of a new scoped web assessment.

Its responsibility is to determine **what the target is technically** before XEKUTE decides how to assess it.

---

# 2. Purpose

Convert:

```text
https://target.example
```

into an evidence-backed technical model such as:

```text
Target
├── Cloudflare edge
├── Vercel hosting indicators
├── Next.js + React frontend
├── Hybrid SSR/client application
├── REST API at api.target.example
├── OAuth/OIDC authentication indicators
├── WebSocket service
└── Third-party services
```

Preflight should identify enough of the target's technology and infrastructure to allow later XEKUTE components to choose the correct security methodology.

Preflight is focused on:

### Target Identity

Determine where observable:

* domain
* hostname
* scheme
* resolved IP addresses
* CNAMEs
* DNS provider
* ASN
* related first-party hosts
* TLS certificate information

### Delivery Infrastructure

Identify:

* CDN
* WAF indicators
* reverse proxy
* load balancer
* web server
* hosting provider
* cloud platform
* serverless platform
* edge infrastructure

Examples:

```text
Cloudflare
CloudFront
Akamai
nginx
Apache
IIS
Envoy
AWS
Azure
GCP
Vercel
Netlify
Firebase
```

Do not confuse the visible edge server with the underlying application server.

### Application Technology

Identify observable:

* frontend framework
* frontend library
* backend framework
* backend runtime
* CMS/platform
* build system
* important client libraries

Examples:

```text
React
Next.js
Angular
Vue
Nuxt
Svelte
Node.js
Express
NestJS
Django
FastAPI
Laravel
Spring
ASP.NET
WordPress
```

Unknown values must remain `unknown`.

### Application Type

Classify where possible:

```text
static
MPA
SPA
SSR
SSG
hybrid
API-only
serverless
headless
microfrontend
unknown
```

### API / Communication Architecture

Identify observable use of:

```text
REST
GraphQL
SOAP
JSON-RPC
gRPC-Web
tRPC
WebSocket
Socket.IO
Server-Sent Events
mixed
unknown
```

Record:

* API hosts
* API base paths
* API versions
* realtime hosts
* frontend/API separation

### Authentication Technology

Only identify the mechanism.

Examples:

```text
session cookies
JWT
Bearer tokens
OAuth2
OIDC
SAML
Auth0
Cognito
Firebase Auth
Supabase Auth
Entra ID
custom auth
unknown
```

Do not test the authentication implementation during Preflight.

### Third-Party Architecture

Identify important external dependencies such as:

```text
Stripe
Sentry
Cloudinary
Intercom
reCAPTCHA
Google Analytics
Auth0
external CDNs
external identity providers
```

Third-party infrastructure must remain clearly separated from first-party scoped assets.

---

# 3. Activation

Run Preflight when:

* a new web assessment starts;
* a new independent scoped application is discovered;
* the current target has no reliable technical profile;
* architecture has materially changed;
* existing technology evidence conflicts;
* later execution discovers a major previously unknown service.

Do not repeatedly rerun the entire process when a valid profile already exists.

Prefer incremental updates.

---

# 4. Discovery Strategy

Preflight should gather the **minimum sufficient evidence** required to understand the target.

Use existing XEKUTE evidence before generating new traffic.

Preferred order:

```text
1. Existing captured traffic
2. Existing browser observations
3. DNS / TLS information
4. HTTP response metadata
5. Technology fingerprinting
6. HTML inspection
7. JavaScript inspection
8. Passive public intelligence
9. Bounded low-impact discovery when required
```

Do not run every available tool automatically.

Use tools when they can resolve a meaningful unknown.

---

# 5. Tools

XEKUTE may use available tools and shell commands when necessary.

Examples include:

### HTTP / Technology Fingerprinting

```bash
httpx
whatweb
curl
```

Useful for:

* response headers
* server fingerprints
* titles
* redirects
* technologies
* CDN/WAF indicators
* IP/CNAME information
* TLS metadata

### DNS / Network Metadata

```bash
dig
nslookup
host
openssl
```

Useful for:

* A / AAAA records
* CNAME
* NS
* MX
* TXT
* TLS certificate metadata
* SANs

### Passive Discovery

```bash
subfinder
gau
```

Useful for:

* passive hostname discovery
* historical URLs
* historical API paths
* architecture clues

### Browser / Traffic Inspection

Use XEKUTE browser and traffic tooling to inspect:

* loaded JavaScript
* XHR/fetch requests
* API origins
* WebSocket connections
* cookies
* response headers
* storage key names
* redirects
* service workers
* manifests

### JavaScript / HTML Analysis

Inspect public client assets for:

* framework markers
* API URLs
* GraphQL URLs
* WebSocket URLs
* authentication services
* SDKs
* cloud services
* route definitions
* source map references
* first-party service domains

Tools are evidence sources, not authorities.

Correlate multiple signals when practical.

---

# 6. Intelligence Rules

Every meaningful observation should be normalized into XEKUTE intelligence.

Use states such as:

```text
confirmed
probable
possible
unknown
conflicting
```

Maintain provenance where practical.

Example:

```yaml
technology:
  name: nextjs
  confidence: confirmed
  evidence:
    - source: html
      observation: "__NEXT_DATA__ detected"

    - source: javascript
      observation: "/_next/static/ assets detected"
```

Never convert assumptions into facts.

If evidence conflicts:

```yaml
server:
  status: conflicting
  candidates:
    - nginx
    - apache
```

If something cannot be discovered safely:

```yaml
database:
  value: unknown
```

Unknown is a valid result.

---

# 7. Workspace Initialization

After initial discovery, ensure the following XEKUTE structure exists:

```text
.xekute/
└── spec/
    ├── intelligence/
    │
    ├── steering/
    │   ├── steering.md
    │   ├── target.md
    │   ├── tech.md
    │   └── security.md
    │
    └── skills/
        ├── recon/
        ├── frontend/
        ├── backend/
        ├── api/
        ├── auth/
        ├── authorization/
        ├── infrastructure/
        ├── platform/
        ├── client/
        └── business_logic/
```

Create missing directories and files automatically.

Do not overwrite valid existing intelligence without merging or updating it.

---

# 8. Intelligence Store

`.xekute/spec/intelligence/` is the durable source of truth for discovered target information.

Store normalized evidence such as:

```text
target
hosts
DNS
IP addresses
technologies
services
API architecture
authentication technology
infrastructure
relationships
observations
confidence
evidence provenance
unknowns
```

The intelligence store may grow throughout the assessment.

Steering documents are derived from this intelligence; they are not the authoritative evidence store.

---

# 9. Initial Steering Files

After Preflight, initialize or update the four continuous steering documents.

## `target.md`

Describes **what is being assessed**.

Include:

* primary target
* scoped hosts
* discovered first-party services
* application type
* observable application purpose
* known service relationships
* third-party boundaries
* major unknowns

Do not place detailed security methodology here.

---

## `tech.md`

Describes **what the target is built from**.

Include:

* frontend
* backend
* API architecture
* authentication technology
* server
* CDN/WAF
* hosting/cloud
* DNS/IP information
* realtime technologies
* third-party technical dependencies
* confidence and important unknowns

Preflight primarily enriches this file.

---

## `security.md`

Describes the currently understood **security architecture**.

During Preflight this may initially contain only:

* authentication mechanism
* visible security controls
* edge protection
* trust-boundary indicators
* externally visible security architecture
* unresolved security questions

Do not invent vulnerabilities.

This file becomes richer later as XEKUTE learns about:

* roles
* authorization boundaries
* tenants
* resource ownership
* trust relationships
* security controls
* validated security behavior

---

## `steering.md`

Provides the agent's compact working orientation.

Initial contents should include:

```text
Current Target
Current Technical Understanding
Known Architecture
Important Unknowns
Current Assessment Stage
Relevant Constraints
Next Required Intelligence
```

At the end of Preflight, the primary direction should normally be:

```text
Preflight complete.
Resolve relevant assessment skills from discovered target intelligence.
```

`steering.md` must remain concise.

It is working memory, not an evidence archive.

---

# 10. Skill Workspace

Preflight initializes:

```text
.xekute/spec/skills/
```

but does not need to populate every category.

These directories contain atomic methodology files such as:

```text
frontend/nextjs.md
frontend/react.md

api/rest.md
api/graphql.md
api/websocket.md

auth/oauth.md
auth/jwt.md

backend/spring.md
backend/express.md

infrastructure/nginx.md
infrastructure/cloudflare.md
```

Preflight produces the facts that allow the **Skill Resolver / Skill Builder** to determine which of these skills become relevant.

Example:

```text
Preflight detects:

Next.js
React
REST
OAuth2
Cloudflare
nginx

            ↓

Skill Resolver considers:

frontend/nextjs.md
frontend/react.md
api/rest.md
auth/oauth.md
infrastructure/cloudflare.md
infrastructure/nginx.md
```

The resulting selected methodology is incorporated into the continuously evolving steering system.

---

# 11. Continuous Intelligence

Preflight initializes the target model; discovery does not stop when Preflight ends.

During later assessment:

```text
new evidence
     ↓
normalize fact
     ↓
update intelligence
     ↓
update affected steering file
     ↓
resolve newly relevant skills
     ↓
update steering
     ↓
continue assessment
```

Only meaningful information should trigger steering updates.

Examples of meaningful changes:

```text
GraphQL discovered
OAuth confirmed
WebSocket discovered
new first-party API discovered
multi-tenant architecture discovered
backend framework identified
new user role identified
new trust boundary identified
```

Routine responses such as another ordinary `200 OK` should not cause unnecessary rewrites.

---

# 12. Output

Preflight completes with an initial technical profile containing at minimum:

```yaml
target:
  hostname:
  ip:
  dns:
  scope_status:

application:
  type:
  frontend:
  backend:

api:
  architecture:
  hosts:

authentication:
  mechanism:
  provider:

infrastructure:
  edge:
  server:
  hosting:
  cloud:

realtime:
  technology:

third_party: []

unknowns: []

evidence: []

skill_signals: []
```

The result should allow XEKUTE to answer:

> **What kind of system is this, and what knowledge should I load before I begin vulnerability-oriented assessment?**

---

# 13. Out of Scope

Preflight must not perform:

* exploitation
* vulnerability confirmation
* parameter fuzzing
* SQL injection testing
* XSS testing
* SSRF testing
* IDOR testing
* authentication bypass
* authorization bypass
* credential attacks
* brute-force directory discovery
* destructive actions
* state-changing security tests
* testing of third-party infrastructure
* interaction outside approved scope

Preflight discovers the system.

Later skills determine how the system should be tested.

---

# 14. Completion

Preflight is complete when XEKUTE has enough evidence to form a useful initial model of:

```text
target identity
application type
major technology stack
API/communication architecture
authentication technology
delivery infrastructure
important first-party services
third-party boundaries
major unknowns
```

Not every field must be known.

Do not prolong Preflight solely to eliminate every unknown.

The guiding principle is:

> **Discover enough about the target to select the right methodology, initialize continuous intelligence, and keep the agent correctly oriented for everything that follows.**
