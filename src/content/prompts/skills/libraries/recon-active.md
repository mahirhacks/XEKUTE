# VAPT SKILL — Active recon & enumeration

## 1. Purpose
Resolve specific inventory unknowns left by passive recon with the smallest approved active probes. Active recon confirms which hosts, routes, ports, and services are live and in scope, producing a validated attack surface for later scanning and probing.

## 2. Methodology
1. **Live HTTP surface** — httpx / katana at low rate, respecting scope paths; capture status, title, and tech.
2. **DNS / subdomains** — subfinder / amass (passive first); every subdomain must match scope wildcards.
3. **Port / service discovery** — nmap top ports only; no destructive scripts unless approved.
4. **Directory / file enumeration** — gobuster / ffuf with wordlist size cap, 404 baseline, stop on instability.
5. **TLS / WAF fingerprint** — testssl / wafw00f fingerprint only; no downgrade attacks in this phase.
6. **Hypothesis linkage** — each action answers one unknown: "Does route X exist?", "Which API version is live?", "Is admin panel on subdomain Y?"; define supporting signal (new route in output) and rejecting signal (consistent 404/403 baseline).

## 3. Tools that help
| Tool | How it helps |
|------|--------------|
| httpx | Fast live-host validation across the discovered surface |
| katana | Crawl routes and parameters within scope |
| subfinder / amass | Subdomain confirmation and wildcard matching |
| nmap | Top-port and service-version discovery |
| gobuster / ffuf | Directory and file enumeration with 404 baseline |
| testssl / wafw00f | TLS posture and WAF identification |

## 4. Output structure
Store per host: raw adapter output, command metadata, scope target used, WSTG mapping (INFO-04 through INFO-10, CONF discovery), and diff against prior inventory. Respect maxRequestsPerSecond and maxConcurrency from ROE; batch by host; pause on latency spike or error-rate increase. Coverage limitation: recon without an authenticated session may miss internal routes — note it in the plan.
