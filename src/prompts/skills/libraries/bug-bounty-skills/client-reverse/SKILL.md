---
id: client-reverse
title: "Client-Side Request Signing and Anti-Bot Reversal"
description: "Recover enough client-side signing or anti-bot token behavior to replay protected API traffic when proxy replay fails, so you can test the backend for real access-control bugs."
version: 1.0.0
entrypoint: SKILL.md
visibility: internal
instruction_role: skill-context
modes: ["agent", "ask"]
required_tools: ["read_file", "search_workspace"]
parameter_policy: context-only
menu: bug-bounty
---
# Client-Side Request Signing and Anti-Bot Reversal

## What the skill is

A staged playbook for when legitimate browser or app traffic succeeds but copied requests fail with signature, freshness, or bot-detection errors. The goal is not to publish cryptography write-ups—it is to reach the protected API surface long enough to hunt IDOR, broken authentication, mass assignment, and business-logic flaws that were never tested without the client lock.

## When to use

Load this skill when Burp, mitmproxy, or curl replay of a captured request fails while the live client still works, when bodies or headers include dynamic `sign`, `sig`, HMAC, nonce, timestamp, device, or vendor sensor blobs, or when encrypted payloads appear to be client-produced. Do not default here before running the packet-first gate; many “signed” requests replay unchanged or tolerate field changes without reversing anything.

## How to use

### Intake (before Sources or decompilers)

Record target page or app action, exact failing request, symptom code, known evidence, which protected API you need to fuzz, and scope constraints. Decide whether the request is proven real, whether the write boundary is proven, and whether the blocker is freshness, incomplete coverage, opaque code, or runtime environment—not guesswork from keyword search.

### Phase 0 — Packet-first gate

Capture one authentic request from proxy or DevTools. Replay unchanged; if it succeeds, treat the API as directly testable. Replay after a delay to learn freshness windows. Mutate a single non-protected field while holding the client-computed value fixed; if the server accepts the change, the integrity mechanism does not cover that field and reversing may be unnecessary. Only continue when mutation under the same client value fails and you must regenerate the client-computed material.

### Phase 1 — Locate (writer ← builder ← entry ← source)

Trace backward from the value on the wire: the **writer** assigns header, body, cookie, or WebSocket envelope; the **builder** canonicalizes and transforms; the **entry** is the user action or callback that starts the chain; the **source** supplies timestamps, randomness, storage, prior responses, or embedded secrets. Use network-initiator breakpoints on the endpoint path, global search for field names on loaded scripts, pretty-printed bundles for stable locations, and DOM breakpoints when clicks trigger sends. Prove the sink before broad deobfuscation—string matches are not execution proof.

### Phase 2 — Recover (minimal de-shell)

Enter only when the boundary is proven and opacity blocks reading the builder. Reduce one shell at a time: module bundlers, string tables, workers, WASM loaders, or custom bytecode VMs. Prefer black-box capture of input-to-output pairs or calling an exposed page function over reimplementing math. For anti-bot SDKs, assume full token generation is often out of scope for a single bounty; reuse short-lived tokens, headless minting, or misconfiguration (cross-account token acceptance, missing protection on sibling hosts) before deep SDK research.

### Phase 3 — Classify signer inputs

Label each input: per-request mutable (time, nonce), session-pinned (device identifier), payload-bound (body, path, method), server-fed (prior response), or client-embedded secret. This classification decides whether offline re-signing, in-page signing, unchanged replay, or reporting incomplete coverage / replay windows is the right path. Search bundles or mobile packages for embedded secrets only after boundary proof—entropy and naming patterns guide manual review, not automatic claims.

### Phase 4 — Runtime and validation

When reimplementing or bridging, match checkpoints: canonical serialization (key order, separators, encoding), concatenation order before digests, and header sets—not only the final digest. Browser versus local divergence means missing globals, anti-debug branches, or lifecycle state; fix the first divergence minimally or use a headless bridge that executes the real signer.

### Phase 5 — Replay for fuzzing

Exit this skill into vuln-class testing only when you can state where the field is written, which inputs are constants versus regenerated, upstream ordering dependencies, and which request fields remain mutable under valid client computation. Drive repeatable requests from your automation stack or a browser bridge, then apply IDOR, auth, and logic playbooks on the unlocked endpoint.

### Topic routing (browser branch)

| Blocker | Lens |
| --- | --- |
| Dynamic headers, body fields, cookies | Boundary trace and builder contract |
| Workers, WASM, bundler indirection | Bridge at JS boundaries; capture I/O |
| Anti-debug or environment checks | Runtime diagnosis before rewriting crypto |
| Cookie hops, WebSocket, streaming protocols | Expand the request chain and state machine |
| Local script differs from browser | Minimal environment parity or headless signing |

### Handoff discipline

On every stage change, write a short card: previous stage, next stage, proven facts, open questions, and invalidated assumptions. Do not promote guesses to facts across stages.

### What belongs in a bounty report

Reversing alone is usually not in scope. Report replay windows, signatures that omit mutable fields, hardcoded secrets when tied to exploitable API abuse, broken token binding, or—most often—the downstream access-control or logic bug you reach after reproducible requests. Mobile apps follow the same spine: capture traffic first; static and dynamic instrumentation only when packets cannot be replayed or regenerated.

## Mental model

The client-computed field is a gate, not the prize. Packet-first eliminates wasted decompilation. The boundary model separates where data is written from how it is built and what feeds it—most failures are canonicalization mismatches, not unknown algorithms. Anti-bot blobs trade research time for session reuse and configuration mistakes. Incomplete integrity coverage (fields not included in the signed material) and missing freshness are themselves findings when demonstrated, without forging arbitrary payloads.

## Tools

| Tool | Job |
| --- | --- |
| Burp Suite / mitmproxy | Capture authentic requests and initiators |
| Chrome DevTools (Network, Sources, Console) | Break on fetch/XHR, search bundles, hook methods, log sign I/O |
| Python `requests` (or similar) | Replay and automate once signing is reproducible |
| Selenium / Playwright | Mint short-lived anti-bot or session-bound values via real browser |
| LinkFinder / jsluice | Discover API paths in bundles after traffic capture |
| apktool / jadx / Frida / objection (mobile) | Locate signers in APK when traffic is opaque—after packet-first fails |

## Expected output if success

A stable replay recipe: which fields regenerate each call, which constants to pin, optional bridge design, validation notes showing your output matches fresh browser samples on multiple inputs, and a pivot note listing which protected endpoints are now testable. Separate notes on submittable misconfigurations (replay window, incomplete coverage, token binding) versus the primary downstream bug class you intend to validate next.

## Expected output if not success

Documented stop reason: signer unreachable under anti-debug, server-only secret with no callable page function and no coverage gap, token lifetime too short for meaningful backend testing without a bridge you cannot run in scope, or protected API duplicated on an easier entry you should use instead. Include the packet-first outcomes so the next attempt does not repeat decompilation.

## Verification method

Prove equivalence on newly captured browser samples before fuzzing at scale. Demonstrate backend impact with two identities or clear cross-object access per program rules—not merely that a header matches. Confirm findings on in-scope hosts and methods. For configuration-class issues (replay, omitted fields), show the server accepts the abused behavior with measured freshness or field independence. Before writing up, run the report-writing skill gates: proved impact, no theoretical language, severity matches demonstrated harm—not “algorithm recovered.”
